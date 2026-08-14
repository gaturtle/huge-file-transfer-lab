// Thin wrapper over the backend's chunk upload/download API (issue #3, #5). Same-origin,
// unprefixed /uploads routes — nginx proxies them straight through (issue #8).

export type UploadState = 'UPLOADING' | 'ASSEMBLING' | 'COMPLETE' | 'FAILED'

export interface CreateUploadResponse {
  uploadId: string
  chunkSize: number
  chunkCount: number
}

export interface UploadStatusResponse {
  state: UploadState
  chunkCount: number
  receivedChunks: number[]
}

export interface ApiErrorInfo {
  status: number
  message: string
}

export class ApiError extends Error implements ApiErrorInfo {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function checkOk(response: Response): Promise<Response> {
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText)
    throw new ApiError(response.status, message || response.statusText)
  }
  return response
}

export async function createUpload(filename: string, totalSize: number, checksum: string): Promise<CreateUploadResponse> {
  const response = await fetch('/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, totalSize, checksum }),
  })
  return checkOk(response).then((r) => r.json())
}

export async function getUploadStatus(uploadId: string, signal?: AbortSignal): Promise<UploadStatusResponse> {
  const response = await fetch(`/uploads/${uploadId}`, { signal })
  return checkOk(response).then((r) => r.json())
}

export async function putChunk(
  uploadId: string,
  index: number,
  bytes: ArrayBuffer,
  crc32cHex: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/uploads/${uploadId}/chunks/${index}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Chunk-Checksum': crc32cHex,
    },
    body: bytes,
    signal,
  })
  await checkOk(response)
}

export async function completeUpload(uploadId: string): Promise<UploadStatusResponse> {
  const response = await fetch(`/uploads/${uploadId}/complete`, { method: 'POST' })
  return checkOk(response).then((r) => r.json())
}

/**
 * The status endpoint doesn't carry totalSize (issue #3's Manifest shape), so the download
 * side discovers it from the Content-Range header of a minimal 1-byte Range request instead
 * of adding a field to the upload-side contract.
 */
export async function getDownloadTotalSize(uploadId: string): Promise<number> {
  const response = await fetch(`/uploads/${uploadId}/download`, { headers: { Range: 'bytes=0-0' } })
  await checkOk(response)
  const contentRange = response.headers.get('Content-Range')
  const total = contentRange?.split('/')[1]
  if (!total) throw new ApiError(response.status, 'Server did not return Content-Range')
  return Number(total)
}

export interface RangeResult {
  bytes: ArrayBuffer
  etag: string | null
}

export async function getRange(uploadId: string, start: number, end: number, signal?: AbortSignal): Promise<RangeResult> {
  const response = await fetch(`/uploads/${uploadId}/download`, {
    headers: { Range: `bytes=${start}-${end}` },
    signal,
  })
  await checkOk(response)
  return { bytes: await response.arrayBuffer(), etag: response.headers.get('ETag') }
}
