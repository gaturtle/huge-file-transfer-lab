import { useCallback, useRef, useState } from 'react'
import * as api from '@/lib/api'
import { CHUNK_SIZE, chunkCountFor, expectedSizeFor } from '@/lib/chunk'
import { deleteDownload, getDownload, putDownload, type DownloadRecord } from '@/lib/db'
import { Sha256StreamClient } from '@/lib/hashClient'
import { useTransfer, type UseTransferResult } from './useTransfer'

export type DownloadPhase = 'idle' | 'resume-prompt' | 'preparing' | 'transferring' | 'verifying' | 'verified' | 'mismatch' | 'error'

export interface UseDownloadTransferResult {
  phase: DownloadPhase
  filename: string | null
  error: string | null
  transfer: UseTransferResult
  /** File System Access support, feature-detected once. */
  supported: boolean
  startDownload: (uploadId: string, filename: string) => Promise<void>
  resumePrevious: (uploadId: string) => Promise<void>
  startNew: (uploadId: string, filename: string) => Promise<void>
  findResumable: (uploadId: string) => Promise<DownloadRecord | undefined>
}

interface Session {
  uploadId: string
  filename: string
  chunkCount: number
  totalSize: number
  initialReceived: number[]
  writable: FileSystemWritableFileStream
  fileHandle: FileSystemFileHandle
}

export const fileSystemAccessSupported = (): boolean => 'showSaveFilePicker' in window

/**
 * Thin download wrapper: Range GETs written through one serialized FileSystemWritableFileStream
 * (positional writes — the API has no true concurrent-writer support), then whole-file
 * SHA-256 verification against the server's ETag (issue #5, #6).
 */
export function useDownloadTransfer(): UseDownloadTransferResult {
  const [phase, setPhase] = useState<DownloadPhase>('idle')
  const [filename, setFilename] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const etagRef = useRef<string | null>(null)

  const transfer = useTransfer({
    chunkCount: session?.chunkCount ?? 0,
    totalSize: session?.totalSize ?? 0,
    unitSize: (index) => expectedSizeFor(index, session?.totalSize ?? 0),
    initialReceived: session?.initialReceived ?? [],
    sendUnit: async (index, signal) => {
      if (!session) throw new Error('No active download session')
      const start = index * CHUNK_SIZE
      const end = start + expectedSizeFor(index, session.totalSize) - 1
      const { bytes, etag } = await api.getRange(session.uploadId, start, end, signal)
      if (etag) etagRef.current = etag
      await session.writable.write({ type: 'write', position: start, data: bytes })
    },
    onProgress: (receivedIndices) => {
      if (!session) return
      void putDownload({
        uploadId: session.uploadId,
        filename: session.filename,
        size: session.totalSize,
        chunkCount: session.chunkCount,
        receivedChunks: receivedIndices,
        fileHandle: session.fileHandle,
      })
    },
    onComplete: async () => {
      if (!session) return
      await session.writable.close()
      setPhase('verifying')

      const verifyFile = await session.fileHandle.getFile()
      const hasher = new Sha256StreamClient()
      hasher.start()
      const chunkCount = chunkCountFor(verifyFile.size)
      for (let i = 0; i < chunkCount; i++) {
        const start = i * CHUNK_SIZE
        const bytes = await verifyFile.slice(start, start + CHUNK_SIZE).arrayBuffer()
        hasher.update(bytes)
      }
      const actualHex = await hasher.final()
      const expected = etagRef.current?.replaceAll('"', '') ?? null

      await deleteDownload(session.uploadId)
      setPhase(expected && actualHex === expected ? 'verified' : 'mismatch')
    },
  })

  const openSession = useCallback(
    async (uploadId: string, name: string, totalSize: number, initialReceived: number[], fileHandle: FileSystemFileHandle) => {
      const writable = await fileHandle.createWritable({ keepExistingData: true })
      const chunkCount = chunkCountFor(totalSize)
      setSession({ uploadId, filename: name, chunkCount, totalSize, initialReceived, writable, fileHandle })
      setFilename(name)
      setPhase('transferring')
    },
    [],
  )

  const startDownload = useCallback(
    async (uploadId: string, name: string) => {
      setPhase('preparing')
      setError(null)
      try {
        const totalSize = await api.getDownloadTotalSize(uploadId)
        const fileHandle = await window.showSaveFilePicker({ suggestedName: name })
        await openSession(uploadId, name, totalSize, [], fileHandle)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setPhase('error')
      }
    },
    [openSession],
  )

  const startNew = useCallback(
    async (uploadId: string, name: string) => {
      await deleteDownload(uploadId)
      await startDownload(uploadId, name)
    },
    [startDownload],
  )

  const resumePrevious = useCallback(
    async (uploadId: string) => {
      setPhase('preparing')
      setError(null)
      try {
        const record = await getDownload(uploadId)
        if (!record) throw new Error('No resumable download found')
        const permission = await record.fileHandle.requestPermission({ mode: 'readwrite' })
        if (permission !== 'granted') throw new Error('File permission was not granted')
        await openSession(record.uploadId, record.filename, record.size, record.receivedChunks, record.fileHandle)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setPhase('error')
      }
    },
    [openSession],
  )

  const findResumable = useCallback((uploadId: string) => getDownload(uploadId), [])

  const cancel = useCallback(() => {
    transfer.cancel()
    if (session) void deleteDownload(session.uploadId)
    setSession(null)
    setPhase('idle')
  }, [session, transfer])

  return {
    phase,
    filename,
    error,
    transfer: { ...transfer, cancel },
    supported: fileSystemAccessSupported(),
    startDownload,
    resumePrevious,
    startNew,
    findResumable,
  }
}
