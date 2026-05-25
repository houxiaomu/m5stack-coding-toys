import { describe, expect, it } from 'vitest'
import { runChained } from './chain.js'

describe('runChained', () => {
  it('pipes stdin to the command and returns its stdout', async () => {
    const out = await runChained('cat', '{"hello":1}')
    expect(out).toBe('{"hello":1}')
  })

  it('returns empty string when the command fails', async () => {
    const out = await runChained('this-command-does-not-exist-xyz', 'x')
    expect(out).toBe('')
  })

  it('returns empty string on timeout', async () => {
    const out = await runChained('sleep 5', 'x', 100)
    expect(out).toBe('')
  })
})
