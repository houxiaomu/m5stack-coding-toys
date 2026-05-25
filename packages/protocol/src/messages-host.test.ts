import { describe, expect, it } from 'vitest'
import { helloPayload, notifyPayload, pingPayload, statusPayload } from './messages-host.js'

describe('statusPayload', () => {
  it('requires only state; all other fields optional', () => {
    expect(statusPayload.safeParse({ state: 'active' }).success).toBe(true)
    expect(statusPayload.safeParse({ state: 'idle' }).success).toBe(true)
    expect(statusPayload.safeParse({ state: 'thinking' }).success).toBe(false)
    expect(statusPayload.safeParse({ state: 'nope' }).success).toBe(false)
  })

  it('accepts a full snapshot', () => {
    const full = {
      state: 'active',
      model: { id: 'sonnet-4.6', short: 'Sonnet 4.6' },
      context: { usedPct: 47, tokens: 94000, limit: 200000, exceeds200k: false },
      cost: {
        sessionUsd: 0.42,
        burnPerHr: 0.12,
        durationMin: 38,
        linesAdded: 318,
        linesRemoved: 92,
      },
      block: { usedPct: 22, resetAt: 1748100000, resetInMin: 132 },
      weekly: { usedPct: 18, resetAt: 1748500000 },
      today: { costUsd: 1.84, sessions: 5 },
      burnHistory: [0.04, 0.06, 0.05],
      workspace: { dir: '~/repos/payments-api', worktree: 'payments-api' },
      git: {
        branch: 'feat/checkout-v2',
        ahead: 3,
        behind: 0,
        staged: 3,
        unstaged: 5,
        untracked: 1,
        lastCommit: { hash: '8a3c2f1', msg: 'wire up retry', minsAgo: 12 },
      },
      pr: { number: 42, reviewState: 'approved' },
    }
    expect(statusPayload.safeParse(full).success).toBe(true)
  })

  it('rejects out-of-range percentage', () => {
    expect(statusPayload.safeParse({ state: 'idle', context: { usedPct: 150 } }).success).toBe(
      false,
    )
  })

  it('drops/ignores missing optional groups (graceful degradation)', () => {
    const parsed = statusPayload.parse({ state: 'idle', context: { usedPct: 10 } })
    expect(parsed.git).toBeUndefined()
    expect(parsed.weekly).toBeUndefined()
  })
})

describe('retained host messages', () => {
  it('hello still carries caps', () => {
    expect(helloPayload.safeParse({ caps: ['display', 'touch'] }).success).toBe(true)
  })
  it('notify unchanged', () => {
    expect(notifyPayload.safeParse({ title: 'done', urgency: 'normal' }).success).toBe(true)
  })
  it('ping is strict-empty', () => {
    expect(pingPayload.safeParse({}).success).toBe(true)
  })
})
