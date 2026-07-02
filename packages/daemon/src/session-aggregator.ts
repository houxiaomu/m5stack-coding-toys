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

export type FocusRequest = { target: 'session'; sessionId: string }

interface TerminalSlot {
  id: string
  pid?: number
  currentSessionId?: string
  knownSessionIds: Set<string>
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
  private slots = new Map<string, TerminalSlot>()
  private sessionAliases = new Map<string, string>()
  private order: string[] = []
  private selectedSlotId: string | undefined
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
    const id = this.slotKey(cc, ccPid)
    const tracked = this.ensureSlot(id, nowMs)

    tracked.pid = ccPid ?? tracked.pid
    if (cc.session_id) this.rememberSessionAlias(tracked, cc.session_id)
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
  async ingestHookEvent(
    event: string,
    sessionId?: string,
    notification?: HookNotification,
  ): Promise<void> {
    const tracked = this.sessionForHook(sessionId)
    if (!tracked) return
    const next = hookToActivity(event, tracked.activity, notification)
    if (!next || next === tracked.activity) return
    tracked.activity = next
    if (tracked.lastFrame) {
      tracked.lastFrame = { ...tracked.lastFrame, activity: next }
    }
    await this.pushSelectedFrame()
  }

  async setFocus(req: FocusRequest): Promise<void> {
    if (this.slots.has(req.sessionId)) this.selectedSlotId = req.sessionId
    await this.pushSelectedFrame()
  }

  /** Called on a timer by main. Removes ended sessions and sends one idle frame
   * when the last live session ends. */
  checkLiveness(now: () => number = Date.now): void {
    const nowMs = now()
    let removed = false
    for (const id of [...this.order]) {
      const tracked = this.slots.get(id)
      if (!tracked) continue
      const ended =
        typeof tracked.pid === 'number'
          ? !this.pidAlive(tracked.pid)
          : nowMs - tracked.lastActivityMs > NO_PID_TTL_MS
      if (!ended) continue
      this.removeSlot(id)
      removed = true
    }

    if (!removed) return

    if (this.slots.size === 0) {
      if (this.sentIdle) return
      this.sentIdle = true
      this.selectedSlotId = undefined
      log.info('all sessions ended → idle')
      void this.sendStatus({ state: 'idle' })
      return
    }

    void this.pushSelectedFrame()
  }

  private slotKey(cc: StatusLineInput, ccPid?: number): string {
    if (typeof ccPid === 'number') return `pid:${ccPid}`
    if (cc.session_id) return `sid:${cc.session_id}`
    return ANONYMOUS_SESSION_ID
  }

  private ensureSlot(id: string, nowMs: number): TerminalSlot {
    const existing = this.slots.get(id)
    if (existing) return existing
    const tracked: TerminalSlot = {
      id,
      knownSessionIds: new Set(),
      firstSeenMs: nowMs,
      lastActivityMs: nowMs,
      activity: 'working',
      lastFrame: null,
      lastSample: null,
      burnHistory: this.slots.size === 0 ? this.restoredBurnHistory.splice(0) : [],
    }
    this.slots.set(id, tracked)
    this.order.push(id)
    return tracked
  }

  private rememberSessionAlias(tracked: TerminalSlot, sessionId: string): void {
    tracked.currentSessionId = sessionId
    tracked.knownSessionIds.add(sessionId)
    this.sessionAliases.set(sessionId, tracked.id)
  }

  private removeSlot(id: string): void {
    const tracked = this.slots.get(id)
    if (!tracked) return
    this.slots.delete(id)
    this.order = this.order.filter((x) => x !== id)
    this.todaySessionCosts.delete(id)
    for (const sessionId of tracked.knownSessionIds) {
      if (this.sessionAliases.get(sessionId) === id) this.sessionAliases.delete(sessionId)
    }
    if (this.selectedSlotId === id) this.selectedSlotId = undefined
  }

  private sessionForHook(sessionId?: string): TerminalSlot | null {
    if (sessionId) {
      const slotId = this.sessionAliases.get(sessionId) ?? sessionId
      return this.slots.get(slotId) ?? null
    }
    return this.slots.get(ANONYMOUS_SESSION_ID) ?? null
  }

