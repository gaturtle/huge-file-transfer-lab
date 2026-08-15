# Upload load-test harness

Validates that the chunked upload + Assembly checksum pass survives a real ~5GB
transfer without OOM on the 1 vCPU / 1GB RAM target server, per the approach decided in
[issue #12](https://github.com/gaturtle/huge-file-transfer-lab/issues/12) and built in
[issue #18](https://github.com/gaturtle/huge-file-transfer-lab/issues/18).

Scope: upload + Assembly only. Download is excluded — it streams via `ResourceRegion`
and was already judged memory-safe by design (issue #12).

## How it works

1. `generate-file.js` writes a synthetic file of the requested size (default 5120 MiB).
2. `run-local.sh` builds `backend/Dockerfile`, runs it with `--cpus=1 --memory=1g` and
   `JAVA_TOOL_OPTIONS=-Xmx256m -Xlog:gc:...` (matching the target server's constraints,
   issue #7), and waits for `/actuator/health`.
3. `monitor.js` samples, every ~2s, both container memory (`cgroup v2`
   `memory.current`/`memory.stat` via `docker exec`, not `docker stats` — cgroup is read
   directly for accuracy) and JVM heap (`/actuator/metrics/jvm.memory.used`,
   `.../jvm.memory.committed`), writing `samples.csv`.
4. `client.js` drives the chunked API directly: whole-file SHA-256 up front, per-chunk
   CRC32C, 3-4 parallel `PUT` requests, then `POST .../complete`.
5. `run-local.sh` evaluates the result against the issue #12 pass criteria and writes
   `summary.md`.

## Usage

Requires Docker and Node.js on the machine running the harness (not inside the
container).

```bash
scripts/loadtest/run-local.sh
# or, for a quick smoke run of the harness itself:
scripts/loadtest/run-local.sh --size-mb 200 --keep-file
```

Options:

- `--size-mb <n>` — synthetic file size in MiB (default `5120`, i.e. ~5GB).
- `--concurrency <n>` — parallel chunk `PUT`s (default `4`).
- `--keep-file` — don't delete the generated synthetic file afterward (useful for
  reusing it across repeated runs; it's identical content each time for a given size).

Results land in `results/<timestamp>/`: `summary.md`, `samples.csv`, `gc.log`,
`client.log`, `container.log`. That directory is gitignored — commit only the numbers
worth keeping, in the summary comment on issue #18.

## Pass criteria (from issue #12)

- No OOM-kill (`docker inspect` `State.OOMKilled`).
- Peak container memory (`cgroup memory.current`) &le; 900MB.
- Assembly completes with a verified checksum (client exits 0 and reports `state=COMPLETE`).
- No pathological GC-pause growth (inspect `gc.log` manually — not automated by
  `run-local.sh`; the log is captured for exactly this).

## Real-server smoke test

Once [issue #16](https://github.com/gaturtle/huge-file-transfer-lab/issues/16)
(provision and deploy to the target server) has the backend actually running,
`run-remote-smoke.sh` drives the same `client.js` against it directly — no container
orchestration needed, the server *is* the constrained environment (`docker-compose.yml`'s
`mem_limit`/`-Xmx`, issue #8) — while sampling `docker stats` on the server over SSH:

```bash
scripts/loadtest/run-remote-smoke.sh --host root@<server> --base-url https://<domain>
```

Note: JVM heap sampling via Actuator (as used by `run-local.sh`) isn't available here
until a build including the `spring-boot-starter-actuator` dependency has been deployed —
`run-remote-smoke.sh` only samples container memory (`docker stats`).
