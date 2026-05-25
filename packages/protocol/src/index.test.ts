import { describe, expect, it } from 'vitest'
import * as proto from './index.js'

describe('@m5stack-coding-toys/protocol barrel', () => {
  it('exposes PROTOCOL_VERSION', () => {
    expect(proto.PROTOCOL_VERSION).toBe(1)
  })

  it('exposes encode/decode', () => {
    expect(typeof proto.encode).toBe('function')
    expect(typeof proto.decode).toBe('function')
  })

  it('exposes NdjsonFramer', () => {
    expect(typeof proto.NdjsonFramer).toBe('function')
  })

  it('exposes ALL_KINDS', () => {
    expect(proto.ALL_KINDS.length).toBeGreaterThan(0)
  })

  it('encode→NdjsonFramer.frame→push→decode roundtrip', () => {
    const wire = proto.NdjsonFramer.frame(proto.encode({ k: 'ping', p: {} }))
    const framer = new proto.NdjsonFramer()
    const lines = framer.push(wire)
    expect(lines).toHaveLength(1)
    const env = proto.decode(lines[0] as string)
    expect(env.k).toBe('ping')
  })
})
