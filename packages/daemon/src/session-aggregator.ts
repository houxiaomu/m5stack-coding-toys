import type { Activity, StatusPayload } from '@m5stack-coding-toys/protocol'
import type { AggregatorStore } from './aggregator-store.js'
import { type StatusLineInput, mapStatusLineInput } from './cc-statusline.js'
import type { DeviceSession } from './device-session.js'
import type { GitEnricher } from './git-enrich.js'
import { makeLogger } from './logger.js'

const log = makeLogger('aggregator')
const BURN_HISTORY_MAX = 15
const NO_PID_TTL_MS = 30_000 // fallback when shim couldn't resolve a pid
const ANONYMOUS_SESSION_ID = 'anonymous'

interface CostSample {
  at: number
  costUsd: number
}

type FocusMode = 'auto' | 'pinned'
export type FocusRequest = { target: 'auto' } | { target: 'session'; sessionId: string }

interface TrackedSession {
  id: string
  pid?: number
  firstSeenMs: number
  lastActivityMs: number
  activity: Activity
  lastFrame: StatusPayload | null
  lastSample: CostSample | null
  burnHistory: number[]
  latestCostUsd?: number
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Tracks live Claude Code sessions, enriches each statusLine tick with git and
 * history, selects one foreground session, and pushes a single `status` frame to
 * the connected device.
 */
export class SessionAggregator {
  private sessions = new Map<string, TrackedSession>()
  private order: string[] = []
  private focusMode: FocusMode = 'auto'
  private pinnedSessionId: string | undefined
  private foregroundSessionId: string | undefined
  private sentIdle = true

  private todayBaseCost = 0
  private todayDay = ''
  private todaySessions = new Set<string>()
  private todaySessionCosts = new Map<string, number>()
  private restoredBurnHistory: number[] = []

  constructor(
    private readonly session: () => DeviceSession | null,
    private readonly git: GitEnricher,
    private readonly pidAlive: (pid: number) => boolean = defaultPidAlive,
    private readonly store?: AggregatorStore,
  ) {
    const saved = store?.load()
    if (saved) {
      this.restoredBurnHistory = saved.burnHistory.slice(-BURN_HISTORY_MAX)
      this.todayBaseCost = saved.todayCost
      this.todayDay = saved.todayDay
      this.todaySessions = new Set(saved.todaySessions)
    }
  }

  async ingest(cc: StatusLineInput, ccPid?: number, now: () => number = Date.now): Promise<void> {
    const nowMs = now()
    const id = this.sessionKey(cc, ccPid)
    const tracked = this.ensureSession(id, nowMs)

    tracked.pid = ccPid ?? tracked.pid
    tracked.lastActivityMs = nowMs
    tracked.activity = tracked.activity ?? 'working'
    this.sentIdle = false

    const base = mapStatusLineInput(cc, nowMs)
    this.updateHistory(tracked, cc, nowMs)

    const dir = cc.workspace?.current_dir
    const git = dir ? await this.git.enrich(dir, nowMs) : undefined

    const frame: StatusPayload = {
      ...base,
      state: 'active',
      activity: tracked.activity,
      ...(git ? { git } : {}),
      ...(tracked.burnHistory.length > 0 ? { burnHistory: [...tracked.burnHistory] } : {}),
      today: { costUsd: round2(this.currentTodayCost()), sessions: this.todaySessions.size },
      ...(base.cost
        ? {
            cost: {
              ...base.cost,
              ...(base.cost.sessionUsd !== undefined
                ? { sessionUsd: round2(base.cost.sessionUsd) }
                : {}),
              burnPerHr: round2(this.currentBurnPerHr(tracked)),
            },
          }
        : {}),
    }

    tracked.lastFrame = frame
    await this.pushSelectedFrame()
  }

