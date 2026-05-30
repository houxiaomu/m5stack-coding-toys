import { describe, expect, it } from 'vitest'
import {
  helloPayload,
  notifyPayload,
  pingPayload,
  statusPayload,
  tapPayload,
} from './messages-host.js'

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

  it('accepts git diff summary fields', () => {
    const parsed = statusPayload.parse({
      state: 'active',
      git: {
        branch: 'feat/workspace-ui',
        diff: {
          filesChanged: 4,
          linesAdded: 128,
          linesRemoved: 24,
          topFiles: [
            { path: 'firmware/lib/m5render/pages.cpp', added: 84, removed: 12 },
            { path: 'firmware/lib/m5render/status_model.h', added: 18, removed: 0 },
          ],
        },
      },
    })

    expect(parsed.git?.diff?.topFiles?.[0]?.path).toBe('firmware/lib/m5render/pages.cpp')
  })

  it('keeps git diff optional for older daemons', () => {
    expect(
      statusPayload.safeParse({
        state: 'active',
        git: { branch: 'main', staged: 0, unstaged: 0, untracked: 0 },
      }).success,
    ).toBe(true)
  })
})

describe('helloPayload', () => {
  it('accepts hello without time (backward compatible)', () => {
    expect(helloPayload.safeParse({ caps: ['display', 'notify'] }).success).toBe(true)
  })

  it('accepts hello with time { utc_ms, offset_min }', () => {
    const r = helloPayload.safeParse({
      caps: ['display'],
      time: { utc_ms: 1748600000000, offset_min: 480 },
    })
    expect(r.success).toBe(true)
  })

  it('accepts a negative (west-of-UTC) offset', () => {
    expect(
      helloPayload.safeParse({ caps: ['display'], time: { utc_ms: 0, offset_min: -300 } }).success,
    ).toBe(true)
  })

  it('rejects out-of-range offset and negative utc_ms', () => {
    expect(
      helloPayload.safeParse({ caps: ['display'], time: { utc_ms: 1, offset_min: 900 } }).success,
    ).toBe(false)
    expect(
      helloPayload.safeParse({ caps: ['display'], time: { utc_ms: -1, offset_min: 0 } }).success,
    ).toBe(false)
  })

  it('rejects unknown keys inside time (.strict)', () => {
    expect(
      helloPayload.safeParse({
        caps: ['display'],
        time: { utc_ms: 1, offset_min: 0, extra: 1 },
      }).success,
    ).toBe(false)
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

describe('statusPayload activity', () => {
  it('accepts the three activity values', () => {
    for (const activity of ['working', 'awaiting_input', 'needs_attention'] as const) {
      expect(statusPayload.safeParse({ state: 'active', activity }).success).toBe(true)
    }
  })

  it('rejects an unknown activity', () => {
    expect(statusPayload.safeParse({ state: 'active', activity: 'busy' }).success).toBe(false)
  })

  it('activity is optional and coexists with state', () => {
    const r = statusPayload.safeParse({ state: 'idle' })
    expect(r.success).toBe(true)
  })
})

describe('statusPayload multi-session sessions metadata', () => {
  it('accepts real session summaries only', () => {
    const parsed = statusPayload.parse({
      state: 'active',
      activity: 'working',
      sessions: [
        { index: 1, id: 's1', name: 'm5toys', activity: 'needs_attention', selected: true },
        { index: 2, id: 's2', name: 'docs', activity: 'working' },
      ],
    })

    expect(parsed.sessions?.map((s) => [s.id, s.activity])).toEqual([
      ['s1', 'needs_attention'],
      ['s2', 'working'],
    ])
  })

  it('rejects legacy focus metadata and auto/pinned session fields', () => {
    expect(
      statusPayload.safeParse({
        state: 'active',
        focus: { mode: 'pinned', index: 1, total: 2 },
      }).success,
    ).toBe(false)
    expect(
      statusPayload.safeParse({
        state: 'active',
        sessions: [{ index: 0, id: 'auto', name: 'AUTO', activity: 'working', auto: true }],
      }).success,
    ).toBe(false)
    expect(
      statusPayload.safeParse({
        state: 'active',
        sessions: [{ index: 1, id: 's1', name: 'm5toys', activity: 'working', pinned: true }],
      }).success,
    ).toBe(false)
  })

  it('rejects invalid session activity values', () => {
    expect(
      statusPayload.safeParse({
        state: 'active',
        sessions: [{ index: 1, id: 's1', name: 'm5toys', activity: 'blocked' }],
      }).success,
    ).toBe(false)
  })
})

describe('tapPayload', () => {
  it('accepts coordinates and defaults duration', () => {
    expect(tapPayload.parse({ x: 160, y: 120 })).toEqual({
      x: 160,
      y: 120,
      duration_ms: 50,
    })
  })

  it('accepts an explicit duration', () => {
    expect(tapPayload.parse({ x: 1, y: 2, duration_ms: 120 })).toEqual({
      x: 1,
      y: 2,
      duration_ms: 120,
    })
  })

  it('rejects invalid coordinates and durations', () => {
    expect(tapPayload.safeParse({ x: -1, y: 0 }).success).toBe(false)
    expect(tapPayload.safeParse({ x: 1.5, y: 0 }).success).toBe(false)
    expect(tapPayload.safeParse({ x: 0, y: -1 }).success).toBe(false)
    expect(tapPayload.safeParse({ x: 0, y: 0, duration_ms: 0 }).success).toBe(false)
    expect(tapPayload.safeParse({ x: 0, y: 0, duration_ms: 5001 }).success).toBe(false)
  })
})
