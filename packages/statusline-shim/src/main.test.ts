import { describe, expect, it } from 'vitest'
import { buildDaemonPayload, buildSummary } from './main.js'

describe('buildSummary', () => {
  it('renders a compact one-line terminal summary from CC JSON', () => {
    const line = buildSummary({
      model: { display_name: 'Sonnet 4.6' },
      context_window: { used_percentage: 47 },
      cost: { total_cost_usd: 0.42 },
    })
    expect(line).toContain('Sonnet 4.6')
    expect(line).toContain('47%')
    expect(line).toContain('$0.42')
  })

  it('degrades gracefully when fields missing', () => {
    expect(buildSummary({})).toMatch(/m5ct/i)
  })
})

it('includes ccPid and session_id when available', () => {
  const cc = { session_id: 'abc', model: { display_name: 'Opus' } }
  const p = buildDaemonPayload(cc, 51856)
  expect(p).toEqual({ statusLine: cc, ccPid: 51856, sessionId: 'abc' })
})

it('omits ccPid when null', () => {
  const cc = { session_id: 'abc' }
  const p = buildDaemonPayload(cc, null)
  expect(p).toEqual({ statusLine: cc, sessionId: 'abc' })
})

it('omits sessionId when absent', () => {
  const p = buildDaemonPayload({}, 10)
  expect(p).toEqual({ statusLine: {}, ccPid: 10 })
})
