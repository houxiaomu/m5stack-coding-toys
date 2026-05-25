import { describe, expect, it } from 'vitest'
import { envelopeSchema } from './envelope.js'

describe('envelope', () => {
  it('accepts a minimal valid envelope', () => {
    const parsed = envelopeSchema.parse({
      v: 1,
      k: 'ping',
      t: 1700000000,
      p: {},
    })
    expect(parsed.v).toBe(1)
    expect(parsed.k).toBe('ping')
    expect(parsed.id).toBeUndefined()
  })

  it('accepts an envelope with an id', () => {
    const parsed = envelopeSchema.parse({
      v: 1,
      id: 'abc-123',
      k: 'hello',
      t: 1700000000,
      p: { caps: [] },
    })
    expect(parsed.id).toBe('abc-123')
  })

  it('rejects wrong protocol version', () => {
    expect(() => envelopeSchema.parse({ v: 2, k: 'ping', t: 0, p: {} })).toThrow()
  })

  it('rejects missing kind', () => {
    expect(() => envelopeSchema.parse({ v: 1, t: 0, p: {} })).toThrow()
  })

  it('rejects negative timestamp', () => {
    expect(() => envelopeSchema.parse({ v: 1, k: 'ping', t: -1, p: {} })).toThrow()
  })
})
