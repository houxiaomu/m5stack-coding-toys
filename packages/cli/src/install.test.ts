import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeInstallPatch, computeUninstall } from './install.js'

function fakeHome(): string {
  return mkdtempSync(resolve(tmpdir(), 'm5ct-cli-'))
}

describe('install patch', () => {
  it('proposes a statusLine command when settings.json absent', () => {
    const home = fakeHome()
    const patch = computeInstallPatch(home)
    expect(patch.added.length).toBe(1)
    expect(patch.added[0]).toEqual({ field: 'statusLine', command: 'm5ct-statusline' })
    const statusLine = patch.after.statusLine as Record<string, unknown>
    expect(statusLine).toEqual({ type: 'command', command: 'm5ct-statusline', padding: 0 })
  })

  it('preserves existing unrelated settings', () => {
    const home = fakeHome()
    mkdirSync(resolve(home, '.claude'), { recursive: true })
    const existing = { model: 'opus', env: { FOO: 'bar' } }
    writeFileSync(resolve(home, '.claude/settings.json'), JSON.stringify(existing))
    const patch = computeInstallPatch(home)
    expect(patch.after.model).toBe('opus')
    expect(patch.after.env).toEqual({ FOO: 'bar' })
    const statusLine = patch.after.statusLine as Record<string, unknown>
    expect(statusLine.command).toBe('m5ct-statusline')
  })

  it('is idempotent: no change if statusLine already points at m5ct-statusline', () => {
    const home = fakeHome()
    mkdirSync(resolve(home, '.claude'), { recursive: true })
    const existing = {
      statusLine: { type: 'command', command: 'm5ct-statusline', padding: 0 },
    }
    writeFileSync(resolve(home, '.claude/settings.json'), JSON.stringify(existing))
    const patch = computeInstallPatch(home)
    expect(patch.added.length).toBe(0)
  })

  it('chains an existing third-party statusLine instead of clobbering it', () => {
    const home = fakeHome()
    mkdirSync(resolve(home, '.claude'), { recursive: true })
    writeFileSync(
      resolve(home, '.claude/settings.json'),
      JSON.stringify({ statusLine: { type: 'command', command: 'npx -y ccstatusline@latest' } }),
    )
    const patch = computeInstallPatch(home)
    const statusLine = patch.after.statusLine as Record<string, unknown>
    expect(statusLine.command).toBe('m5ct-statusline')
    expect(patch.chainedCommand).toBe('npx -y ccstatusline@latest')
  })

  it('does not chain when the existing statusLine is already m5ct', () => {
    const home = fakeHome()
    mkdirSync(resolve(home, '.claude'), { recursive: true })
    writeFileSync(
      resolve(home, '.claude/settings.json'),
      JSON.stringify({ statusLine: { type: 'command', command: 'm5ct-statusline' } }),
    )
    const patch = computeInstallPatch(home)
    expect(patch.added.length).toBe(0)
    expect(patch.chainedCommand).toBeUndefined()
  })
})

describe('uninstall', () => {
  it('removes m5ct statusLine and restores the chained command', () => {
    const home = fakeHome()
    mkdirSync(resolve(home, '.claude'), { recursive: true })
    writeFileSync(
      resolve(home, '.claude/settings.json'),
      JSON.stringify({ statusLine: { type: 'command', command: 'm5ct-statusline', padding: 0 } }),
    )
    const u = computeUninstall(home, 'npx -y ccstatusline@latest')
    const sl = u.after.statusLine as Record<string, unknown>
    expect(sl.command).toBe('npx -y ccstatusline@latest')
  })

  it('drops statusLine entirely when nothing was chained', () => {
    const home = fakeHome()
    mkdirSync(resolve(home, '.claude'), { recursive: true })
    writeFileSync(
      resolve(home, '.claude/settings.json'),
      JSON.stringify({
        statusLine: { type: 'command', command: 'm5ct-statusline' },
        model: 'opus',
      }),
    )
    const u = computeUninstall(home, undefined)
    expect(u.after.statusLine).toBeUndefined()
    expect(u.after.model).toBe('opus')
  })
})
