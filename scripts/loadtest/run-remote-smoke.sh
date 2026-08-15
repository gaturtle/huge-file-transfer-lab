#!/usr/bin/env bash
# Final smoke test from issue #18: once the local run passes, confirm a real ~5GB
# transfer over the actual network against the deployed server. Unlike run-local.sh,
# this doesn't build or start anything — the server IS the constrained environment
# (docker-compose.yml's mem_limit/-Xmx, issue #8) — it just drives client.js against it
# while sampling `docker stats` on the server over SSH.
#
# Usage: scripts/loadtest/run-remote-smoke.sh --host <user@host> --base-url https://<domain> [--size-mb 5120] [--concurrency 4] [--keep-file]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SIZE_MB=5120
CONCURRENCY=4
KEEP_FILE=0
SSH_HOST=""
BASE_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) SSH_HOST="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --size-mb) SIZE_MB="$2"; shift 2 ;;
    --concurrency) CONCURRENCY="$2"; shift 2 ;;
    --keep-file) KEEP_FILE=1; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$SSH_HOST" || -z "$BASE_URL" ]]; then
  echo "Usage: run-remote-smoke.sh --host <user@host> --base-url https://<domain> [--size-mb 5120] [--concurrency 4] [--keep-file]" >&2
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
RESULTS_DIR="$SCRIPT_DIR/results/remote-$TS"
mkdir -p "$RESULTS_DIR"
DATA_FILE="$RESULTS_DIR/synthetic-${SIZE_MB}mb.bin"
STATS_LOG="$RESULTS_DIR/docker-stats.log"
CLIENT_LOG="$RESULTS_DIR/client.log"
SUMMARY="$RESULTS_DIR/summary.md"

cleanup() {
  if [[ -n "${MONITOR_PID:-}" ]] && kill -0 "$MONITOR_PID" 2>/dev/null; then
    kill "$MONITOR_PID" 2>/dev/null || true
  fi
  if [[ "$KEEP_FILE" -eq 0 && -f "$DATA_FILE" ]]; then
    rm -f "$DATA_FILE"
  fi
}
trap cleanup EXIT

echo "== 1. Generating synthetic ${SIZE_MB}MiB file =="
node "$SCRIPT_DIR/generate-file.js" --out "$DATA_FILE" --size-mb "$SIZE_MB"

echo "== 2. Starting remote docker stats monitor (2s interval) over SSH =="
ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$SSH_HOST" \
  'while true; do date -u +%Y-%m-%dT%H:%M:%SZ; docker stats --no-stream --format "{{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}"; sleep 2; done' \
  > "$STATS_LOG" 2>&1 &
MONITOR_PID=$!

echo "== 3. Running client against $BASE_URL: ${SIZE_MB}MiB, concurrency=$CONCURRENCY =="
set +e
node "$SCRIPT_DIR/client.js" --file "$DATA_FILE" --base-url "$BASE_URL" --concurrency "$CONCURRENCY" \
  | tee "$CLIENT_LOG"
CLIENT_EXIT=${PIPESTATUS[0]}
set -e

echo "== 4. Stopping monitor =="
if kill -0 "$MONITOR_PID" 2>/dev/null; then
  kill "$MONITOR_PID" 2>/dev/null || true
fi

echo "== 5. Evaluating results =="
PEAK_BACKEND_MEM=$(grep 'huge-file-transfer-backend' "$STATS_LOG" | awk '{print $2}' | sed 's#/.*##' | sort -h | tail -1 || echo "")

PASS=1
[[ "$CLIENT_EXIT" -ne 0 ]] && PASS=0

{
  echo "# Remote smoke test result: $TS"
  echo
  echo "- Target: $BASE_URL ($SSH_HOST)"
  echo "- File size: ${SIZE_MB} MiB"
  echo "- Concurrency: $CONCURRENCY"
  echo "- Client exit code: $CLIENT_EXIT"
  echo "- Peak backend container memory (docker stats MemUsage, includes page cache): ${PEAK_BACKEND_MEM:-unknown}"
  echo
  if [[ "$PASS" -eq 1 ]]; then
    echo "RESULT: PASS"
  else
    echo "RESULT: FAIL"
  fi
  echo
  echo "Full docker stats samples: docker-stats.log"
  echo "Client log: client.log"
} | tee "$SUMMARY"

if [[ "$PASS" -eq 1 ]]; then
  exit 0
else
  exit 1
fi
