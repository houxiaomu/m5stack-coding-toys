import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeviceProfile } from './device-profile.js'

function buildManifest(dir: string): void {
  mkdirSync(resolve(dir, 'cores3-se'), { recursive: true })
  const bin = Buffer.from('FAKE_FW')
  writeFileSync(resolve(dir, 'cores3-se/firmware.bin'), bin)
  const sha = createHash('sha256').update(bin).digest('hex')
  writeFileSync(
    resolve(dir, 'cores3-se/manifest.json'),
    JSON.stringify({
      board: 'cores3-se',
      fw_version: '0.3.0',
      chip: 'esp32s3',
      files: [{ path: 'firmware.bin', offset: '0x10000' }],
      sha256: { 'firmware.bin': sha },
      built_at: '2026-05-23T12:00:00Z',
    }),
  )
}

describe('DeviceProfile', () => {
  it('returns null when no manifest', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'dp-'))
    const p = new DeviceProfile(dir)
    expect(p.expectedVersion('cores3-se')).toBeNull()
    expect(p.binaries('cores3-se')).toBeNull()
  })

  it('reads manifest and resolves binaries', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'dp-'))
    buildManifest(dir)
    const p = new DeviceProfile(dir)
    expect(p.expectedVersion('cores3-se')).toBe('0.3.0')
    const bins = p.binaries('cores3-se')
    expect(bins).toHaveLength(1)
    expect(bins?.[0]?.offset).toBe(0x10000)
    expect(bins?.[0]?.path.endsWith('firmware.bin')).toBe(true)
  })

  it('computes drift level via semver', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'dp-'))
    buildManifest(dir)
    const p = new DeviceProfile(dir)
    expect(p.driftLevel('cores3-se', '0.3.0')).toBe('none')
    expect(p.driftLevel('cores3-se', '0.2.9')).toBe('patch')
    expect(p.driftLevel('cores3-se', '0.2.0')).toBe('minor')
    expect(p.driftLevel('cores3-se', '0.0.1')).toBe('minor')
    expect(p.driftLevel('cores3-se', '0.4.0')).toBe('none')
  })

  it('throws on sha mismatch', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'dp-'))
    mkdirSync(resolve(dir, 'cores3-se'), { recursive: true })
    writeFileSync(resolve(dir, 'cores3-se/firmware.bin'), 'TAMPERED')
    writeFileSync(
      resolve(dir, 'cores3-se/manifest.json'),
      JSON.stringify({
        board: 'cores3-se',
        fw_version: '0.3.0',
        chip: 'esp32s3',
        files: [{ path: 'firmware.bin', offset: '0x10000' }],
        sha256: { 'firmware.bin': '0'.repeat(64) },
      }),
    )
    expect(() => new DeviceProfile(dir)).toThrow(/sha256 mismatch/)
  })
})
