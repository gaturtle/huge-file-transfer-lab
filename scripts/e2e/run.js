#!/usr/bin/env node
// End-to-end verification against the real deployed server (issue #17): exercises
// upload+download of a multi-GB file, pause/resume, network interruption, and
// checksum-mismatch retry against the actual protocol (issues #3, #5, #6), on the
// live 1 vCPU/1GB/25GB server rather than a local dev environment.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CHUNK_SIZE,
  chunkCountFor,
  generateFile,
  sha256OfFile,
  createSession,
  getStatus,
  putChunkRaw,
  uploadIndices,
  completeUpload,
  downloadRange,
  downloadFileParallel,
} = require('./lib');

function getArg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : def;
}

const baseUrl = getArg('base-url', 'https://hiimhuy.com').replace(/\/$/, '');
const workDir = getArg('work-dir', path.join(os.tmpdir(), 'hft-e2e'));
const bigSizeMb = parseInt(getArg('big-size-mb', '2048'), 10);
const smallSizeMb = parseInt(getArg('small-size-mb', '96'), 10);
const concurrency = parseInt(getArg('concurrency', '4'), 10);

const results = [];

async function test(name, fn) {
  const start = Date.now();
  process.stdout.write(`\n=== ${name} ===\n`);
  try {
    await fn();
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`PASS (${secs}s)`);
    results.push({ name, pass: true });
  } catch (err) {
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`FAIL (${secs}s): ${err.stack || err}`);
    results.push({ name, pass: false, error: String(err.message || err) });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

// Range/If-Range edge cases from issue #5's protocol. Deliberately run against a small
// completed session: a stale If-Range makes the server fall back to serving the FULL
// body (by design - ifRangeMismatch => serveFull), so doing this against a multi-GB
// file would silently re-transfer the whole thing a second time just to check headers.
async function rangeEdgeCases(uploadId, checksum) {
  const noRangeRes = await fetch(`${baseUrl}/uploads/${uploadId}/download`);
  assert(noRangeRes.status === 200, `no-Range request expected 200, got ${noRangeRes.status}`);
  const etag = noRangeRes.headers.get('etag');
  await noRangeRes.body?.cancel();
  assert(etag === `"${checksum}"`, `ETag ${etag} should be the whole-file SHA-256`);

  const staleIfRange = await downloadRange(baseUrl, uploadId, 0, CHUNK_SIZE - 1, { 'If-Range': '"stale-etag"' });
  assert(staleIfRange.status === 200, `stale If-Range should fall back to full 200, got ${staleIfRange.status}`);
  await staleIfRange.body?.cancel();

  const freshIfRange = await downloadRange(baseUrl, uploadId, 0, CHUNK_SIZE - 1, { 'If-Range': etag });
  assert(freshIfRange.status === 206, `fresh If-Range should serve 206, got ${freshIfRange.status}`);
  await freshIfRange.arrayBuffer();
  console.log('  no-Range (200), stale If-Range (200 full body), fresh If-Range (206) all behave per protocol');
}

async function uploadBig(filePath) {
  const stat = fs.statSync(filePath);
  const totalSize = stat.size;
  const filename = path.basename(filePath);
  const checksum = await sha256OfFile(filePath);
  console.log(`  big file: ${(totalSize / 1024 / 1024).toFixed(0)} MiB, sha256=${checksum}`);

  const { uploadId, chunkCount } = await createSession(baseUrl, filename, totalSize, checksum);
  console.log(`  session ${uploadId}: ${chunkCount} chunks`);

  const fd = fs.openSync(filePath, 'r');
  const uploadStart = Date.now();
  await uploadIndices(baseUrl, uploadId, fd, totalSize, Array.from({ length: chunkCount }, (_, i) => i), concurrency);
  fs.closeSync(fd);
  const uploadSecs = (Date.now() - uploadStart) / 1000;
  console.log(`  uploaded ${chunkCount} chunks in ${uploadSecs.toFixed(1)}s (${(totalSize / 1024 / 1024 / uploadSecs).toFixed(1)} MiB/s)`);

  const completeResult = await completeUpload(baseUrl, uploadId);
  assert(completeResult.ok, `complete failed: ${completeResult.status} ${JSON.stringify(completeResult.body)}`);
  assert(completeResult.body.state === 'COMPLETE', `expected COMPLETE, got ${completeResult.body.state}`);
  console.log('  Assembly + whole-file checksum verified server-side');

  return { uploadId, totalSize, checksum, chunkCount };
}

