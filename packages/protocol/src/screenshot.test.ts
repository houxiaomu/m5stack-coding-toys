import { describe, expect, it } from 'vitest'
import { decode, encode } from './codec.js'

describe('screenshot protocol frames', () => {
  it('round-trips a screenshot request (host→device)', () => {
    const wire = encode({ k: 'screenshot', id: 'm1', p: { fmt: 'png' } })
    const env = decode(wire)
    expect(env.k).toBe('screenshot')
    expect(env.id).toBe('m1')
    expect((env.p as { fmt: string }).fmt).toBe('png')
  })

  it('round-trips a screenshot.ack with png payload (device→host)', () => {
    const wire = encode({
      k: 'screenshot.ack',
      id: 'm1',
      p: { ok: true, w: 320, h: 240, fmt: 'png', png_b64: 'iVBORw==' },
    })
    const env = decode(wire)
    expect(env.k).toBe('screenshot.ack')
    const p = env.p as { ok: boolean; w?: number; png_b64?: string }
    expect(p.ok).toBe(true)
    expect(p.w).toBe(320)
    expect(p.png_b64).toBe('iVBORw==')
  })

  it('defaults fmt to png when omitted on a request', () => {
    const wire = encode({ k: 'screenshot', id: 'm1', p: {} })
    const env = decode(wire)
    expect((env.p as { fmt: string }).fmt).toBe('png')
  })

  it('round-trips a screenshot.ack error', () => {
    const wire = encode({
      k: 'screenshot.ack',
      id: 'm1',
      p: { ok: false, err: 'capture_unsupported' },
    })
    const env = decode(wire)
    const p = env.p as { ok: boolean; err?: string }
    expect(p.ok).toBe(false)
    expect(p.err).toBe('capture_unsupported')
  })
})
