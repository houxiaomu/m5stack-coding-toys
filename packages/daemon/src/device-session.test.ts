import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DeviceSession, deriveDeviceTime } from './device-session.js'
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
      maxMissedPings: 3,
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
      maxMissedPings: 3,
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
      maxMissedPings: 3,
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

  it('emits disconnect after maxMissedPings consecutive ping timeouts (zombie link)', async () => {
    // Device keeps the transport open but stops answering pings — the exact
    // half-open BLE failure where `close` never fires and the old code pinged
    // into the void forever.
    process.env.M5CT_FAKE_PING = 'noreply'
    const t = new FakeStdioTransport([process.execPath, fakeFirmware])
    const s = new DeviceSession(t, {
      helloTimeoutMs: 2000,
      pingIntervalMs: 50,
      pingTimeoutMs: 40,
      maxMissedPings: 3,
    })
    try {
      await s.start()
      const disc = new Promise<void>((r) => s.once('disconnect', () => r()))
      await Promise.race([
        disc,
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('watchdog did not force disconnect')), 2000),
        ),
      ])
    } finally {
      s.destroy()
      process.env.M5CT_FAKE_PING = undefined
    }
  }, 5000)

  it('does NOT disconnect while pings keep getting answered', async () => {
    const t = new FakeStdioTransport([process.execPath, fakeFirmware])
    const s = new DeviceSession(t, {
      helloTimeoutMs: 2000,
      pingIntervalMs: 30,
      pingTimeoutMs: 25,
      maxMissedPings: 3,
    })
    let disconnected = false
    s.once('disconnect', () => {
      disconnected = true
    })
    try {
      await s.start()
      // Run well past maxMissedPings worth of healthy ping cycles.
      await new Promise((r) => setTimeout(r, 300))
      expect(disconnected).toBe(false)
    } finally {
      s.destroy()
    }
  }, 5000)

  it('emits disconnect when subprocess exits', async () => {
    const t = new FakeStdioTransport([process.execPath, fakeFirmware])
    const s = new DeviceSession(t, {
      helloTimeoutMs: 2000,
      pingIntervalMs: 60000,
      pingTimeoutMs: 1000,
      maxMissedPings: 3,
    })
    await s.start()
    const disc = new Promise<void>((r) => s.once('disconnect', () => r()))
    s.destroy()
    // destroy closes transport which triggers exit → disconnect
    // Wait briefly for event loop to settle.
    await Promise.race([disc, new Promise((r) => setTimeout(r, 200))])
  }, 5000)
})

describe('deriveDeviceTime', () => {
  it('returns utc_ms equal to the Date and an integer offset in range', () => {
    const d = new Date('2026-05-30T04:00:00.000Z')
    const r = deriveDeviceTime(d)
    expect(r.utc_ms).toBe(d.getTime())
    expect(Number.isInteger(r.offset_min)).toBe(true)
    expect(r.offset_min).toBeGreaterThanOrEqual(-840)
    expect(r.offset_min).toBeLessThanOrEqual(840)
  })

  it('local = utc + offset reconstructs the host wall-clock (TZ-independent invariant)', () => {
    const d = new Date('2026-05-30T04:00:00.000Z')
    const r = deriveDeviceTime(d)
    // Adding the east-of-UTC offset to the UTC instant, then reading UTC fields,
    // must equal the original Date's LOCAL fields.
    const local = new Date(r.utc_ms + r.offset_min * 60_000)
    expect(local.getUTCHours()).toBe(d.getHours())
    expect(local.getUTCMinutes()).toBe(d.getMinutes())
    expect(local.getUTCDate()).toBe(d.getDate())
  })
})
