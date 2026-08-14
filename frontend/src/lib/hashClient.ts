import type { HashRequest, HashResponse } from './hashWorker'

let worker: Worker | null = null
let nextRequestId = 1
let nextStreamId = 1
const pending = new Map<number, (hex: string) => void>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./hashWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<HashResponse>) => {
      const resolve = pending.get(event.data.requestId)
      if (resolve) {
        pending.delete(event.data.requestId)
        resolve(event.data.hex)
      }
    }
  }
  return worker
}

function send(request: HashRequest, transfer: Transferable[] = []): void {
  getWorker().postMessage(request, transfer)
}

/** CRC32C over a single chunk's bytes — one-shot. */
export function hashChunkCrc32c(buffer: ArrayBuffer): Promise<string> {
  const requestId = nextRequestId++
  return new Promise((resolve) => {
    pending.set(requestId, resolve)
    send({ kind: 'crc32c', requestId, buffer }, [buffer])
  })
}

/** Incremental whole-file SHA-256: start(), update() per slice (in order), then final(). */
export class Sha256StreamClient {
  private readonly streamId = nextStreamId++

  start(): void {
    send({ kind: 'sha256-start', streamId: this.streamId })
  }

  update(buffer: ArrayBuffer): void {
    send({ kind: 'sha256-update', streamId: this.streamId, buffer }, [buffer])
  }

  final(): Promise<string> {
    const requestId = nextRequestId++
    return new Promise((resolve) => {
      pending.set(requestId, resolve)
      send({ kind: 'sha256-final', streamId: this.streamId, requestId })
    })
  }
}
