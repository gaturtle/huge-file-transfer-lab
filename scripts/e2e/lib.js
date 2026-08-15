// Shared helpers for the deployed-environment e2e suite: chunked upload/download
// primitives against the real API, reusing the load-test harness's CRC32C impl.
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { crc32cHex } = require('../loadtest/crc32c');

const CHUNK_SIZE = 8 * 1024 * 1024;

function chunkCountFor(totalSize) {
  return Math.ceil(totalSize / CHUNK_SIZE);
}

function generateFile(outPath, sizeMb) {
  const totalBytes = sizeMb * 1024 * 1024;
  const filler = crypto.randomBytes(CHUNK_SIZE);
  const fd = fs.openSync(outPath, 'w');
  let written = 0;
  let index = 0;
  while (written < totalBytes) {
    const size = Math.min(CHUNK_SIZE, totalBytes - written);
    const buf = Buffer.from(filler.subarray(0, size));
    buf.writeUInt32BE(index >>> 0, 0);
    fs.writeSync(fd, buf, 0, size, written);
    written += size;
    index++;
  }
  fs.closeSync(fd);
}

function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function readChunk(fd, index, totalSize) {
  const offset = index * CHUNK_SIZE;
  const size = Math.min(CHUNK_SIZE, totalSize - offset);
  const buf = Buffer.alloc(size);
  fs.readSync(fd, buf, 0, size, offset);
  return buf;
}

async function createSession(baseUrl, filename, totalSize, checksum) {
  const res = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, totalSize, checksum }),
  });
  if (!res.ok) {
    throw new Error(`POST /uploads failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function getStatus(baseUrl, uploadId) {
  const res = await fetch(`${baseUrl}/uploads/${uploadId}`);
  if (!res.ok) {
    throw new Error(`GET /uploads/${uploadId} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Returns the raw Response so callers can inspect status codes on failure paths.
async function putChunkRaw(baseUrl, uploadId, index, buf, crcOverride, signal) {
  return fetch(`${baseUrl}/uploads/${uploadId}/chunks/${index}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Chunk-Checksum': crcOverride !== undefined ? crcOverride : crc32cHex(buf),
    },
    body: buf,
    signal,
  });
}

async function uploadIndices(baseUrl, uploadId, fd, totalSize, indices, concurrency) {
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= indices.length) return;
      const index = indices[i];
      const buf = readChunk(fd, index, totalSize);
      let attempt = 0;
      for (;;) {
        attempt++;
        const res = await putChunkRaw(baseUrl, uploadId, index, buf);
        if (res.ok) break;
        if (attempt >= 3) {
          throw new Error(`PUT chunk ${index} failed after ${attempt} attempts: ${res.status} ${await res.text()}`);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

async function completeUpload(baseUrl, uploadId) {
  const res = await fetch(`${baseUrl}/uploads/${uploadId}/complete`, { method: 'POST' });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

async function downloadRange(baseUrl, uploadId, start, end, extraHeaders) {
  return fetch(`${baseUrl}/uploads/${uploadId}/download`, {
    headers: { Range: `bytes=${start}-${end}`, ...(extraHeaders || {}) },
  });
}

async function downloadFileParallel(baseUrl, uploadId, totalSize, outPath, concurrency) {
  const fd = fs.openSync(outPath, 'w');
  fs.ftruncateSync(fd, totalSize);
  const chunkCount = chunkCountFor(totalSize);
  const indices = Array.from({ length: chunkCount }, (_, i) => i);
  let next = 0;
  let firstEtag = null;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= indices.length) return;
      const index = indices[i];
      const start = index * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalSize) - 1;
      const res = await downloadRange(baseUrl, uploadId, start, end);
      if (res.status !== 206) {
        throw new Error(`Range GET for chunk ${index} expected 206, got ${res.status}`);
      }
      if (!firstEtag) firstEtag = res.headers.get('etag');
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeSync(fd, buf, 0, buf.length, start);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  fs.closeSync(fd);
  return { etag: firstEtag };
}

module.exports = {
  CHUNK_SIZE,
  chunkCountFor,
  generateFile,
  sha256OfFile,
  readChunk,
  createSession,
  getStatus,
  putChunkRaw,
  uploadIndices,
  completeUpload,
  downloadRange,
  downloadFileParallel,
};
