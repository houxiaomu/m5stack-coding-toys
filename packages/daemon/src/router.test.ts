import { describe, expect, it } from 'vitest'
import { Router } from './router.js'

describe('Router', () => {
  it('handleDeviceEvent does not throw on a device.event', async () => {
    const r = new Router()
    await expect(
      r.handleDeviceEvent({
        v: 1,
        k: 'device.event',
        t: 0,
        p: { kind: 'battery', pct: 50 },
      } as never),
    ).resolves.toBeUndefined()
  })

  it('routes focus auto events to the callback', async () => {
    const calls: unknown[] = []
    const r = new Router((focus) => calls.push(focus))
    await r.handleDeviceEvent({
      v: 1,
      k: 'device.event',
      t: 0,
      p: { kind: 'focus', target: 'auto' },
    } as never)
    expect(calls).toEqual([{ target: 'auto' }])
  })

  it('routes focus session events to the callback', async () => {
    const calls: unknown[] = []
    const r = new Router((focus) => calls.push(focus))
    await r.handleDeviceEvent({
      v: 1,
      k: 'device.event',
      t: 0,
      p: { kind: 'focus', target: 'session', sessionId: 's2' },
    } as never)
    expect(calls).toEqual([{ target: 'session', sessionId: 's2' }])
  })
})
