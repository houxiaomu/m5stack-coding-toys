import { describe, expect, it } from 'vitest'
import { mapStatusLineInput } from './cc-statusline.js'

describe('mapStatusLineInput', () => {
  it('maps native fields into partial status', () => {
    const cc = {
      model: { id: 'claude-sonnet-4-6', display_name: 'Sonnet 4.6' },
      context_window: {
        used_percentage: 47,
        total_input_tokens: 94000,
        context_window_size: 200000,
      },
      exceeds_200k_tokens: false,
      cost: {
        total_cost_usd: 0.42,
        total_duration_ms: 2_280_000,
        total_lines_added: 318,
        total_lines_removed: 92,
      },
      rate_limits: {
        five_hour: { used_percentage: 22, resets_at: 1748100000 },
        seven_day: { used_percentage: 18, resets_at: 1748500000 },
      },
      workspace: { current_dir: '/Users/me/repos/payments-api' },
      worktree: { name: 'payments-api' },
      pr: { number: 42, url: 'https://x', review_state: 'approved' },
    }
    const now = 1748100000 - 132 * 60 // so five_hour resets in 132 min
    const out = mapStatusLineInput(cc, now * 1000)
    expect(out.model).toEqual({ id: 'claude-sonnet-4-6', short: 'Sonnet 4.6' })
    expect(out.context).toMatchObject({
      usedPct: 47,
      tokens: 94000,
      limit: 200000,
      exceeds200k: false,
    })
    expect(out.cost).toMatchObject({
      sessionUsd: 0.42,
      durationMin: 38,
      linesAdded: 318,
      linesRemoved: 92,
    })
    expect(out.block).toMatchObject({ usedPct: 22, resetAt: 1748100000, resetInMin: 132 })
    expect(out.weekly).toMatchObject({ usedPct: 18, resetAt: 1748500000 })
    expect(out.workspace).toEqual({ dir: '/Users/me/repos/payments-api', worktree: 'payments-api' })
    expect(out.pr).toEqual({ number: 42, reviewState: 'approved' })
  })

  it('omits groups when source fields absent (non-Pro/Max, pre-first-call)', () => {
    const out = mapStatusLineInput({ model: { display_name: 'Sonnet 4.6' } }, Date.now())
    expect(out.block).toBeUndefined()
    expect(out.weekly).toBeUndefined()
    expect(out.context).toBeUndefined()
    expect(out.cost).toBeUndefined()
  })

  it('tolerates null current_usage / null percentages', () => {
    const out = mapStatusLineInput(
      {
        context_window: { used_percentage: null, current_usage: null, context_window_size: 200000 },
      },
      Date.now(),
    )
    expect(out.context?.usedPct).toBeUndefined()
    expect(out.context?.limit).toBe(200000)
  })
})
