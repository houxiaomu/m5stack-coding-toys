import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { rgb565ToPng } from './png.js'

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('rgb565ToPng', () => {
  it('emits a valid PNG signature and IHDR with the given dimensions', () => {
    // 2×1 frame, big-endian rgb565: white (0xFFFF), black (0x0000)
    const png = rgb565ToPng(Buffer.from([0xff, 0xff, 0x00, 0x00]), 2, 1)
    expect([...png.subarray(0, 8)]).toEqual(SIG)
    // IHDR data starts at offset 16 (8 sig + 4 len + 4 'IHDR')
    expect(png.readUInt32BE(16)).toBe(2) // width
    expect(png.readUInt32BE(20)).toBe(1) // height
    expect(png[24]).toBe(8) // bit depth
    expect(png[25]).toBe(2) // color type RGB
  })

  it('decodes back to the expected RGB888 pixels (big-endian rgb565)', () => {
    // pixel0 = 0xF800 (pure red 5-bit), pixel1 = 0x001F (pure blue 5-bit)
    const png = rgb565ToPng(Buffer.from([0xf8, 0x00, 0x00, 0x1f]), 2, 1)
    // Find IDAT and inflate it.
    const idatStart = png.indexOf(Buffer.from('IDAT', 'ascii')) + 4
    const idatLen = png.readUInt32BE(idatStart - 8)
    const raw = inflateSync(png.subarray(idatStart, idatStart + idatLen))
    // scanline: [filter=0][r,g,b][r,g,b]
    expect(raw[0]).toBe(0) // filter none
    expect(raw[1]).toBe(0xff) // red of pixel0 (5→8 bit: 0x1f→0xff)
    expect(raw[2]).toBe(0) // green
    expect(raw[3]).toBe(0) // blue
    expect(raw[4]).toBe(0) // red of pixel1
    expect(raw[5]).toBe(0) // green
    expect(raw[6]).toBe(0xff) // blue of pixel1
  })
})
