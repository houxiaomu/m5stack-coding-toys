import { describe, expect, it, vi } from 'vitest'
import { runTap } from './cmd-tap.js'

function io() {
  const logs: string[] = []
  const errs: string[] = []
  return {
    logs,
    errs,
    io: { log: (l: string) => logs.push(l), error: (l: string) => errs.push(l) },
  }
}

describe('runTap', () => {
  it('sends a tap op with default duration', async () => {
    const call = vi.fn(async () => ({ ok: true }))
    const t = io()
    const code = await runTap(['160', '120'], t.io, { call, socket: '/tmp/s.sock' })

    expect(code).toBe(0)
    expect(call).toHaveBeenCalledWith('/tmp/s.sock', {
      op: 'tap',
      x: 160,
      y: 120,
      duration_ms: 50,
    })
    expect(t.logs).toEqual(['Tapped: x=160 y=120 duration=50ms'])
    expect(t.errs).toEqual([])
  })

  it('sends an explicit duration', async () => {
    const call = vi.fn(async () => ({ ok: true }))
    const t = io()
    const code = await runTap(['160', '120', '--duration', '120'], t.io, {
      call,
      socket: '/tmp/s.sock',
    })

    expect(code).toBe(0)
    expect(call).toHaveBeenCalledWith('/tmp/s.sock', {
      op: 'tap',
      x: 160,
      y: 120,
      duration_ms: 120,
    })
    expect(t.logs).toEqual(['Tapped: x=160 y=120 duration=120ms'])
  })

  it('rejects invalid arguments before calling daemon', async () => {
    const cases: readonly (readonly string[])[] = [
      [],
      ['1'],
      ['-1', '2'],
      ['1.5', '2'],
      ['1', '2', '--duration'],
      ['1', '2', '--duration', '0'],
      ['1', '2', '--duration', '5001'],
      ['1', '2', '--bogus'],
      ['1', '2', '3'],
    ]

    for (const args of cases) {
      const call = vi.fn(async () => ({ ok: true }))
      const t = io()
      const code = await runTap(args, t.io, { call, socket: '/tmp/s.sock' })
      expect(code, args.join(' ')).toBe(2)
      expect(call, args.join(' ')).not.toHaveBeenCalled()
      expect(t.errs[0], args.join(' ')).toMatch(/^m5ct tap: /)
    }
  })

  it('prints daemon errors and returns 1', async () => {
    const call = vi.fn(async () => ({ error: 'out_of_bounds' }))
    const t = io()
    const code = await runTap(['999', '999'], t.io, { call, socket: '/tmp/s.sock' })

    expect(code).toBe(1)
    expect(t.logs).toEqual([])
    expect(t.errs).toEqual(['m5ct tap: out_of_bounds'])
  })

  it('returns 1 when the daemon is unreachable', async () => {
    const call = vi.fn(async () => {
      throw new Error('daemon socket not found')
    })
    const t = io()
    const code = await runTap(['1', '2'], t.io, { call, socket: '/tmp/s.sock' })

    expect(code).toBe(1)
    expect(t.logs).toEqual([])
    expect(t.errs).toEqual(['m5ct tap: daemon socket not found'])
  })
})
