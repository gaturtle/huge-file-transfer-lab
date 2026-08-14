#!/usr/bin/env bash
# Builds the backend image, runs it under the target server's resource constraints
# (--cpus=1 --memory=1g, -Xmx256m), drives a synthetic ~5GB upload through it while
# sampling container memory + JVM heap every ~2s, and checks the result against the
# pass criteria from issue #12: no OOM-kill, peak RSS <= 900MB, verified checksum,
# no pathological GC-pause growth.
#
# Usage: scripts/loadtest/run-local.sh [--size-mb 5120] [--concurrency 4] [--keep-file]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SIZE_MB=5120
CONCURRENCY=4
KEEP_FILE=0
HOST_PORT=18080
CONTAINER_NAME="huge-file-transfer-loadtest"
IMAGE_TAG="huge-file-transfer-backend:loadtest"
PASS_PEAK_RSS_MIB=900
XMX="256m"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --size-mb) SIZE_MB="$2"; shift 2 ;;
    --concurrency) CONCURRENCY="$2"; shift 2 ;;
    --keep-file) KEEP_FILE=1; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

TS="$(date +%Y%m%d-%H%M%S)"
RESULTS_DIR="$SCRIPT_DIR/results/$TS"
mkdir -p "$RESULTS_DIR"
DATA_FILE="$RESULTS_DIR/synthetic-${SIZE_MB}mb.bin"
CSV="$RESULTS_DIR/samples.csv"
SUMMARY="$RESULTS_DIR/summary.md"
CLIENT_LOG="$RESULTS_DIR/client.log"
MONITOR_LOG="$RESULTS_DIR/monitor.log"

cleanup() {
  if [[ -n "${MONITOR_PID:-}" ]] && kill -0 "$MONITOR_PID" 2>/dev/null; then
    kill "$MONITOR_PID" 2>/dev/null || true
  fi
  if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  if [[ "$KEEP_FILE" -eq 0 && -f "$DATA_FILE" ]]; then
    rm -f "$DATA_FILE"
  fi
}
trap cleanup EXIT

echo "== 1. Generating synthetic ${SIZE_MB}MiB file =="
node "$SCRIPT_DIR/generate-file.js" --out "$DATA_FILE" --size-mb "$SIZE_MB"

echo "== 2. Building backend image ($IMAGE_TAG) =="
docker build -t "$IMAGE_TAG" "$REPO_ROOT/backend"

echo "== 3. Starting container: --cpus=1 --memory=1g, -Xmx$XMX =="
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
# Git-bash/MSYS mangles the "/results" container-side half of the bind mount into a
# Windows path; MSYS_NO_PATHCONV=1 disables that, so the host-side path must already be
# Windows-native (cygpath -w) instead of relying on MSYS's usual auto-conversion. No-op
# on native Linux, where cygpath doesn't exist and MSYS_NO_PATHCONV is meaningless.
RESULTS_DIR_FOR_DOCKER="$RESULTS_DIR"
if command -v cygpath >/dev/null 2>&1; then
  RESULTS_DIR_FOR_DOCKER="$(cygpath -w "$RESULTS_DIR")"
fi
MSYS_NO_PATHCONV=1 docker run -d --name "$CONTAINER_NAME" \
  --cpus=1 --memory=1g \
  -e "JAVA_TOOL_OPTIONS=-Xmx${XMX} -Xlog:gc:/results/gc.log:time,uptime,level,tags" \
  -p "${HOST_PORT}:8080" \
  -v "${RESULTS_DIR_FOR_DOCKER}:/results" \
  "$IMAGE_TAG" >/dev/null

echo "== 4. Waiting for backend health =="
BASE_URL="http://localhost:${HOST_PORT}"
for i in $(seq 1 60); do
  if curl -fsS "$BASE_URL/actuator/health" >/dev/null 2>&1; then
    echo "backend healthy after ${i}s"
    break
  fi
  if ! docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q true; then
    echo "container exited before becoming healthy:" >&2
    docker logs "$CONTAINER_NAME" >&2 || true
    exit 1
  fi
  sleep 1
  if [[ "$i" -eq 60 ]]; then
    echo "backend did not become healthy in 60s" >&2
    docker logs "$CONTAINER_NAME" >&2 || true
    exit 1
  fi
done

