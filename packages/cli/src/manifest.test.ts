import { describe, expect, it } from 'vitest'
import { parseManifest } from './manifest.js'

const VALID = JSON.stringify({
  board: 'cores3-se',
  fw_version: '0.4.0',
  chip: 'esp32s3',
  flash_size: '8MB',
  files: [
    { path: 'bootloader.bin', offset: '0x0' },
    { path: 'partitions.bin', offset: '0x8000' },
    { path: 'firmware.bin', offset: '0x10000' },
  ],
  sha256: {
    'bootloader.bin': 'a'.repeat(64),
    'partitions.bin': 'b'.repeat(64),
    'firmware.bin': 'c'.repeat(64),
  },
  built_at: '2026-05-30T10:28:31Z',
})

describe('parseManifest', () => {
  it('parses board/version and converts hex offsets to numbers', () => {
    const m = parseManifest(VALID)
    expect(m.board).toBe('cores3-se')
    expect(m.version).toBe('0.4.0')
    expect(m.files.map((f) => f.offset)).toEqual([0x0, 0x8000, 0x10000])
    expect(m.files.map((f) => f.name)).toEqual(['bootloader.bin', 'partitions.bin', 'firmware.bin'])
  })

  it('merges the sha256 dictionary into each file', () => {
    const m = parseManifest(VALID)
    expect(m.files[0].sha256).toBe('a'.repeat(64))
    expect(m.files[2].sha256).toBe('c'.repeat(64))
  })

  it('throws on invalid json', () => {
    expect(() => parseManifest('{not json')).toThrow(/invalid manifest/)
  })

  it('throws when board is missing', () => {
    const bad = JSON.stringify({ fw_version: '1.0.0', files: [{ path: 'a.bin', offset: '0x0' }] })
    expect(() => parseManifest(bad)).toThrow(/board/)
  })

  it('throws when files is empty', () => {
    const bad = JSON.stringify({ board: 'x', fw_version: '1.0.0', files: [] })
    expect(() => parseManifest(bad)).toThrow(/files/)
  })

  it('throws when an offset is not a 0x-prefixed hex string', () => {
    const bad = JSON.stringify({
      board: 'x',
      fw_version: '1.0.0',
      files: [{ path: 'a.bin', offset: '65536' }],
    })
    expect(() => parseManifest(bad)).toThrow(/offset/)
  })

  it('throws when a sha256 value is not 64 hex chars', () => {
    const bad = JSON.stringify({
      board: 'x',
      fw_version: '1.0.0',
      files: [{ path: 'a.bin', offset: '0x0' }],
      sha256: { 'a.bin': 'short' },
    })
    expect(() => parseManifest(bad)).toThrow(/sha256/)
  })

  it('allows a manifest without a sha256 dictionary', () => {
    const noSha = JSON.stringify({
      board: 'x',
      fw_version: '1.0.0',
      files: [{ path: 'a.bin', offset: '0x10000' }],
    })
    const m = parseManifest(noSha)
    expect(m.files[0].sha256).toBeUndefined()
    expect(m.files[0].offset).toBe(0x10000)
  })
})
