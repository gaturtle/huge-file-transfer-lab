// CRC-32C (Castagnoli), matching java.util.zip.CRC32C used server-side (ADR 0002):
// reversed polynomial 0x82F63B78, init/final XOR 0xFFFFFFFF, reflected in/out.
const POLYNOMIAL = 0x82f63b78

let table: Uint32Array | null = null

function crcTable(): Uint32Array {
  if (table) return table
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ POLYNOMIAL : c >>> 1
    }
    t[n] = c >>> 0
  }
  table = t
  return t
}

export function crc32c(data: Uint8Array): number {
  const t = crcTable()
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = t[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function crc32cHex(data: Uint8Array): string {
  return crc32c(data).toString(16).padStart(8, '0')
}