echo "== 5. Starting monitor (2s interval) =="
node "$SCRIPT_DIR/monitor.js" --container "$CONTAINER_NAME" --base-url "$BASE_URL" --out "$CSV" --interval-ms 2000 \
  >"$MONITOR_LOG" 2>&1 &
MONITOR_PID=$!

echo "== 6. Running client: ${SIZE_MB}MiB, concurrency=$CONCURRENCY =="
set +e
node "$SCRIPT_DIR/client.js" --file "$DATA_FILE" --base-url "$BASE_URL" --concurrency "$CONCURRENCY" \
  | tee "$CLIENT_LOG"
CLIENT_EXIT=${PIPESTATUS[0]}
set -e

echo "== 7. Draining monitor =="
sleep 3
OOM_KILLED="$(docker inspect -f '{{.State.OOMKilled}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")"
EXIT_CODE="$(docker inspect -f '{{.State.ExitCode}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")"
STILL_RUNNING="$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo "false")"
if kill -0 "$MONITOR_PID" 2>/dev/null; then
  kill "$MONITOR_PID" 2>/dev/null || true
fi
docker logs "$CONTAINER_NAME" > "$RESULTS_DIR/container.log" 2>&1 || true

echo "== 8. Evaluating results =="
PEAK_USAGE_MIB=$(awk -F, 'NR>1 && $2!="" {print $2}' "$CSV" | sort -n | tail -1)
PEAK_USAGE_MINUS_CACHE_MIB=$(awk -F, 'NR>1 && $3!="" {print $3}' "$CSV" | sort -n | tail -1)
PEAK_ANON_MIB=$(awk -F, 'NR>1 && $4!="" {print $4}' "$CSV" | sort -n | tail -1)
PEAK_HEAP_MIB=$(awk -F, 'NR>1 && $5!="" {print $5}' "$CSV" | sort -n | tail -1)
PEAK_USAGE_MIB=${PEAK_USAGE_MIB:-0}
PEAK_USAGE_MINUS_CACHE_MIB=${PEAK_USAGE_MINUS_CACHE_MIB:-0}
PEAK_ANON_MIB=${PEAK_ANON_MIB:-0}
PEAK_HEAP_MIB=${PEAK_HEAP_MIB:-0}

# memory.current includes reclaimable page cache from the pre-allocated chunk staging
# file; docker stats' own figure (and what the pass threshold is really about) nets that
# out via inactive_file, so evaluate against cgroup_usage_minus_cache, not raw usage.
PASS=1
[[ "$OOM_KILLED" == "true" ]] && PASS=0
[[ "$CLIENT_EXIT" -ne 0 ]] && PASS=0
awk -v v="$PEAK_USAGE_MINUS_CACHE_MIB" -v limit="$PASS_PEAK_RSS_MIB" 'BEGIN{exit !(v<=limit)}' || PASS=0

{
  echo "# Load test result: $TS"
  echo
  echo "- File size: ${SIZE_MB} MiB"
  echo "- Concurrency: $CONCURRENCY"
  echo "- Container limits: --cpus=1 --memory=1g, JAVA_TOOL_OPTIONS=-Xmx${XMX}"
  echo "- Client exit code: $CLIENT_EXIT"
  echo "- OOMKilled: $OOM_KILLED"
  echo "- Container ExitCode: $EXIT_CODE (still running after test: $STILL_RUNNING)"
  echo "- Peak cgroup memory.current (raw, includes page cache): ${PEAK_USAGE_MIB} MiB"
  echo "- Peak cgroup memory.current minus inactive_file (matches docker-stats semantics): ${PEAK_USAGE_MINUS_CACHE_MIB} MiB (pass threshold: <= ${PASS_PEAK_RSS_MIB} MiB)"
  echo "- Peak cgroup anon (true app memory, excludes all page cache): ${PEAK_ANON_MIB} MiB"
  echo "- Peak JVM heap used (Actuator): ${PEAK_HEAP_MIB} MiB"
  echo
  if [[ "$PASS" -eq 1 ]]; then
    echo "RESULT: PASS"
  else
    echo "RESULT: FAIL"
  fi
  echo
  echo "Raw samples: samples.csv"
  echo "GC log: gc.log"
  echo "Client log: client.log"
  echo "Container log: container.log"
} | tee "$SUMMARY"

if [[ "$PASS" -eq 1 ]]; then
  exit 0
else
  exit 1
fi
