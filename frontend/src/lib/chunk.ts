// Mirrors backend/.../upload/ChunkConstants.java — one chunk-size concept app-wide,
// reused for download Range Requests (issue #5).
export const CHUNK_SIZE = 8 * 1024 * 1024

export function chunkCountFor(totalSize: number): number {
  if (totalSize <= 0) return 0
  return Math.ceil(totalSize / CHUNK_SIZE)
}

export function offsetFor(index: number): number {
  return index * CHUNK_SIZE
}

export function expectedSizeFor(index: number, totalSize: number): number {
  const remaining = totalSize - offsetFor(index)
  return Math.min(CHUNK_SIZE, remaining)
}

// Concurrency ceiling for in-flight chunk PUTs / Range GETs (issues #3, #5).
export const CONCURRENCY = 4
