#!/usr/bin/env node
// Drives the chunked upload API directly (3-4 parallel chunk PUTs) against a file on
// disk, mirroring the real frontend's upload path closely enough to load-test the
// backend: whole-file SHA-256 up front, per-chunk CRC32C, concurrent PUTs, then complete.
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { crc32cHex } = require('./crc32c');

function getArg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : def;
}

function sha256OfFile(path) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(path);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function main() {
  const filePath = getArg('file', null);
  const baseUrl = (getArg('base-url', 'http://localhost:8080')).replace(/\/$/, '');
  const concurrency = parseInt(getArg('concurrency', '4'), 10);
  const progressEvery = parseInt(getArg('progress-every', '25'), 10);

  if (!filePath) {
    console.error('Usage: client.js --file <path> [--base-url http://localhost:8080] [--concurrency 4]');
    process.exit(1);
  }

  const stat = fs.statSync(filePath);
  const totalSize = stat.size;
  const filename = filePath.split(/[\\/]/).pop();

  console.log(`Computing whole-file SHA-256 for ${filename} (${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GiB)...`);
  const hashStart = Date.now();
  const checksum = await sha256OfFile(filePath);
  console.log(`SHA-256: ${checksum} (${((Date.now() - hashStart) / 1000).toFixed(1)}s)`);

  const createRes = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, totalSize, checksum }),
  });
  if (!createRes.ok) {
    throw new Error(`POST /uploads failed: ${createRes.status} ${await createRes.text()}`);
  }
  const { uploadId, chunkSize, chunkCount } = await createRes.json();
  console.log(`Upload session ${uploadId}: ${chunkCount} chunks of ${chunkSize} bytes, concurrency=${concurrency}`);

  const fd = fs.openSync(filePath, 'r');
  let nextIndex = 0;
  let completed = 0;
  const uploadStart = Date.now();

  async function worker() {
    for (;;) {
      const index = nextIndex++;
      if (index >= chunkCount) return;

      const offset = index * chunkSize;
      const size = Math.min(chunkSize, totalSize - offset);
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, offset);
      const crc = crc32cHex(buf);

      let attempt = 0;
      for (;;) {
        attempt++;
        const res = await fetch(`${baseUrl}/uploads/${uploadId}/chunks/${index}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Chunk-Checksum': crc,
          },
          body: buf,
        });
        if (res.ok) break;
        if (attempt >= 3) {
          throw new Error(`PUT chunk ${index} failed after ${attempt} attempts: ${res.status} ${await res.text()}`);
        }
        console.warn(`  chunk ${index} attempt ${attempt} failed (HTTP ${res.status}), retrying...`);
      }

      completed++;
      if (completed % progressEvery === 0 || completed === chunkCount) {
        const elapsedSecs = (Date.now() - uploadStart) / 1000;
        const mbps = (completed * chunkSize) / 1024 / 1024 / elapsedSecs;
        console.log(`  ${completed}/${chunkCount} chunks (${((completed / chunkCount) * 100).toFixed(1)}%), ${mbps.toFixed(1)} MiB/s`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  fs.closeSync(fd);

  const uploadSecs = (Date.now() - uploadStart) / 1000;
  console.log(`All ${chunkCount} chunks uploaded in ${uploadSecs.toFixed(1)}s (${(totalSize / 1024 / 1024 / uploadSecs).toFixed(1)} MiB/s)`);

  console.log('Completing upload (server-side Assembly + whole-file checksum verify)...');
  const assembleStart = Date.now();
  const completeRes = await fetch(`${baseUrl}/uploads/${uploadId}/complete`, { method: 'POST' });
  if (!completeRes.ok) {
    throw new Error(`POST /uploads/${uploadId}/complete failed: ${completeRes.status} ${await completeRes.text()}`);
  }
  const status = await completeRes.json();
  const assembleSecs = (Date.now() - assembleStart) / 1000;
  console.log(`Assembly finished in ${assembleSecs.toFixed(1)}s: state=${status.state}`);

  if (status.state !== 'COMPLETE') {
    console.error(`FAIL: uploadId=${uploadId} final state=${status.state}, expected COMPLETE`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS: uploadId=${uploadId} completed, server-side checksum verified against ${checksum}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