  /** A Claude Code hook fired. Update the matching session and immediately
   * re-push so the badge reflects it without waiting for the next statusLine
   * tick. Unknown-session hooks are ignored to avoid wrong attribution. */
  async ingestHookEvent(event: string, sessionId?: string): Promise<void> {
    const tracked = this.sessionForHook(sessionId)
    if (!tracked) return
    const next = hookToActivity(event)
    if (!next) return
    tracked.activity = next
    if (tracked.lastFrame) {
      tracked.lastFrame = { ...tracked.lastFrame, activity: next }
    }
    await this.pushSelectedFrame()
  }

  async setFocus(req: FocusRequest): Promise<void> {
    if (req.target === 'auto') {
      this.focusMode = 'auto'
      this.pinnedSessionId = undefined
    } else if (this.sessions.has(req.sessionId)) {
      this.focusMode = 'pinned'
      this.pinnedSessionId = req.sessionId
      this.foregroundSessionId = req.sessionId
    }
    await this.pushSelectedFrame()
  }

  /** Called on a timer by main. Removes ended sessions and sends one idle frame
   * when the last live session ends. */
  checkLiveness(now: () => number = Date.now): void {
    const nowMs = now()
    let removed = false
    for (const id of [...this.order]) {
      const tracked = this.sessions.get(id)
      if (!tracked) continue
      const ended =
        typeof tracked.pid === 'number'
          ? !this.pidAlive(tracked.pid)
          : nowMs - tracked.lastActivityMs > NO_PID_TTL_MS
      if (!ended) continue
      this.sessions.delete(id)
      this.order = this.order.filter((x) => x !== id)
      this.todaySessionCosts.delete(id)
      removed = true
      if (this.pinnedSessionId === id) {
        this.focusMode = 'auto'
        this.pinnedSessionId = undefined
        this.foregroundSessionId = undefined
      }
      if (this.foregroundSessionId === id) this.foregroundSessionId = undefined
    }

    if (!removed) return

    if (this.sessions.size === 0) {
      if (this.sentIdle) return
      this.sentIdle = true
      this.foregroundSessionId = undefined
      log.info('all sessions ended → idle')
      void this.sendStatus({ state: 'idle' })
      return
    }

    void this.pushSelectedFrame()
  }

  private sessionKey(cc: StatusLineInput, ccPid?: number): string {
    return cc.session_id ?? (typeof ccPid === 'number' ? `pid:${ccPid}` : ANONYMOUS_SESSION_ID)
  }

  private ensureSession(id: string, nowMs: number): TrackedSession {
    const existing = this.sessions.get(id)
    if (existing) return existing
    const tracked: TrackedSession = {
      id,
      firstSeenMs: nowMs,
      lastActivityMs: nowMs,
      activity: 'working',
      lastFrame: null,
      lastSample: null,
      burnHistory: this.sessions.size === 0 ? this.restoredBurnHistory.splice(0) : [],
    }
    this.sessions.set(id, tracked)
    this.order.push(id)
    return tracked
  }

  private sessionForHook(sessionId?: string): TrackedSession | null {
    if (sessionId) return this.sessions.get(sessionId) ?? null
    return this.sessions.get(ANONYMOUS_SESSION_ID) ?? null
  }

  private async pushSelectedFrame(): Promise<void> {
    const selected = this.selectForeground()
    if (!selected?.lastFrame) return
    this.foregroundSessionId = selected.id
    await this.sendStatus(this.decorateFrame(selected.lastFrame, selected))
  }

  private async sendStatus(frame: StatusPayload): Promise<void> {
    const device = this.session()
    if (!device || !device.info) return
    await device.send({ k: 'status', p: frame }).catch((err) => {
      log.error('status send failed', { error: (err as Error).message })
    })
  }

  private selectForeground(): TrackedSession | null {
    if (this.focusMode === 'pinned' && this.pinnedSessionId) {
      return this.sessions.get(this.pinnedSessionId) ?? null
    }
    const attention = this.orderedSessions().find((s) => s.activity === 'needs_attention')
    if (attention) return attention
    if (this.foregroundSessionId) {
      const current = this.sessions.get(this.foregroundSessionId)
      if (current) return current
    }
    return this.orderedSessions()[0] ?? null
  }

