// CRC32C (Castagnoli), matching java.util.zip.CRC32C: init 0xFFFFFFFF, final XOR 0xFFFFFFFF.
'use strict';

const POLY = 0x82f63b78; // reversed polynomial

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (POLY ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32c(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function crc32cHex(buf) {
  return crc32c(buf).toString(16).padStart(8, '0');
}

module.exports = { crc32c, crc32cHex };