  private async pushSelectedFrame(): Promise<void> {
    const selected = this.selectForeground()
    if (!selected?.lastFrame) return
    this.selectedSlotId = selected.id
    await this.sendStatus(this.decorateFrame(selected.lastFrame, selected))
  }

  private async sendStatus(frame: StatusPayload): Promise<void> {
    const device = this.session()
    if (!device || !device.info) return
    await device.send({ k: 'status', p: frame }).catch((err) => {
      log.error('status send failed', { error: (err as Error).message })
    })
  }

  private selectForeground(): TerminalSlot | null {
    if (this.selectedSlotId) {
      const current = this.slots.get(this.selectedSlotId)
      if (current) return current
    }
    return this.orderedSlots()[0] ?? null
  }

  private orderedSlots(): TerminalSlot[] {
    return this.order
      .map((id) => this.slots.get(id))
      .filter((s): s is TerminalSlot => Boolean(s?.lastFrame))
  }

  private decorateFrame(base: StatusPayload, selected: TerminalSlot): StatusPayload {
    const stamped: StatusPayload = {
      ...base,
      today: { costUsd: round2(this.currentTodayCost()), sessions: this.todaySessions.size },
    }
    const live = this.orderedSlots()
    if (live.length < 2) return stamped
    const names = this.displayNames(live)
    return {
      ...stamped,
      sessions: live.slice(0, 8).map((s, i) => ({
        index: i + 1,
        id: s.id,
        name: names.get(s.id) ?? this.sessionName(s),
        activity: s.activity,
        selected: s.id === selected.id,
      })),
    }
  }

  private displayNames(slots: TerminalSlot[]): Map<string, string> {
    const seen = new Map<string, number>()
    const out = new Map<string, string>()
    for (const slot of slots) {
      const base = this.sessionName(slot)
      const count = (seen.get(base) ?? 0) + 1
      seen.set(base, count)
      out.set(slot.id, count === 1 ? base : `${base} #${count}`)
    }
    return out
  }

  private sessionName(s: TerminalSlot): string {
    const workspace = s.lastFrame?.workspace
    if (workspace?.worktree) return workspace.worktree.slice(0, 40)
    if (workspace?.dir) {
      const parts = workspace.dir.split('/').filter(Boolean)
      const base = parts.at(-1)
      if (base) return base.slice(0, 40)
    }
    return shortId(s.id)
  }

  private updateHistory(tracked: TerminalSlot, cc: StatusLineInput, nowMs: number): void {
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
      burnHistory: this.selectedSlotId
        ? (this.slots.get(this.selectedSlotId)?.burnHistory ?? [])
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

  private currentBurnPerHr(tracked: TerminalSlot): number {
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

export interface HookNotification {
  type?: string
  message?: string
}

function hookToActivity(
  event: string,
  current: Activity,
  notification?: HookNotification,
): Activity | null {
  switch (event) {
    case 'UserPromptSubmit':
      return 'working'
    case 'PostToolUse':
      // A tool actually ran — any pending permission prompt was answered.
      return 'working'
    case 'Stop':
      return 'awaiting_input'
    case 'Notification':
      return classifyNotification(current, notification)
    default:
      return null
  }
}

/** Split Claude Code notifications into "blocked, needs a human" vs "turn is
 * over, your move" using the structured notification_type, falling back to the
 * message text for older Claude Code versions that only send `message`. */
function classifyNotification(current: Activity, n?: HookNotification): Activity | null {
  const type = n?.type ?? typeFromMessage(n?.message)
  switch (type) {
    case 'permission_prompt':
    case 'elicitation_dialog':
      return 'needs_attention'
    case 'idle_prompt':
      // An idle reminder must not clear a pending permission prompt.
      return current === 'needs_attention' ? null : 'awaiting_input'
    case 'auth_success':
    case 'elicitation_complete':
    case 'elicitation_response':
      return null
    default:
      // Unknown notification: someone asked for the human. Err on the loud side.
      return 'needs_attention'
  }
}

function typeFromMessage(message?: string): string | undefined {
  if (!message) return undefined
  if (/waiting for your input/i.test(message)) return 'idle_prompt'
  if (/permission/i.test(message)) return 'permission_prompt'
  return undefined
}

/** Local-day key (NOT UTC) so the `today` bucket resets at local midnight. */
function localDayKey(nowMs: number): string {
  const d = new Date(nowMs)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
