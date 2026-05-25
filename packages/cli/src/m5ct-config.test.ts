import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installStatePath, readM5ctConfig, writeM5ctConfig } from './m5ct-config.js'

function home(): string {
  return mkdtempSync(resolve(tmpdir(), 'm5ct-cfg-'))
}

describe('m5ct-config', () => {
  it('returns empty object when file is absent', () => {
    expect(readM5ctConfig(home())).toEqual({})
  })

  it('round-trips chainedStatusLine and creates the dir', () => {
    const h = home()
    writeM5ctConfig(h, { chainedStatusLine: 'npx -y ccstatusline@latest' })
    expect(readM5ctConfig(h)).toEqual({ chainedStatusLine: 'npx -y ccstatusline@latest' })
    expect(installStatePath(h)).toContain('.m5stack-coding-toys')
    expect(installStatePath(h)).toContain('install-state.json')
    expect(existsSync(installStatePath(h))).toBe(true)
  })

  it('merges on write (does not drop unknown keys)', () => {
    const h = home()
    writeM5ctConfig(h, { chainedStatusLine: 'a' })
    writeM5ctConfig(h, { foo: 'bar' } as Record<string, unknown>)
    expect(readM5ctConfig(h)).toEqual({ chainedStatusLine: 'a', foo: 'bar' })
  })

  it('does not read legacy config.json', () => {
    const h = home()
    const legacyPath = resolve(h, '.m5stack-coding-toys', 'config.json')
    mkdirSync(resolve(h, '.m5stack-coding-toys'), { recursive: true })
    writeFileSync(legacyPath, JSON.stringify({ chainedStatusLine: 'legacy' }))
    expect(readM5ctConfig(h)).toEqual({})
  })
})
