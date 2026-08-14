#!/usr/bin/env node
// Generates a synthetic file of the given size for load-testing the chunked upload API.
'use strict';

const fs = require('fs');
const crypto = require('crypto');

function getArg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : def;
}

const outPath = getArg('out', null);
const sizeMb = parseInt(getArg('size-mb', '5120'), 10);

if (!outPath) {
  console.error('Usage: generate-file.js --out <path> [--size-mb 5120]');
  process.exit(1);
}

const CHUNK = 8 * 1024 * 1024;
const totalBytes = sizeMb * 1024 * 1024;
// Reuse one random buffer as filler (generating 5GiB of fresh randomness is slow and
// unnecessary here), stamping the chunk index into each chunk's first 4 bytes so chunks
// aren't byte-identical.
const filler = crypto.randomBytes(CHUNK);

const fd = fs.openSync(outPath, 'w');
let written = 0;
let index = 0;
const start = Date.now();

while (written < totalBytes) {
  const size = Math.min(CHUNK, totalBytes - written);
  const buf = Buffer.from(filler.subarray(0, size));
  buf.writeUInt32BE(index >>> 0, 0);
  fs.writeSync(fd, buf, 0, size, written);
  written += size;
  index++;
}
fs.closeSync(fd);

const secs = (Date.now() - start) / 1000;
console.log(
  `Wrote ${outPath}: ${(totalBytes / 1024 / 1024).toFixed(0)} MiB in ${secs.toFixed(1)}s ` +
  `(${(totalBytes / 1024 / 1024 / secs).toFixed(1)} MiB/s)`
);
