import { describe, expect, it } from 'vitest'
import { NdjsonFramer } from './framing-ndjson.js'

describe('NdjsonFramer', () => {
  it('emits one complete line', () => {
    const framer = new NdjsonFramer()
    expect(framer.push('hello\n')).toEqual(['hello'])
  })

  it('buffers partial lines until newline arrives', () => {
    const framer = new NdjsonFramer()
    expect(framer.push('part1')).toEqual([])
    expect(framer.push('part2')).toEqual([])
    expect(framer.push('\n')).toEqual(['part1part2'])
  })

  it('handles multiple lines in one chunk', () => {
    const framer = new NdjsonFramer()
    expect(framer.push('a\nb\nc\n')).toEqual(['a', 'b', 'c'])
  })

  it('handles trailing partial line', () => {
    const framer = new NdjsonFramer()
    expect(framer.push('a\nb')).toEqual(['a'])
    expect(framer.push('\n')).toEqual(['b'])
  })

  it('skips empty lines', () => {
    const framer = new NdjsonFramer()
    expect(framer.push('a\n\n\nb\n')).toEqual(['a', 'b'])
  })

  it('accepts Uint8Array input', () => {
    const framer = new NdjsonFramer()
    const bytes = new TextEncoder().encode('xy\nz')
    expect(framer.push(bytes)).toEqual(['xy'])
  })

  it('handles multi-byte UTF-8 split across chunks', () => {
    const framer = new NdjsonFramer()
    const bytes = new TextEncoder().encode('héllo\n')
    // Split between the first byte of `é` (0xc3) and the second (0xa9).
    expect(framer.push(bytes.slice(0, 2))).toEqual([])
    expect(framer.push(bytes.slice(2))).toEqual(['héllo'])
  })

  it('frame adds a trailing newline', () => {
    expect(NdjsonFramer.frame('hello')).toBe('hello\n')
  })

  it('frame rejects messages containing newlines', () => {
    expect(() => NdjsonFramer.frame('bad\nstring')).toThrow()
  })
})
