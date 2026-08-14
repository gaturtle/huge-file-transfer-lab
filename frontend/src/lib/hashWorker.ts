// Hash-only worker: receives ArrayBuffers, returns checksums via postMessage.
// Networking stays on the main thread (issue #6) so multi-GB hashing never blocks render.
import { crc32cHex } from './crc32c'
import { Sha256Stream } from './sha256'

export type HashRequest =
  | { kind: 'crc32c'; requestId: number; buffer: ArrayBuffer }
  | { kind: 'sha256-start'; streamId: number }
  | { kind: 'sha256-update'; streamId: number; buffer: ArrayBuffer }
  | { kind: 'sha256-final'; streamId: number; requestId: number }

export type HashResponse = { requestId: number; hex: string }

const sha256Streams = new Map<number, Sha256Stream>()

self.onmessage = (event: MessageEvent<HashRequest>) => {
  const msg = event.data

  if (msg.kind === 'crc32c') {
    const response: HashResponse = { requestId: msg.requestId, hex: crc32cHex(new Uint8Array(msg.buffer)) }
    ;(self as unknown as Worker).postMessage(response)
    return
  }

  if (msg.kind === 'sha256-start') {
    sha256Streams.set(msg.streamId, new Sha256Stream())
    return
  }

  if (msg.kind === 'sha256-update') {
    sha256Streams.get(msg.streamId)?.update(new Uint8Array(msg.buffer))
    return
  }

  if (msg.kind === 'sha256-final') {
    const stream = sha256Streams.get(msg.streamId)
    sha256Streams.delete(msg.streamId)
    const hex = stream?.digestHex() ?? ''
    const response: HashResponse = { requestId: msg.requestId, hex }
    ;(self as unknown as Worker).postMessage(response)
  }
}
