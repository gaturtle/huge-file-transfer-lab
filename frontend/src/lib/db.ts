import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

// Mirrors the server's per-session received-chunks bitset (issue #4) so resume state
// survives a browser restart without re-asking the server for anything but confirmation.
export interface UploadRecord {
  uploadId: string
  filename: string
  size: number
  chunkCount: number
  receivedChunks: number[]
}

// Mirrors the upload record's shape (issue #5): a received-ranges bitset plus the
// FileSystemFileHandle itself, since it's structured-cloneable and re-permissioned on resume.
export interface DownloadRecord {
  uploadId: string
  filename: string
  size: number
  chunkCount: number
  receivedChunks: number[]
  fileHandle: FileSystemFileHandle
}

interface TransferDB extends DBSchema {
  uploads: { key: string; value: UploadRecord }
  downloads: { key: string; value: DownloadRecord }
}

let dbPromise: Promise<IDBPDatabase<TransferDB>> | null = null

function getDb(): Promise<IDBPDatabase<TransferDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TransferDB>('huge-file-transfer', 1, {
      upgrade(db) {
        db.createObjectStore('uploads', { keyPath: 'uploadId' })
        db.createObjectStore('downloads', { keyPath: 'uploadId' })
      },
    })
  }
  return dbPromise
}

export async function findUploadByFile(filename: string, size: number): Promise<UploadRecord | undefined> {
  const db = await getDb()
  const all = await db.getAll('uploads')
  return all.find((record) => record.filename === filename && record.size === size)
}

export async function putUpload(record: UploadRecord): Promise<void> {
  const db = await getDb()
  await db.put('uploads', record)
}

export async function deleteUpload(uploadId: string): Promise<void> {
  const db = await getDb()
  await db.delete('uploads', uploadId)
}

export async function findDownloadByFile(filename: string, size: number): Promise<DownloadRecord | undefined> {
  const db = await getDb()
  const all = await db.getAll('downloads')
  return all.find((record) => record.filename === filename && record.size === size)
}

export async function getDownload(uploadId: string): Promise<DownloadRecord | undefined> {
  const db = await getDb()
  return db.get('downloads', uploadId)
}

export async function putDownload(record: DownloadRecord): Promise<void> {
  const db = await getDb()
  await db.put('downloads', record)
}

export async function deleteDownload(uploadId: string): Promise<void> {
  const db = await getDb()
  await db.delete('downloads', uploadId)
}
