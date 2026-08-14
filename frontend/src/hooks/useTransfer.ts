import { useCallback, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CONCURRENCY } from '@/lib/chunk'

export type TransferStatus = 'idle' | 'transferring' | 'paused' | 'completed' | 'error'

export interface UseTransferOptions {
  chunkCount: number
  totalSize: number
  /** Bytes of a given unit index — the whole-file total for the last, possibly-short, unit. */
  unitSize: (index: number) => number
  /** Chunk indices already confirmed (resume). */
  initialReceived: number[]
  /** Send/fetch one unit (PUT chunk or Range GET). Rejects (incl. on abort) to signal failure. */
  sendUnit: (index: number, signal: AbortSignal) => Promise<void>
  /** Called after each unit completes, with the full up-to-date received-index list, to persist resume state. */
  onProgress?: (receivedIndices: number[]) => void
  /** Called once when every unit has been confirmed received. */
  onComplete?: () => void | Promise<void>
}

export interface UseTransferResult {
  status: TransferStatus
  receivedCount: number
  bytesTransferred: number
  totalSize: number
  progress: number
  error: string | null
  start: () => void
  pause: () => void
  cancel: () => void
}

/**
 * Shared core: bitset, byte progress, pause/cancel, retry, and a small concurrency-queue
 * pool — parameterized by how to send one unit. useUploadTransfer/useDownloadTransfer supply
 * the upload- vs download-specific sendUnit (issue #6).
 */
export function useTransfer(options: UseTransferOptions): UseTransferResult {
  const { chunkCount, totalSize, unitSize, initialReceived, sendUnit, onProgress, onComplete } = options

  const receivedRef = useRef<Set<number>>(new Set(initialReceived))
  const [status, setStatus] = useState<TransferStatus>('idle')
  const [receivedCount, setReceivedCount] = useState(receivedRef.current.size)
  const [error, setError] = useState<string | null>(null)

  const controllersRef = useRef<Map<number, AbortController>>(new Map())
  const runIdRef = useRef(0)

  const mutation = useMutation({
    mutationFn: ({ index, signal }: { index: number; signal: AbortSignal }) => sendUnit(index, signal),
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  })

  const bytesTransferred = Array.from(receivedRef.current).reduce((sum, i) => sum + unitSize(i), 0)
  const progress = totalSize > 0 ? bytesTransferred / totalSize : 0

  const runPool = useCallback(
    (runId: number) => {
      const pending: number[] = []
      for (let i = 0; i < chunkCount; i++) {
        if (!receivedRef.current.has(i)) pending.push(i)
      }
      if (pending.length === 0) {
        setStatus('completed')
        void onComplete?.()
        return
      }

      let cursor = 0
      let inFlight = 0
      let stopped = false

      const settleOne = () => {
        inFlight--
        if (stopped) return
        if (receivedRef.current.size === chunkCount) {
          setStatus('completed')
          void onComplete?.()
          return
        }
        pump()
      }

      const pump = () => {
        if (runId !== runIdRef.current) return
        while (inFlight < CONCURRENCY && cursor < pending.length) {
          const index = pending[cursor++]
          if (receivedRef.current.has(index)) continue
          inFlight++
          const controller = new AbortController()
          controllersRef.current.set(index, controller)

          mutation
            .mutateAsync({ index, signal: controller.signal })
            .then(() => {
              controllersRef.current.delete(index)
              if (runId !== runIdRef.current) return
              receivedRef.current.add(index)
              setReceivedCount(receivedRef.current.size)
              onProgress?.(Array.from(receivedRef.current))
              settleOne()
            })
            .catch((err) => {
              controllersRef.current.delete(index)
              if (runId !== runIdRef.current || controller.signal.aborted) {
                settleOne()
                return
              }
              stopped = true
              setStatus('error')
              setError(err instanceof Error ? err.message : String(err))
            })
        }
      }

      pump()
    },
    [chunkCount, mutation, onComplete, onProgress],
  )

  const start = useCallback(() => {
    if (status === 'transferring') return
    setError(null)
    setStatus('transferring')
    runIdRef.current++
    runPool(runIdRef.current)
  }, [runPool, status])

  const pause = useCallback(() => {
    runIdRef.current++
    for (const controller of controllersRef.current.values()) controller.abort()
    controllersRef.current.clear()
    setStatus('paused')
  }, [])

  const cancel = useCallback(() => {
    runIdRef.current++
    for (const controller of controllersRef.current.values()) controller.abort()
    controllersRef.current.clear()
    receivedRef.current = new Set()
    setReceivedCount(0)
    setStatus('idle')
  }, [])

  return {
    status,
    receivedCount,
    bytesTransferred,
    totalSize,
    progress,
    error,
    start,
    pause,
    cancel,
  }
}