  private orderedSessions(): TrackedSession[] {
    return this.order
      .map((id) => this.sessions.get(id))
      .filter((s): s is TrackedSession => Boolean(s?.lastFrame))
  }

  private decorateFrame(base: StatusPayload, selected: TrackedSession): StatusPayload {
    const stamped: StatusPayload = {
      ...base,
      today: { costUsd: round2(this.currentTodayCost()), sessions: this.todaySessions.size },
    }
    const live = this.orderedSessions()
    if (live.length < 2) return stamped
    const selectedIndex = live.findIndex((s) => s.id === selected.id) + 1
    return {
      ...stamped,
      focus: { mode: this.focusMode, index: selectedIndex, total: live.length },
      sessions: [
        {
          index: 0,
          id: 'auto',
          name: 'AUTO',
          activity: 'working',
          auto: true,
          selected: this.focusMode === 'auto',
        },
        ...live.slice(0, 7).map((s, i) => ({
          index: i + 1,
          id: s.id,
          name: this.sessionName(s),
          activity: s.activity,
          selected: s.id === selected.id,
          pinned: this.focusMode === 'pinned' && this.pinnedSessionId === s.id,
        })),
      ],
    }
  }

  private sessionName(s: TrackedSession): string {
    const workspace = s.lastFrame?.workspace
    if (workspace?.worktree) return workspace.worktree.slice(0, 40)
    if (workspace?.dir) {
      const parts = workspace.dir.split('/').filter(Boolean)
      const base = parts.at(-1)
      if (base) return base.slice(0, 40)
    }
    return shortId(s.id)
  }

  private updateHistory(tracked: TrackedSession, cc: StatusLineInput, nowMs: number): void {
    const cost = cc.cost?.total_cost_usd
    const day = localDayKey(nowMs)
    if (day !== this.todayDay) {
      this.todayDay = day
      this.todayBaseCost = 0
      this.todaySessions.clear()
      this.todaySessionCosts.clear()
    }
    this.todaySessions.add(tracked.id)
    if (typeof cost === 'number') {
      tracked.latestCostUsd = cost
      this.todaySessionCosts.set(tracked.id, cost)
      if (tracked.lastSample) {
        const dtMin = (nowMs - tracked.lastSample.at) / 60000
        if (dtMin > 0.01) {
          const perMin = Math.max(0, (cost - tracked.lastSample.costUsd) / dtMin)
          tracked.burnHistory.push(round2(perMin))
          if (tracked.burnHistory.length > BURN_HISTORY_MAX) tracked.burnHistory.shift()
        }
      }
      tracked.lastSample = { at: nowMs, costUsd: cost }
    }
    this.persist()
  }

  private persist(): void {
    this.store?.save({
      burnHistory: this.foregroundSessionId
        ? (this.sessions.get(this.foregroundSessionId)?.burnHistory ?? [])
        : [],
      todayCost: round2(this.currentTodayCost()),
      todayDay: this.todayDay,
      todaySessions: [...this.todaySessions],
    })
  }

  private currentTodayCost(): number {
    let liveCost = 0
    for (const cost of this.todaySessionCosts.values()) liveCost += cost
    return this.todayBaseCost + liveCost
  }

  private currentBurnPerHr(tracked: TrackedSession): number {
    if (tracked.burnHistory.length === 0) return 0
    const avgPerMin = tracked.burnHistory.reduce((a, b) => a + b, 0) / tracked.burnHistory.length
    return avgPerMin * 60
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function shortId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8)
}

function hookToActivity(event: string): Activity | null {
  switch (event) {
    case 'UserPromptSubmit':
      return 'working'
    case 'Stop':
      return 'awaiting_input'
    case 'Notification':
      return 'needs_attention'
    default:
      return null
  }
}

/** Local-day key (NOT UTC) so the `today` bucket resets at local midnight. */
function localDayKey(nowMs: number): string {
  const d = new Date(nowMs)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
