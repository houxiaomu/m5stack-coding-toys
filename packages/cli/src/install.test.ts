import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  computeHooksPatch,
  computeHooksUninstall,
  computeInstallPatch,
  computeUninstall,
} from './install.js'

function fakeHome(): string {
  return mkdtempSync(resolve(tmpdir(), 'm5ct-cli-'))
}

describe('install patch', () => {
  it('proposes a statusLine command when settings.json absent', () => {
    const home = fakeHome()
    const patch = computeInstallPatch(home)
    // statusLine + one entry per hook event (UserPromptSubmit, Stop, Notification)
    expect(patch.added.length).toBe(4)
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
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'm5ct-statusline --event UserPromptSubmit' }] },
        ],
        Stop: [{ hooks: [{ type: 'command', command: 'm5ct-statusline --event Stop' }] }],
        Notification: [
          { hooks: [{ type: 'command', command: 'm5ct-statusline --event Notification' }] },
        ],
      },
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
      JSON.stringify({
        statusLine: { type: 'command', command: 'm5ct-statusline' },
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: 'command', command: 'm5ct-statusline --event UserPromptSubmit' }] },
          ],
          Stop: [{ hooks: [{ type: 'command', command: 'm5ct-statusline --event Stop' }] }],
          Notification: [
            { hooks: [{ type: 'command', command: 'm5ct-statusline --event Notification' }] },
          ],
        },
      }),
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

describe('hooks patch', () => {
  const events = ['UserPromptSubmit', 'Stop', 'Notification']

  it('adds a hook group per event when none exist', () => {
    const after = computeHooksPatch({}, 'm5ct-statusline')
    for (const ev of events) {
      const groups = after[ev] as Array<{ hooks: Array<{ command: string }> }>
      expect(groups[0].hooks[0].command).toBe(`m5ct-statusline --event ${ev}`)
    }
  })

  it('preserves existing hook groups for the same event', () => {
    const before = { Stop: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] }
    const after = computeHooksPatch(before, 'm5ct-statusline') as Record<string, unknown[]>
    const stop = after.Stop as Array<{ hooks: Array<{ command: string }> }>
    expect(stop.some((g) => g.hooks[0].command === 'other-tool')).toBe(true)
    expect(stop.some((g) => g.hooks[0].command === 'm5ct-statusline --event Stop')).toBe(true)
  })

  it('is idempotent: does not duplicate our group', () => {
    const once = computeHooksPatch({}, 'm5ct-statusline')
    const twice = computeHooksPatch(once, 'm5ct-statusline') as Record<string, unknown[]>
    expect((twice.Stop as unknown[]).length).toBe(1)
  })

  it('uninstall removes only our hook groups', () => {
    const before = {
      Stop: [
        { hooks: [{ type: 'command', command: 'other-tool' }] },
        { hooks: [{ type: 'command', command: 'm5ct-statusline --event Stop' }] },
      ],
    }
    const after = computeHooksUninstall(before, 'm5ct-statusline') as Record<string, unknown[]>
    const stop = after.Stop as Array<{ hooks: Array<{ command: string }> }>
    expect(stop.length).toBe(1)
    expect(stop[0].hooks[0].command).toBe('other-tool')
  })

  it('uninstall drops an event key left empty', () => {
    const before = {
      Notification: [{ hooks: [{ type: 'command', command: 'm5ct-statusline --event Notification' }] }],
    }
    const after = computeHooksUninstall(before, 'm5ct-statusline') as Record<string, unknown>
    expect(after.Notification).toBeUndefined()
  })
})