async function downloadBig(filePath, { uploadId, totalSize, checksum, chunkCount }) {
  const downloadPath = filePath + '.downloaded';
  const downloadStart = Date.now();
  const { etag: parallelEtag } = await downloadFileParallel(baseUrl, uploadId, totalSize, downloadPath, concurrency);
  const downloadSecs = (Date.now() - downloadStart) / 1000;
  console.log(`  downloaded ${chunkCount} ranges in ${downloadSecs.toFixed(1)}s (${(totalSize / 1024 / 1024 / downloadSecs).toFixed(1)} MiB/s)`);
  assert(parallelEtag === `"${checksum}"`, `parallel download ETag mismatch: ${parallelEtag}`);

  const downloadedChecksum = await sha256OfFile(downloadPath);
  assert(downloadedChecksum === checksum, `downloaded file checksum ${downloadedChecksum} != uploaded ${checksum}`);
  console.log('  downloaded file SHA-256 matches uploaded file');
  fs.unlinkSync(downloadPath);
}

async function pauseResume(filePath) {
  const stat = fs.statSync(filePath);
  const totalSize = stat.size;
  const filename = path.basename(filePath);
  const checksum = await sha256OfFile(filePath);
  const { uploadId, chunkCount } = await createSession(baseUrl, filename, totalSize, checksum);
  assert(chunkCount >= 4, 'need at least 4 chunks to exercise a partial upload');

  const firstBatch = Array.from({ length: Math.floor(chunkCount * 0.4) }, (_, i) => i);
  const fd = fs.openSync(filePath, 'r');
  await uploadIndices(baseUrl, uploadId, fd, totalSize, firstBatch, concurrency);
  console.log(`  uploaded ${firstBatch.length}/${chunkCount} chunks, then "walked away"`);

  // New phase: as if a fresh client session resumed later, querying server state
  // rather than trusting local memory of what was sent.
  const status = await getStatus(baseUrl, uploadId);
  assert(status.state === 'UPLOADING', `expected still UPLOADING, got ${status.state}`);
  const received = new Set(status.receivedChunks);
  assert(received.size === firstBatch.length, `server reports ${received.size} received, expected ${firstBatch.length}`);

  const remaining = Array.from({ length: chunkCount }, (_, i) => i).filter((i) => !received.has(i));
  console.log(`  resuming: ${remaining.length} chunks remaining per server-reported bitset`);
  await uploadIndices(baseUrl, uploadId, fd, totalSize, remaining, concurrency);
  fs.closeSync(fd);

  const finalStatus = await getStatus(baseUrl, uploadId);
  assert(finalStatus.receivedChunks.length === chunkCount, 'not all chunks received after resume');

  const completeResult = await completeUpload(baseUrl, uploadId);
  assert(completeResult.ok && completeResult.body.state === 'COMPLETE', `resume did not reach COMPLETE: ${JSON.stringify(completeResult.body)}`);
  console.log('  resumed upload completed and verified');
}

async function networkInterruption(filePath) {
  const stat = fs.statSync(filePath);
  const totalSize = stat.size;
  const filename = path.basename(filePath);
  const checksum = await sha256OfFile(filePath);
  const { uploadId, chunkCount } = await createSession(baseUrl, filename, totalSize, checksum);

  const fd = fs.openSync(filePath, 'r');
  const { readChunk } = require('./lib');

  // Chunk 0: abort the in-flight PUT partway through (simulating a dropped connection),
  // then retry the same chunk — mirrors the client's existing retry-on-failure path.
  const buf0 = readChunk(fd, 0, totalSize);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5);
  let aborted = false;
  try {
    await putChunkRaw(baseUrl, uploadId, 0, buf0, undefined, controller.signal);
  } catch (err) {
    aborted = err.name === 'AbortError' || /abort/i.test(String(err.message));
  }
  assert(aborted, 'expected the interrupted request to abort');

  const statusAfterAbort = await getStatus(baseUrl, uploadId);
  assert(!statusAfterAbort.receivedChunks.includes(0), 'aborted chunk should not be marked received');

  const retryRes = await putChunkRaw(baseUrl, uploadId, 0, buf0);
  assert(retryRes.ok, `retry after interruption failed: ${retryRes.status}`);
  console.log('  chunk 0 recovered after simulated network interruption + retry');

  const rest = Array.from({ length: chunkCount }, (_, i) => i).filter((i) => i !== 0);
  await uploadIndices(baseUrl, uploadId, fd, totalSize, rest, concurrency);
  fs.closeSync(fd);

  const completeResult = await completeUpload(baseUrl, uploadId);
  assert(completeResult.ok && completeResult.body.state === 'COMPLETE', `did not reach COMPLETE: ${JSON.stringify(completeResult.body)}`);
  console.log('  upload completed after recovering from the interruption');
}

