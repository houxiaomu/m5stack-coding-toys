import { describe, expect, it } from 'vitest'
import {
  deviceEventPayload,
  helloAckPayload,
  notifyAckPayload,
  pongPayload,
  tapAckPayload,
} from './messages-device.js'

describe('device payloads', () => {
  it('hello.ack requires board, fw, caps', () => {
    const parsed = helloAckPayload.parse({
      board: 'cores3-se',
      fw: '0.1.0',
      caps: ['display', 'touch'],
      device_id: 'M5SE-AABBCC',
    })
    expect(parsed.board).toBe('cores3-se')
    expect(parsed.device_id).toBe('M5SE-AABBCC')
  })

  it('hello.ack accepts optional battery', () => {
    const parsed = helloAckPayload.parse({
      board: 'cores3-se',
      fw: '0.1.0',
      caps: [],
      device_id: 'x',
      battery: { pct: 87, usb: true },
    })
    expect(parsed.battery?.pct).toBe(87)
  })

  it('notify.ack accepts empty payload', () => {
    expect(notifyAckPayload.parse({})).toEqual({})
  })

  it('device.event requires kind', () => {
    const parsed = deviceEventPayload.parse({ kind: 'battery', pct: 50 })
    expect(parsed.kind).toBe('battery')
  })

  it('device.event accepts focus session selection', () => {
    expect(deviceEventPayload.parse({ kind: 'focus', target: 'session', sessionId: 's1' })).toEqual(
      {
        kind: 'focus',
        target: 'session',
        sessionId: 's1',
      },
    )
  })

  it('device.event rejects invalid focus selection payloads', () => {
    expect(deviceEventPayload.safeParse({ kind: 'focus', target: 'auto' }).success).toBe(false)
    expect(deviceEventPayload.safeParse({ kind: 'focus', target: 'session' }).success).toBe(false)
    expect(deviceEventPayload.safeParse({ kind: 'focus', target: 'other' }).success).toBe(false)
  })

  it('pong accepts empty payload', () => {
    expect(pongPayload.parse({})).toEqual({})
  })
})

describe('tapAckPayload', () => {
  it('accepts success and expected failure payloads', () => {
    expect(tapAckPayload.safeParse({ ok: true }).success).toBe(true)
    expect(tapAckPayload.safeParse({ ok: false, err: 'out_of_bounds' }).success).toBe(true)
  })

  it('rejects non-boolean ok', () => {
    expect(tapAckPayload.safeParse({ ok: 'true' }).success).toBe(false)
  })
})
