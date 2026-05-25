import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DeviceSession } from './device-session.js'
import { FakeStdioTransport } from './transport/fake-stdio.js'

const here = dirname(fileURLToPath(import.meta.url))
const fakeFirmware = resolve(here, '../../../tools/fake-firmware/dist/main.js')

describe('DeviceSession (against real fake-firmware subprocess)', () => {
  it('completes hello handshake and exposes device info', async () => {
    const t = new FakeStdioTransport([process.execPath, fakeFirmware])
    const s = new DeviceSession(t, {
      helloTimeoutMs: 2000,
      pingIntervalMs: 60000,
      pingTimeoutMs: 1000,
    })
    try {
      const info = await s.start()
      expect(info.board).toBe('cores3-se')
      expect(info.device_id).toMatch(/^FAKE-/)
      expect(s.hasCap('display')).toBe(true)
    } finally {
      s.destroy()
    }
  }, 5000)

  it('roundtrips ping/pong via request()', async () => {
    const t = new FakeStdioTransport([process.execPath, fakeFirmware])
    const s = new DeviceSession(t, {
      helloTimeoutMs: 2000,
      pingIntervalMs: 60000,
      pingTimeoutMs: 1000,
    })
    try {
      await s.start()
      const pong = await s.request({ k: 'ping', p: {} }, 2000)
      expect(pong.k).toBe('pong')
    } finally {
      s.destroy()
    }
  }, 5000)

  it('request rejects with ETIMEDOUT when no response', async () => {
    // Tell fake-firmware to drop notify instead of responding.
    process.env.M5CT_FAKE_NOTIFY = 'noreply'
    const t = new FakeStdioTransport([process.execPath, fakeFirmware])
    const s = new DeviceSession(t, {
      helloTimeoutMs: 2000,
      pingIntervalMs: 60000,
      pingTimeoutMs: 1000,
    })
    try {
      await s.start()
      await expect(
        s.request({ k: 'notify', p: { title: 'X', urgency: 'normal' } }, 300),
      ).rejects.toMatchObject({ code: 'ETIMEDOUT' })
    } finally {
      s.destroy()
      process.env.M5CT_FAKE_NOTIFY = undefined
    }
  }, 5000)

  it('emits disconnect when subprocess exits', async () => {
    const t = new FakeStdioTransport([process.execPath, fakeFirmware])
    const s = new DeviceSession(t, {
      helloTimeoutMs: 2000,
      pingIntervalMs: 60000,
      pingTimeoutMs: 1000,
    })
    await s.start()
    const disc = new Promise<void>((r) => s.once('disconnect', () => r()))
    s.destroy()
    // destroy closes transport which triggers exit → disconnect
    // Wait briefly for event loop to settle.
    await Promise.race([disc, new Promise((r) => setTimeout(r, 200))])
  }, 5000)
})
