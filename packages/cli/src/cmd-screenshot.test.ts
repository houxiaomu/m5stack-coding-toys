import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runScreenshot } from './cmd-screenshot.js'

function io() {
  const logs: string[] = []
  const errs: string[] = []
  return {
    logs,
    errs,
    io: { log: (l: string) => logs.push(l), error: (l: string) => errs.push(l) },
  }
}

describe('runScreenshot', () => {
  it('sends a screenshot op and prints the saved path', async () => {
    const call = vi.fn(async () => ({
      ok: true,
      path: '/home/x/.m5stack-coding-toys/screenshots/a.png',
    }))
    const t = io()
    const code = await runScreenshot([], t.io, { call, socket: '/tmp/s.sock' })
    expect(code).toBe(0)
    expect(call).toHaveBeenCalledWith('/tmp/s.sock', { op: 'screenshot' })
    expect(t.logs[0]).toContain('Saved: /home/x/.m5stack-coding-toys/screenshots/a.png')
  })

  it('resolves -o to an absolute path before sending', async () => {
    const call = vi.fn(async () => ({ ok: true, path: resolve(process.cwd(), 'shot.png') }))
    const t = io()
    const code = await runScreenshot(['-o', 'shot.png'], t.io, { call, socket: '/tmp/s.sock' })
    expect(code).toBe(0)
    expect(call).toHaveBeenCalledWith('/tmp/s.sock', {
      op: 'screenshot',
      out: resolve(process.cwd(), 'shot.png'),
    })
  })

  it('prints the error and returns 1 on failure', async () => {
    const call = vi.fn(async () => ({ error: 'no_device' }))
    const t = io()
    const code = await runScreenshot([], t.io, { call, socket: '/tmp/s.sock' })
    expect(code).toBe(1)
    expect(t.errs[0]).toContain('no_device')
  })

  it('returns 1 when the daemon is unreachable', async () => {
    const call = vi.fn(async () => {
      throw new Error('daemon socket not found')
    })
    const t = io()
    const code = await runScreenshot([], t.io, { call, socket: '/tmp/s.sock' })
    expect(code).toBe(1)
    expect(t.errs[0]).toContain('daemon socket not found')
  })
})
