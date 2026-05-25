import { describe, expect, it } from 'vitest'
import { CodecError, decode, encode } from './codec.js'

describe('codec', () => {
  it('encodes a ping message to JSON', () => {
    const json = encode({ k: 'ping', p: {} })
    const parsed = JSON.parse(json)
    expect(parsed.v).toBe(1)
    expect(parsed.k).toBe('ping')
    expect(typeof parsed.t).toBe('number')
  })

  it('encodes with explicit id', () => {
    const json = encode({ k: 'hello', id: 'abc', p: { caps: ['display'] } })
    expect(JSON.parse(json).id).toBe('abc')
  })

  it('encode rejects invalid payload', () => {
    expect(() =>
      // @ts-expect-error intentional bad payload
      encode({ k: 'status', p: { state: 'sleeping' } }),
    ).toThrow(CodecError)
  })

  it('decodes a valid envelope', () => {
    const json = JSON.stringify({ v: 1, k: 'ping', t: 1700000000, p: {} })
    const env = decode(json)
    expect(env.k).toBe('ping')
  })

  it('decodes and validates payload by kind', () => {
    const json = JSON.stringify({
      v: 1,
      k: 'status',
      t: 1700000000,
      p: { state: 'idle' },
    })
    const env = decode(json)
    expect(env.k).toBe('status')
    expect((env.p as { state: string }).state).toBe('idle')
  })

  it('throws CodecError on malformed JSON', () => {
    expect(() => decode('not json')).toThrow(CodecError)
  })

  it('throws CodecError when envelope shape is wrong', () => {
    expect(() => decode(JSON.stringify({ v: 1, p: {} }))).toThrow(CodecError)
  })

  it('throws CodecError when payload fails validation', () => {
    const json = JSON.stringify({
      v: 1,
      k: 'status',
      t: 1700000000,
      p: { state: 'invalid' },
    })
    expect(() => decode(json)).toThrow(CodecError)
  })

  it('throws CodecError on unknown kind', () => {
    const json = JSON.stringify({ v: 1, k: 'bogus.msg', t: 0, p: {} })
    expect(() => decode(json)).toThrow(CodecError)
  })

  it('roundtrips: encode → decode preserves k and p', () => {
    const wire = encode({
      k: 'status',
      id: 'r1',
      p: { state: 'active' },
    })
    const back = decode(wire)
    expect(back.k).toBe('status')
    expect(back.id).toBe('r1')
    expect((back.p as { state: string }).state).toBe('active')
  })

  it('CodecError carries cause', () => {
    try {
      decode('{ not json')
    } catch (e) {
      expect(e).toBeInstanceOf(CodecError)
      expect((e as CodecError).cause).toBeDefined()
    }
  })
})
