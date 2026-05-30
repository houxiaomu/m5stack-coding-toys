import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FirmwareEntry } from './firmware-index.js'
import { prepareFirmware } from './firmware-source.js'

function sha(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function tmp(): string {
  return mkdtempSync(resolve(tmpdir(), 'm5ct-src-'))
}

const BOOT = Buffer.from('BOOTLOADER')
const PART = Buffer.from('PARTITIONS')
const APP = Buffer.from('FIRMWARE-APP')

function writeTriplet(dir: string): void {
  writeFileSync(resolve(dir, 'bootloader.bin'), BOOT)
  writeFileSync(resolve(dir, 'partitions.bin'), PART)
  writeFileSync(resolve(dir, 'firmware.bin'), APP)
}

function manifest(extra?: Partial<{ badSha: boolean }>): string {
  return JSON.stringify({
    board: 'cores3-se',
    fw_version: '9.9.9',
    files: [
      { path: 'bootloader.bin', offset: '0x0' },
      { path: 'partitions.bin', offset: '0x8000' },
      { path: 'firmware.bin', offset: '0x10000' },
    ],
    sha256: {
      'bootloader.bin': extra?.badSha ? 'd'.repeat(64) : sha(BOOT),
      'partitions.bin': sha(PART),
      'firmware.bin': sha(APP),
    },
  })
}

describe('prepareFirmware local', () => {
  it('reads manifest, verifies sha256, returns parsed offsets and board', async () => {
    const dir = tmp()
    writeTriplet(dir)
    writeFileSync(resolve(dir, 'manifest.json'), manifest())
    const p = await prepareFirmware({ kind: 'local', dir }, tmp())
    expect(p.board).toBe('cores3-se')
    expect(p.version).toBe('9.9.9')
    expect(p.verified).toBe(true)
    expect(p.files.map((f) => f.offset)).toEqual([0x0, 0x8000, 0x10000])
    expect(p.files.map((f) => f.name)).toEqual(['bootloader.bin', 'partitions.bin', 'firmware.bin'])
    expect(p.files[2].size).toBe(APP.length)
    expect(p.sourceLabel).toContain('local')
  })

  it('throws when a file sha256 does not match the manifest', async () => {
    const dir = tmp()
    writeTriplet(dir)
    writeFileSync(resolve(dir, 'manifest.json'), manifest({ badSha: true }))
    await expect(prepareFirmware({ kind: 'local', dir }, tmp())).rejects.toThrow(/sha256/)
  })

  it('falls back to the default triplet layout when no manifest is present', async () => {
    const dir = tmp()
    writeTriplet(dir)
    const p = await prepareFirmware({ kind: 'local', dir }, tmp())
    expect(p.verified).toBe(false)
    expect(p.board).toBeNull()
    expect(p.files.map((f) => [f.name, f.offset])).toEqual([
      ['bootloader.bin', 0x0],
      ['partitions.bin', 0x8000],
      ['firmware.bin', 0x10000],
    ])
  })

  it('throws when no manifest and a triplet file is missing', async () => {
    const dir = tmp()
    writeFileSync(resolve(dir, 'bootloader.bin'), BOOT)
    writeFileSync(resolve(dir, 'partitions.bin'), PART)
    // firmware.bin missing
    await expect(prepareFirmware({ kind: 'local', dir }, tmp())).rejects.toThrow(/missing/)
  })
})

const TEST_BYTES: Record<string, Buffer> = {
  'bootloader.bin': Buffer.from('BOOT-BUILTIN'),
  'partitions.bin': Buffer.from('PART-BUILTIN'),
  'firmware.bin': Buffer.from('APP-BUILTIN'),
}

function resolveFirmwareForTest(): FirmwareEntry {
  return {
    board: 'cores3-se',
    version: '0.0.0-test',
    files: [
      {
        name: 'bootloader.bin',
        url: 'https://x/b.bin',
        sha256: sha(TEST_BYTES['bootloader.bin']),
        offset: 0x0,
      },
      {
        name: 'partitions.bin',
        url: 'https://x/p.bin',
        sha256: sha(TEST_BYTES['partitions.bin']),
        offset: 0x8000,
      },
      {
        name: 'firmware.bin',
        url: 'https://x/f.bin',
        sha256: sha(TEST_BYTES['firmware.bin']),
        offset: 0x10000,
      },
    ],
  }
}

describe('prepareFirmware builtin', () => {
  it('wraps resolveFirmware + ensureFirmware into a verified PreparedFirmware', async () => {
    const cache = mkdtempSync(resolve(tmpdir(), 'm5ct-builtin-'))
    const entry = resolveFirmwareForTest()
    // Seed cache so ensureFirmware finds valid files and never calls fetchFn.
    const dir = resolve(cache, entry.board, entry.version)
    mkdirSync(dir, { recursive: true })
    for (const f of entry.files) {
      writeFileSync(resolve(dir, f.name), TEST_BYTES[f.name])
    }
    const fetchFn = async () => {
      throw new Error('should not fetch when cache is seeded')
    }
    const p = await prepareFirmware({ kind: 'builtin', board: 'cores3-se' }, cache, {
      fetchFn,
      indexEntry: entry,
    })
    expect(p.verified).toBe(true)
    expect(p.board).toBe('cores3-se')
    expect(p.sourceLabel).toBe('builtin')
    expect(p.files.length).toBe(entry.files.length)
  })
})

describe('prepareFirmware remote', () => {
  const MANIFEST_URL = 'https://intra.corp/fw/cores3-se/manifest.json'
  function remoteManifest(badSha?: boolean): string {
    return JSON.stringify({
      board: 'cores3-se',
      fw_version: '0.5.0',
      files: [
        { path: 'bootloader.bin', offset: '0x0' },
        { path: 'partitions.bin', offset: '0x8000' },
        { path: 'firmware.bin', offset: '0x10000' },
      ],
      sha256: {
        'bootloader.bin': badSha ? 'e'.repeat(64) : sha(BOOT),
        'partitions.bin': sha(PART),
        'firmware.bin': sha(APP),
      },
    })
  }
  function remoteFetch(badSha?: boolean) {
    return async (url: string): Promise<Uint8Array> => {
      if (url === MANIFEST_URL) return new TextEncoder().encode(remoteManifest(badSha))
      if (url.endsWith('/bootloader.bin')) return new Uint8Array(BOOT)
      if (url.endsWith('/partitions.bin')) return new Uint8Array(PART)
      if (url.endsWith('/firmware.bin')) return new Uint8Array(APP)
      throw new Error(`unexpected url ${url}`)
    }
  }

  it('fetches manifest, resolves bin URLs relatively, verifies sha, returns prepared', async () => {
    const p = await prepareFirmware(
      { kind: 'remote', manifestUrl: MANIFEST_URL },
      mkdtempSync(resolve(tmpdir(), 'm5ct-remote-')),
      { fetchFn: remoteFetch() },
    )
    expect(p.board).toBe('cores3-se')
    expect(p.version).toBe('0.5.0')
    expect(p.verified).toBe(true)
    expect(p.files.map((f) => f.offset)).toEqual([0x0, 0x8000, 0x10000])
    expect(p.sourceLabel).toContain('remote')
    expect(p.sourceLabel).toContain(MANIFEST_URL)
  })

  it('throws when a downloaded bin fails sha256', async () => {
    await expect(
      prepareFirmware(
        { kind: 'remote', manifestUrl: MANIFEST_URL },
        mkdtempSync(resolve(tmpdir(), 'm5ct-remote-')),
        { fetchFn: remoteFetch(true) },
      ),
    ).rejects.toThrow(/sha256/)
  })
})
