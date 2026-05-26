import { deflateSync } from 'node:zlib'

// CRC32 (PNG polynomial), table-driven.
const CRC_TABLE: number[] = (() => {
  const t: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeData), 0)
  return Buffer.concat([len, typeData, crc])
}

/**
 * Encode a raw RGB565 framebuffer into a PNG (8-bit RGB, color type 2).
 *
 * The M5Stack stores its sprite buffer big-endian (high byte first), so each
 * pixel's two bytes are read as `(hi << 8) | lo`. Encoding happens host-side
 * because on-device PNG deflate is unusably slow.
 */
export function rgb565ToPng(rgb565: Buffer, w: number, h: number): Buffer {
  const stride = 1 + w * 3 // 1 filter byte per scanline + RGB888
  const raw = Buffer.alloc(h * stride)
  let o = 0
  for (let y = 0; y < h; y++) {
    raw[o++] = 0 // filter type 0 (none)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 2
      const v = ((rgb565[i] as number) << 8) | (rgb565[i + 1] as number) // big-endian
      const r5 = (v >> 11) & 0x1f
      const g6 = (v >> 5) & 0x3f
      const b5 = v & 0x1f
      raw[o++] = (r5 << 3) | (r5 >> 2)
      raw[o++] = (g6 << 2) | (g6 >> 4)
      raw[o++] = (b5 << 3) | (b5 >> 2)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
