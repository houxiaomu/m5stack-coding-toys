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
})
