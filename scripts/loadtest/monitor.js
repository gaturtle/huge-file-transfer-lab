#!/usr/bin/env node
// Samples container memory (cgroup) and JVM heap (Actuator) concurrently on a fixed
// interval, writing one CSV row per sample until the container stops or is killed.
'use strict';

const { execFile } = require('child_process');
const fs = require('fs');

function getArg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : def;
}

const container = getArg('container', null);
const baseUrl = (getArg('base-url', 'http://localhost:8080')).replace(/\/$/, '');
const outCsv = getArg('out', null);
const intervalMs = parseInt(getArg('interval-ms', '2000'), 10);

if (!container || !outCsv) {
  console.error('Usage: monitor.js --container <name> --out <csv-path> [--base-url http://localhost:8080] [--interval-ms 2000]');
  process.exit(1);
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

async function cgroupUsageMib() {
  const out = await run('docker', ['exec', container, 'cat', '/sys/fs/cgroup/memory.current']);
  if (out == null) return null;
  return Number(out.trim()) / 1024 / 1024;
}

// memory.current includes reclaimable page cache (here, mostly the pre-allocated chunk
// staging file's pages, written/read via RandomAccessFile) which doesn't reflect memory
// pressure the way `docker stats`' figure does. `docker stats` on cgroup v2 subtracts
// inactive_file for exactly this reason; mirror that here as the "effective" figure the
// pass criteria's RSS threshold is actually about, alongside raw anon (true app memory).
async function cgroupStatMib() {
  const out = await run('docker', ['exec', container, 'cat', '/sys/fs/cgroup/memory.stat']);
  if (out == null) return { anon: null, inactiveFile: null };
  const fields = Object.fromEntries(
    out.split('\n').filter(Boolean).map((l) => {
      const [k, v] = l.split(/\s+/);
      return [k, Number(v)];
    })
  );
  return {
    anon: fields.anon != null ? fields.anon / 1024 / 1024 : null,
    inactiveFile: fields.inactive_file != null ? fields.inactive_file / 1024 / 1024 : null,
  };
}

async function heapMib() {
  try {
    const res = await fetch(`${baseUrl}/actuator/metrics/jvm.memory.used?tag=area:heap`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { used: null, committed: null };
    const body = await res.json();
    const used = body.measurements.find((m) => m.statistic === 'VALUE')?.value ?? null;

    const res2 = await fetch(`${baseUrl}/actuator/metrics/jvm.memory.committed?tag=area:heap`, {
      signal: AbortSignal.timeout(1500),
    });
    const committed = res2.ok
      ? (await res2.json()).measurements.find((m) => m.statistic === 'VALUE')?.value ?? null
      : null;

    return {
      used: used != null ? used / 1024 / 1024 : null,
      committed: committed != null ? committed / 1024 / 1024 : null,
    };
  } catch {
    return { used: null, committed: null };
  }
}

async function isRunning() {
  const out = await run('docker', ['inspect', '-f', '{{.State.Running}}', container]);
  return out != null && out.trim() === 'true';
}

fs.writeFileSync(
  outCsv,
  'timestamp,cgroup_usage_mib,cgroup_usage_minus_cache_mib,cgroup_anon_mib,heap_used_mib,heap_committed_mib\n'
);

let sampleCount = 0;

async function tick() {
  if (!(await isRunning())) {
    console.log(`monitor: container ${container} is no longer running, stopping (${sampleCount} samples)`);
    return;
  }
  const [usage, stat, heap] = await Promise.all([cgroupUsageMib(), cgroupStatMib(), heapMib()]);
  const usageMinusCache = (usage != null && stat.inactiveFile != null) ? usage - stat.inactiveFile : null;
  const row = [
    new Date().toISOString(),
    usage != null ? usage.toFixed(1) : '',
    usageMinusCache != null ? usageMinusCache.toFixed(1) : '',
    stat.anon != null ? stat.anon.toFixed(1) : '',
    heap.used != null ? heap.used.toFixed(1) : '',
    heap.committed != null ? heap.committed.toFixed(1) : '',
  ].join(',');
  fs.appendFileSync(outCsv, row + '\n');
  sampleCount++;
  setTimeout(tick, intervalMs);
}

console.log(`monitor: sampling ${container} every ${intervalMs}ms -> ${outCsv}`);
tick();
