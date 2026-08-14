import { useCallback, useRef, useState } from 'react'
import * as api from '@/lib/api'
import { CHUNK_SIZE, chunkCountFor, expectedSizeFor } from '@/lib/chunk'
import { deleteUpload, findUploadByFile, putUpload, type UploadRecord } from '@/lib/db'
import { hashChunkCrc32c, Sha256StreamClient } from '@/lib/hashClient'
import { useTransfer, type UseTransferResult } from './useTransfer'

export type UploadPhase = 'idle' | 'resume-prompt' | 'hashing' | 'transferring' | 'error'

export interface UseUploadTransferResult {
  phase: UploadPhase
  file: File | null
  hashProgress: number
  error: string | null
  transfer: UseTransferResult
  pickFile: (file: File) => Promise<void>
  resumePrevious: () => Promise<void>
  startNew: () => Promise<void>
}

interface Session {
  uploadId: string
  filename: string
  chunkCount: number
  totalSize: number
  initialReceived: number[]
}

/**
 * Thin upload wrapper over the shared core: Manifest creation (whole-file SHA-256 hashed
 * in the worker before the session opens), then chunk PUTs (issue #6). useTransfer is
 * called unconditionally every render — before a session exists it just has zero units.
 */
export function useUploadTransfer(): UseUploadTransferResult {
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [pendingResume, setPendingResume] = useState<UploadRecord | null>(null)
  const [hashProgress, setHashProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const fileRef = useRef<File | null>(null)

  const transfer = useTransfer({
    chunkCount: session?.chunkCount ?? 0,
    totalSize: session?.totalSize ?? 0,
    unitSize: (index) => expectedSizeFor(index, session?.totalSize ?? 0),
    initialReceived: session?.initialReceived ?? [],
    sendUnit: async (index, signal) => {
      if (!session || !fileRef.current) throw new Error('No active upload session')
      const start = index * CHUNK_SIZE
      const bytes = await fileRef.current.slice(start, start + CHUNK_SIZE).arrayBuffer()
      const crc = await hashChunkCrc32c(bytes.slice(0))
      await api.putChunk(session.uploadId, index, bytes, crc, signal)
    },
    onProgress: (receivedIndices) => {
      if (!session) return
      void putUpload({
        uploadId: session.uploadId,
        filename: session.filename,
        size: session.totalSize,
        chunkCount: session.chunkCount,
        receivedChunks: receivedIndices,
      })
    },
    onComplete: async () => {
      if (!session) return
      await api.completeUpload(session.uploadId)
      await deleteUpload(session.uploadId)
    },
  })

  const beginUpload = useCallback(async (selected: File, resume: UploadRecord | null) => {
    setPhase('hashing')
    setError(null)
    setHashProgress(0)
    try {
      const chunkCount = chunkCountFor(selected.size)
      let uploadId: string
      let initialReceived: number[]

      if (resume) {
        const status = await api.getUploadStatus(resume.uploadId)
        uploadId = resume.uploadId
        initialReceived = status.receivedChunks
      } else {
        const hasher = new Sha256StreamClient()
        hasher.start()
        for (let i = 0; i < chunkCount; i++) {
          const start = i * CHUNK_SIZE
          const bytes = await selected.slice(start, start + CHUNK_SIZE).arrayBuffer()
          hasher.update(bytes)
          setHashProgress((i + 1) / chunkCount)
        }
        const checksum = await hasher.final()
        const created = await api.createUpload(selected.name, selected.size, checksum)
        uploadId = created.uploadId
        initialReceived = []
      }

      const newSession: Session = { uploadId, filename: selected.name, chunkCount, totalSize: selected.size, initialReceived }
      await putUpload({
        uploadId,
        filename: selected.name,
        size: selected.size,
        chunkCount,
        receivedChunks: initialReceived,
      })

      fileRef.current = selected
      setSession(newSession)
      setPhase('transferring')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }, [])

  const pickFile = useCallback(
    async (selected: File) => {
      setFile(selected)
      const existing = await findUploadByFile(selected.name, selected.size)
      if (existing) {
        setPendingResume(existing)
        setPhase('resume-prompt')
      } else {
        setPendingResume(null)
        await beginUpload(selected, null)
      }
    },
    [beginUpload],
  )

  const resumePrevious = useCallback(async () => {
    if (!file || !pendingResume) return
    await beginUpload(file, pendingResume)
  }, [beginUpload, file, pendingResume])

  const startNew = useCallback(async () => {
    if (!file) return
    if (pendingResume) await deleteUpload(pendingResume.uploadId)
    await beginUpload(file, null)
  }, [beginUpload, file, pendingResume])

  // Cancel deletes the local IndexedDB record too (issue #6); the server session is left
  // for the existing 24h TTL sweep to reclaim rather than adding a cancel endpoint.
  const cancel = useCallback(() => {
    transfer.cancel()
    if (session) void deleteUpload(session.uploadId)
    setSession(null)
    fileRef.current = null
    setFile(null)
    setPhase('idle')
  }, [session, transfer])

  return { phase, file, hashProgress, error, transfer: { ...transfer, cancel }, pickFile, resumePrevious, startNew }
}
