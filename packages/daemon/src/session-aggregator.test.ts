import { describe, expect, it, vi } from 'vitest'
import { SessionAggregator } from './session-aggregator.js'

function fakeSession() {
  return { info: { caps: ['display'] }, send: vi.fn(async () => {}) }
}

function makeMemStore() {
  return {
    state: null as null | {
      burnHistory: number[]
      todayCost: number
      todayDay: string
      todaySessions: string[]
    },
    load() {
      return this.state
    },
    save(s: {
      burnHistory: number[]
      todayCost: number
      todayDay: string
      todaySessions: string[]
    }) {
      this.state = s
    },
  }
}

describe('SessionAggregator', () => {
  it('builds a status frame from a CC tick and pushes it', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => ({
        branch: 'main',
        ahead: 0,
        behind: 0,
        staged: 0,
        unstaged: 0,
        untracked: 0,
      }),
    } as never)
    await agg.ingest({
      model: { display_name: 'Sonnet 4.6' },
      cost: { total_cost_usd: 0.4 },
      workspace: { current_dir: '/repo' },
    })
    expect(sess.send).toHaveBeenCalledTimes(1)
    const frame = sess.send.mock.calls[0][0]
    expect(frame.k).toBe('status')
    expect(frame.p.state).toBe('active')
    expect(frame.p.model.short).toBe('Sonnet 4.6')
    expect(frame.p.git.branch).toBe('main')
  })

  it('tracks burnHistory ($/min) and today aggregation across ticks', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    let t = 1_000_000
    const now = () => t
    await agg.ingest({ session_id: 's1', cost: { total_cost_usd: 0.1 } }, undefined, now)
    t += 60_000
    await agg.ingest({ session_id: 's1', cost: { total_cost_usd: 0.25 } }, undefined, now)
    const frame = sess.send.mock.calls.at(-1)[0]
    expect(frame.p.burnHistory.length).toBeGreaterThan(0)
    expect(frame.p.today.costUsd).toBeCloseTo(0.25, 2)
    expect(frame.p.today.sessions).toBe(1)
  })

  it('resets today bucket on local day change (not UTC)', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    // t0 is 01:00 local; t1 is +26h so it always lands on the next local
    // calendar day regardless of the machine timezone.
    const t0 = Date.parse('2026-05-24T01:00:00')
    let t = t0
    const now = () => t
    await agg.ingest({ session_id: 'd1', cost: { total_cost_usd: 0.4 } }, undefined, now)
    const day1 = sess.send.mock.calls.at(-1)[0]
    expect(day1.p.today.costUsd).toBeCloseTo(0.4, 2)
    expect(day1.p.today.sessions).toBe(1)

    t = t0 + 26 * 3600 * 1000
    await agg.ingest({ session_id: 'd2', cost: { total_cost_usd: 0.15 } }, undefined, now)
    const day2 = sess.send.mock.calls.at(-1)[0]
    // Bucket reset: reflects only day-2 cost and the day-2 session.
    expect(day2.p.today.costUsd).toBeCloseTo(0.15, 2)
    expect(day2.p.today.sessions).toBe(1)
  })

  it('rounds cost.sessionUsd to 2 decimals in the frame', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    await agg.ingest({ cost: { total_cost_usd: 296.5748916999998 } })
    const frame = sess.send.mock.calls.at(-1)[0]
    expect(frame.p.cost.sessionUsd).toBe(296.57)
  })

  it('restores burnHistory and today from the store on construction', async () => {
    const store = makeMemStore()
    const t = 1_000_000
    // First daemon lifetime: two ticks build burnHistory + today.
    const a1 = new SessionAggregator(
      fakeSession as never,
      { enrich: async () => undefined } as never,
      undefined,
      store,
    )
    await a1.ingest({ session_id: 's1', cost: { total_cost_usd: 0.1 } }, undefined, () => t)
    await a1.ingest(
      { session_id: 's1', cost: { total_cost_usd: 0.25 } },
      undefined,
      () => t + 60_000,
    )
    expect(store.state?.todaySessions).toEqual(['sid:s1'])

    // Second lifetime (restart): a fresh aggregator hydrates from the store.
    const sess = fakeSession()
    const a2 = new SessionAggregator(
      () => sess as never,
      { enrich: async () => undefined } as never,
      undefined,
      store,
    )
    await a2.ingest(
      { session_id: 's2', cost: { total_cost_usd: 0.3 } },
      undefined,
      () => t + 120_000,
    )
    const frame = sess.send.mock.calls.at(-1)[0]
    expect(frame.p.today.sessions).toBe(2) // s1 (restored) + s2
    expect(frame.p.today.costUsd).toBeCloseTo(0.55, 2)
    expect(frame.p.burnHistory.length).toBe(1) // restored sample; restart tick adds none
  })

  it('no-ops when no device session', async () => {
    const agg = new SessionAggregator(() => null, { enrich: async () => undefined } as never)
    await expect(agg.ingest({})).resolves.toBeUndefined()
  })

  // --- Liveness tests ---

  it('marks each status frame state=active', async () => {
    const sess = fakeSession()
    const alivePids = new Set<number>([555])
    const agg = new SessionAggregator(
      () => sess as never,
      { enrich: async () => undefined } as never,
      (p) => alivePids.has(p),
    )
    await agg.ingest({ cost: { total_cost_usd: 1 } }, 123, () => 1000)
    const frame = sess.send.mock.calls.at(-1)[0]
    expect(frame.p.state).toBe('active')
  })

  it('sends one idle frame when the cached pid dies', async () => {
    const sess = fakeSession()
    const alivePids = new Set<number>([555])
    const agg = new SessionAggregator(
      () => sess as never,
      { enrich: async () => undefined } as never,
      (p) => alivePids.has(p),
    )
    await agg.ingest({ session_id: 's' }, 555, () => 1000)
    alivePids.delete(555)
    agg.checkLiveness(() => 6000)
    const afterFirst = sess.send.mock.calls.length
    expect(sess.send.mock.calls.at(-1)[0].p.state).toBe('idle')
    // Second checkLiveness should NOT send again
    agg.checkLiveness(() => 7000)
    expect(sess.send.mock.calls.length).toBe(afterFirst)
  })

  it('keeps active while pid alive even with no new ticks', async () => {
    const sess = fakeSession()
    const alivePids = new Set<number>([555])
    const agg = new SessionAggregator(
      () => sess as never,
      { enrich: async () => undefined } as never,
      (p) => alivePids.has(p),
    )
    await agg.ingest({ session_id: 's' }, 555, () => 1000)
    const countBefore = sess.send.mock.calls.length
    agg.checkLiveness(() => 600_000)
    expect(sess.send.mock.calls.length).toBe(countBefore)
  })

  it('expires quickly when no ccPid', async () => {
    const sess = fakeSession()
    const alivePids = new Set<number>([555])
    const agg = new SessionAggregator(
      () => sess as never,
      { enrich: async () => undefined } as never,
      (p) => alivePids.has(p),
    )
    await agg.ingest({ session_id: 's' }, undefined, () => 1000)
    // Before TTL expires: no idle frame
    agg.checkLiveness(() => 1000 + 29_000)
    expect(sess.send.mock.calls.at(-1)[0].p.state).toBe('active')
    // After TTL expires: idle frame sent
    agg.checkLiveness(() => 1000 + 31_000)
    expect(sess.send.mock.calls.at(-1)[0].p.state).toBe('idle')
  })

  it('stamps current activity on status frames (defaults to working)', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    await agg.ingest({ model: { display_name: 'Sonnet 4.6' } })
    const frame = sess.send.mock.calls.at(-1)[0]
    expect(frame.p.activity).toBe('working')
  })

  it('maps hook events to activity and re-pushes the last frame', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    await agg.ingest({ model: { display_name: 'Sonnet 4.6' } })
    sess.send.mockClear()

    await agg.ingestHookEvent('Stop')
    const frame = sess.send.mock.calls.at(-1)[0]
    expect(frame.p.activity).toBe('awaiting_input')
    // re-pushed full frame keeps prior data (model), not a blank frame
    expect(frame.p.model.short).toBe('Sonnet 4.6')

    await agg.ingestHookEvent('Notification')
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('needs_attention')

    await agg.ingestHookEvent('UserPromptSubmit')
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('working')
  })

  it('maps idle_prompt notifications to awaiting_input, not needs_attention', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    await agg.ingest({ model: { display_name: 'X' } })

    await agg.ingestHookEvent('Notification', undefined, { type: 'idle_prompt' })
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('awaiting_input')
  })

  it('maps permission_prompt and elicitation_dialog notifications to needs_attention', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    await agg.ingest({ model: { display_name: 'X' } })

    await agg.ingestHookEvent('Notification', undefined, { type: 'permission_prompt' })
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('needs_attention')

    await agg.ingestHookEvent('UserPromptSubmit')
    await agg.ingestHookEvent('Notification', undefined, { type: 'elicitation_dialog' })
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('needs_attention')
  })

  it('does not downgrade a pending needs_attention on an idle_prompt reminder', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    await agg.ingest({ model: { display_name: 'X' } })
    await agg.ingestHookEvent('Notification', undefined, { type: 'permission_prompt' })
    sess.send.mockClear()

    await agg.ingestHookEvent('Notification', undefined, { type: 'idle_prompt' })
    expect(sess.send).not.toHaveBeenCalled()
  })

  it('ignores informational notification types entirely', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    await agg.ingest({ model: { display_name: 'X' } })
    sess.send.mockClear()

    for (const type of ['auth_success', 'elicitation_complete', 'elicitation_response']) {
      await agg.ingestHookEvent('Notification', undefined, { type })
    }
    expect(sess.send).not.toHaveBeenCalled()
  })

  it('falls back to message text when notification_type is missing', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    await agg.ingest({ model: { display_name: 'X' } })

    await agg.ingestHookEvent('Notification', undefined, {
      message: 'Claude is waiting for your input',
    })
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('awaiting_input')

    await agg.ingestHookEvent('Notification', undefined, {
      message: 'Claude needs your permission to use Bash',
    })
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('needs_attention')
  })

  it('maps PostToolUse to working (clears needs_attention once the tool ran)', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    await agg.ingest({ model: { display_name: 'X' } })
    await agg.ingestHookEvent('Notification', undefined, { type: 'permission_prompt' })

    await agg.ingestHookEvent('PostToolUse')
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('working')
  })

  it('skips the re-push when a hook does not change activity', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    await agg.ingest({ model: { display_name: 'X' } })
    sess.send.mockClear()

    await agg.ingestHookEvent('PostToolUse') // already working
    expect(sess.send).not.toHaveBeenCalled()
  })

  it('ignores hook events when no device session', async () => {
    const agg = new SessionAggregator(() => null, { enrich: async () => undefined } as never)
    await expect(agg.ingestHookEvent('Stop')).resolves.toBeUndefined()
  })

  it('ignores hook events after the session has gone idle (no spurious wake)', async () => {
    const sess = fakeSession()
    const dead = () => false
    const agg = new SessionAggregator(
      () => sess as never,
      { enrich: async () => undefined } as never,
      dead,
    )
    await agg.ingest({ model: { display_name: 'X' } }, 4242)
    agg.checkLiveness() // pid dead → idle frame sent
    sess.send.mockClear()
    await agg.ingestHookEvent('Notification')
    expect(sess.send).not.toHaveBeenCalled()
  })

  it('resets activity to working when the session goes idle', async () => {
    const sess = fakeSession()
    const dead = () => false
    const agg = new SessionAggregator(
      () => sess as never,
      { enrich: async () => undefined } as never,
      dead,
    )
    await agg.ingest({ model: { display_name: 'X' } }, 4242)
    await agg.ingestHookEvent('Notification')
    agg.checkLiveness()
    sess.send.mockClear()
    await agg.ingest({ model: { display_name: 'X' } }, 4242)
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('working')
  })

  it('keeps separate foreground frames per session and emits real session metadata only', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)

    await agg.ingest(
      {
        session_id: 's1',
        model: { display_name: 'A' },
        workspace: { current_dir: '/repo/a' },
      },
      111,
      () => 1000,
    )
    await agg.ingest(
      {
        session_id: 's2',
        model: { display_name: 'B' },
        workspace: { current_dir: '/repo/b' },
      },
      222,
      () => 2000,
    )

    const frame = sess.send.mock.calls.at(-1)[0]
    expect(frame.p.model.short).toBe('A')
    expect(frame.p.focus).toBeUndefined()
    expect(frame.p.sessions.map((s: { id: string; name: string }) => [s.id, s.name])).toEqual([
      ['pid:111', 'a'],
      ['pid:222', 'b'],
    ])
    expect(
      frame.p.sessions.some((s: { auto?: boolean; pinned?: boolean }) => s.auto || s.pinned),
    ).toBe(false)
  })

  it('does not auto foreground another session that needs attention', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    await agg.ingest({ session_id: 's1', model: { display_name: 'A' } }, 111, () => 1000)
    await agg.ingest({ session_id: 's2', model: { display_name: 'B' } }, 222, () => 2000)

    await agg.ingestHookEvent('Notification', 's2')
    expect(sess.send.mock.calls.at(-1)[0].p.model.short).toBe('A')
  })

  it('selected mode ignores another session needing attention', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    await agg.ingest({ session_id: 's1', model: { display_name: 'A' } }, 111, () => 1000)
    await agg.ingest({ session_id: 's2', model: { display_name: 'B' } }, 222, () => 2000)

    await agg.setFocus({ target: 'session', sessionId: 'pid:111' })
    await agg.ingestHookEvent('Notification', 's2')
    const frame = sess.send.mock.calls.at(-1)[0]
    expect(frame.p.model.short).toBe('A')
    expect(frame.p.focus).toBeUndefined()
    expect(frame.p.sessions.find((s: { id: string }) => s.id === 'pid:222').activity).toBe(
      'needs_attention',
    )
  })

  it('selects a session from a device focus event', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    await agg.ingest({ session_id: 's1', model: { display_name: 'A' } }, 111, () => 1000)
    await agg.ingest({ session_id: 's2', model: { display_name: 'B' } }, 222, () => 2000)

    await agg.setFocus({ target: 'session', sessionId: 'pid:222' })

    const frame = sess.send.mock.calls.at(-1)[0]
    expect(frame.p.model.short).toBe('B')
    expect(frame.p.sessions.find((s: { id: string }) => s.id === 'pid:222').selected).toBe(true)
  })

  it('updates one terminal slot when the same pid changes session id', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)

    await agg.ingest(
      {
        session_id: 's1',
        workspace: { current_dir: '/repo/pm' },
        model: { display_name: 'A' },
      },
      83876,
      () => 1000,
    )
    await agg.ingest(
      {
        session_id: 's2',
        workspace: { current_dir: '/repo/pm' },
        model: { display_name: 'B' },
      },
      83876,
      () => 2000,
    )
    await agg.ingest(
      {
        session_id: 'other',
        workspace: { current_dir: '/repo/m5toys' },
        model: { display_name: 'C' },
      },
      34930,
      () => 3000,
    )

    const frame = sess.send.mock.calls.at(-1)[0]
    expect(frame.p.focus).toBeUndefined()
    expect(frame.p.sessions.map((s: { id: string; name: string }) => [s.id, s.name])).toEqual([
      ['pid:83876', 'pm'],
      ['pid:34930', 'm5toys'],
    ])
  })

  it('routes hook events through old and new session aliases for one terminal slot', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)

    await agg.ingest({ session_id: 's1', model: { display_name: 'A' } }, 111, () => 1000)
    await agg.ingest({ session_id: 's2', model: { display_name: 'B' } }, 111, () => 2000)

    await agg.ingestHookEvent('Notification', 's1')
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('needs_attention')

    await agg.ingestHookEvent('UserPromptSubmit', 's2')
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('working')
  })

  it('disambiguates duplicate terminal names', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)

    await agg.ingest({ session_id: 's1', workspace: { current_dir: '/a/pm' } }, 111, () => 1000)
    await agg.ingest({ session_id: 's2', workspace: { current_dir: '/b/pm' } }, 222, () => 2000)

    const frame = sess.send.mock.calls.at(-1)[0]
    expect(frame.p.sessions.map((s: { name: string }) => s.name)).toEqual(['pm', 'pm #2'])
  })

  it('ignores hook events without a known session id', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, {
      enrich: async () => undefined,
    } as never)
    await agg.ingest({ session_id: 's1', model: { display_name: 'A' } }, 111, () => 1000)

    await agg.ingestHookEvent('Notification')
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('working')
  })
})