async function chunkChecksumMismatchRetry(filePath) {
  const stat = fs.statSync(filePath);
  const totalSize = stat.size;
  const filename = path.basename(filePath);
  const checksum = await sha256OfFile(filePath);
  const { uploadId, chunkCount } = await createSession(baseUrl, filename, totalSize, checksum);

  const fd = fs.openSync(filePath, 'r');
  const { readChunk } = require('./lib');
  const buf0 = readChunk(fd, 0, totalSize);

  const badRes = await putChunkRaw(baseUrl, uploadId, 0, buf0, 'deadbeef');
  assert(!badRes.ok, `expected corrupted-checksum PUT to be rejected, got ${badRes.status}`);
  assert(badRes.status === 400 || badRes.status === 409 || badRes.status === 422, `expected a 4xx rejection, got ${badRes.status}`);

  const statusAfterBad = await getStatus(baseUrl, uploadId);
  assert(!statusAfterBad.receivedChunks.includes(0), 'chunk with bad checksum must not be marked received');
  console.log(`  chunk 0 with corrupted CRC32C rejected (HTTP ${badRes.status}), not marked received`);

  const goodRes = await putChunkRaw(baseUrl, uploadId, 0, buf0);
  assert(goodRes.ok, `retry with correct checksum failed: ${goodRes.status}`);
  console.log('  chunk 0 retried with correct CRC32C, accepted');

  const rest = Array.from({ length: chunkCount }, (_, i) => i).filter((i) => i !== 0);
  await uploadIndices(baseUrl, uploadId, fd, totalSize, rest, concurrency);
  fs.closeSync(fd);

  const completeResult = await completeUpload(baseUrl, uploadId);
  assert(completeResult.ok && completeResult.body.state === 'COMPLETE', `did not reach COMPLETE: ${JSON.stringify(completeResult.body)}`);
  console.log('  upload completed after the checksum-mismatch retry');
}

async function wholeFileChecksumMismatchIsTerminal(filePath) {
  const stat = fs.statSync(filePath);
  const totalSize = stat.size;
  const filename = path.basename(filePath);
  const realChecksum = await sha256OfFile(filePath);
  const wrongChecksum = (realChecksum[0] === '0' ? '1' : '0') + realChecksum.slice(1);

  const { uploadId, chunkCount } = await createSession(baseUrl, filename, totalSize, wrongChecksum);
  const fd = fs.openSync(filePath, 'r');
  await uploadIndices(baseUrl, uploadId, fd, totalSize, Array.from({ length: chunkCount }, (_, i) => i), concurrency);

  const completeResult = await completeUpload(baseUrl, uploadId);
  assert(completeResult.ok, `complete call itself should succeed (200), got ${completeResult.status}`);
  assert(completeResult.body.state === 'FAILED', `expected FAILED on manifest/actual checksum mismatch, got ${completeResult.body.state}`);
  console.log('  whole-file checksum mismatch correctly reached terminal FAILED state');

  // Per issue #3/#4's decided protocol, FAILED is terminal - not retryable in place.
  const retryCompleteRes = await fetch(`${baseUrl}/uploads/${uploadId}/complete`, { method: 'POST' });
  assert(!retryCompleteRes.ok, `re-completing a FAILED session should be rejected, got ${retryCompleteRes.status}`);
  console.log(`  re-POSTing /complete on the FAILED session correctly rejected (HTTP ${retryCompleteRes.status}), confirming it is not retryable in place`);

  // The documented recovery path: start a fresh session with the correct checksum.
  const retry = await createSession(baseUrl, filename, totalSize, realChecksum);
  await uploadIndices(baseUrl, retry.uploadId, fd, totalSize, Array.from({ length: retry.chunkCount }, (_, i) => i), concurrency);
  fs.closeSync(fd);
  const retryComplete = await completeUpload(baseUrl, retry.uploadId);
  assert(retryComplete.ok && retryComplete.body.state === 'COMPLETE', `fresh session did not complete: ${JSON.stringify(retryComplete.body)}`);
  console.log('  fresh session (new Upload Id) with the correct checksum completed successfully');
}

