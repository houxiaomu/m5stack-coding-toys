import { describe, expect, it } from 'vitest'
import { FIRMWARE_INDEX, resolveFirmware } from './firmware-index.js'

describe('resolveFirmware', () => {
  it('resolves the pinned default version for a known board', () => {
    const e = resolveFirmware('cores3-se')
    expect(e.board).toBe('cores3-se')
    expect(e.version).toBe('0.3.1')
    expect(e.files.length).toBe(3)
    for (const f of e.files) {
      expect(f.url).toMatch(/^https:\/\//)
      expect(f.url).toContain('/fw-cores3-se-0.3.1/')
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(typeof f.offset).toBe('number')
    }
  })

  it('throws for an unknown board', () => {
    expect(() => resolveFirmware('no-such-board')).toThrow(/unknown board/)
  })

  it('throws for an unknown version', () => {
    expect(() => resolveFirmware('cores3-se', '0.0.0-nope')).toThrow(/version/)
  })

  it('index entries carry a fw version string', () => {
    expect(FIRMWARE_INDEX['cores3-se'].defaultVersion).toMatch(/\d+\.\d+\.\d+/)
  })
})
