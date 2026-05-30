import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { FirmwareEntry } from './firmware-index.js'
import { ensureFirmware, sha256 } from './firmware-store.js'

function sha(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function entry(payload: Buffer): { e: FirmwareEntry; cache: string } {
  const cache = mkdtempSync(resolve(tmpdir(), 'm5ct-fw-'))
  const e: FirmwareEntry = {
    board: 'cores3-se',
    version: '0.3.0',
    files: [
      {
        name: 'firmware.bin',
        url: 'https://x/firmware.bin',
        sha256: sha(payload),
        offset: 0x10000,
      },
    ],
  }
  return { e, cache }
}

describe('ensureFirmware', () => {
  it('downloads, verifies sha256, caches, and returns local paths', async () => {
    const payload = Buffer.from('BINDATA')
    const { e, cache } = entry(payload)
    const fetchFn = vi.fn(async () => new Uint8Array(payload))
    const files = await ensureFirmware(e, cache, fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(files[0].offset).toBe(0x10000)
    expect(readFileSync(files[0].path).toString()).toBe('BINDATA')
  })

  it('skips download when a valid cached file already exists', async () => {
    const payload = Buffer.from('BINDATA')
    const { e, cache } = entry(payload)
    const dir = resolve(cache, e.board, e.version)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'firmware.bin'), payload)
    const fetchFn = vi.fn(async () => new Uint8Array(payload))
    await ensureFirmware(e, cache, fetchFn)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('throws when downloaded bytes fail sha256', async () => {
    const { e, cache } = entry(Buffer.from('BINDATA'))
    const fetchFn = vi.fn(async () => new Uint8Array(Buffer.from('CORRUPT')))
    await expect(ensureFirmware(e, cache, fetchFn)).rejects.toThrow(/sha256/)
  })
})

describe('sha256', () => {
  it('hashes bytes to a 64-char hex digest matching node crypto', () => {
    const buf = Buffer.from('BINDATA')
    const expected = createHash('sha256').update(buf).digest('hex')
    expect(sha256(buf)).toBe(expected)
    expect(sha256(buf)).toMatch(/^[0-9a-f]{64}$/)
  })
})