// `--phase` splits a multi-GB run across several process invocations (each with its own
// wall-clock budget) instead of one long-lived process: big-upload, big-download,
// rest (the four smaller behavioral tests + range edge cases on a small file), or
// all (everything in one process - fine at small/local scale).
const phase = getArg('phase', 'all');
const statePath = path.join(workDir, 'big-session-state.json');

async function main() {
  fs.mkdirSync(workDir, { recursive: true });
  console.log(`Target: ${baseUrl}`);
  console.log(`Work dir: ${workDir}`);
  console.log(`Phase: ${phase}`);

  const bigPath = path.join(workDir, `big-${bigSizeMb}mb.bin`);
  const smallPath = path.join(workDir, `small-${smallSizeMb}mb.bin`);

  if (phase === 'big-upload' || phase === 'all') {
    if (!fs.existsSync(bigPath) || fs.statSync(bigPath).size !== bigSizeMb * 1024 * 1024) {
      console.log(`Generating ${bigSizeMb} MiB synthetic file...`);
      generateFile(bigPath, bigSizeMb);
    }
  }
  if (phase === 'rest' || phase === 'all') {
    if (!fs.existsSync(smallPath) || fs.statSync(smallPath).size !== smallSizeMb * 1024 * 1024) {
      console.log(`Generating ${smallSizeMb} MiB synthetic file...`);
      generateFile(smallPath, smallSizeMb);
    }
  }

  if (phase === 'big-upload') {
    let state;
    await test(`upload+Assembly (${bigSizeMb} MiB)`, async () => {
      state = await uploadBig(bigPath);
    });
    if (state) fs.writeFileSync(statePath, JSON.stringify(state));
  } else if (phase === 'big-download') {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    await test(`download+verify (${bigSizeMb} MiB)`, () => downloadBig(bigPath, state));
  } else if (phase === 'rest') {
    let smallState;
    await test('small upload+download round trip + Range/If-Range edge cases', async () => {
      smallState = await uploadBig(smallPath);
      await downloadBig(smallPath, smallState);
      await rangeEdgeCases(smallState.uploadId, smallState.checksum);
    });
    await test('pause and resume mid-upload', () => pauseResume(smallPath));
    await test('recover from a simulated network interruption', () => networkInterruption(smallPath));
    await test('per-chunk checksum mismatch, then retry', () => chunkChecksumMismatchRetry(smallPath));
    await test('whole-file checksum mismatch is terminal, fresh session recovers', () => wholeFileChecksumMismatchIsTerminal(smallPath));
  } else {
    let bigState;
    await test(`full upload+download round trip (${bigSizeMb} MiB)`, async () => {
      bigState = await uploadBig(bigPath);
      await downloadBig(bigPath, bigState);
    });
    let smallState;
    await test('small file Range/If-Range edge cases', async () => {
      smallState = await uploadBig(smallPath);
      await downloadBig(smallPath, smallState);
      await rangeEdgeCases(smallState.uploadId, smallState.checksum);
    });
    await test('pause and resume mid-upload', () => pauseResume(smallPath));
    await test('recover from a simulated network interruption', () => networkInterruption(smallPath));
    await test('per-chunk checksum mismatch, then retry', () => chunkChecksumMismatchRetry(smallPath));
    await test('whole-file checksum mismatch is terminal, fresh session recovers', () => wholeFileChecksumMismatchIsTerminal(smallPath));
  }

  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? ` — ${r.error}` : ''}`);
  }
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(`\n${failed.length}/${results.length} tests failed`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${results.length} tests passed`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
