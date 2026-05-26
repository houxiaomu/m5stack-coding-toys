import type { Activity, StatusPayload } from '@m5stack-coding-toys/protocol'
import type { AggregatorStore } from './aggregator-store.js'
import { type StatusLineInput, mapStatusLineInput } from './cc-statusline.js'
import type { DeviceSession } from './device-session.js'
import type { GitEnricher } from './git-enrich.js'
import { makeLogger } from './logger.js'

const log = makeLogger('aggregator')
const BURN_HISTORY_MAX = 15
const NO_PID_TTL_MS = 10 * 60_000 // fallback when shim couldn't resolve a pid

interface CostSample {
  at: number
  costUsd: number
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
 * Holds the current session status, enriches each Claude Code statusLine tick
 * with git + in-memory history, and pushes a single `status` frame to the
 * connected device. History is process-scoped (lost on daemon restart).
 */
export class SessionAggregator {
  private lastSample: CostSample | null = null
  private burnHistory: number[] = []
  private todayCost = 0
  private todayDay = ''
  private todaySessions = new Set<string>()

  private ccPid: number | undefined
  private lastActivityMs = 0
  private sessionIdle = true // start idle; first tick flips to active
  private currentActivity: Activity = 'working'
  private lastFrame: StatusPayload | null = null

  constructor(
    private readonly session: () => DeviceSession | null,
    private readonly git: GitEnricher,
    private readonly pidAlive: (pid: number) => boolean = defaultPidAlive,
    private readonly store?: AggregatorStore,
  ) {
    const saved = store?.load()
    if (saved) {
      this.burnHistory = saved.burnHistory.slice(-BURN_HISTORY_MAX)
      this.todayCost = saved.todayCost
      this.todayDay = saved.todayDay
      this.todaySessions = new Set(saved.todaySessions)
      // lastSample stays null: the first post-restart tick re-establishes the
      // burn baseline so we never emit a bogus sample across the gap.
    }
  }

  async ingest(cc: StatusLineInput, ccPid?: number, now: () => number = Date.now): Promise<void> {
    const session = this.session()
    if (!session || !session.info) return
    const nowMs = now()

    this.ccPid = ccPid
    this.lastActivityMs = nowMs
    this.sessionIdle = false

    const base = mapStatusLineInput(cc, nowMs)
    this.updateHistory(cc, nowMs)

    const dir = cc.workspace?.current_dir
    const git = dir ? await this.git.enrich(dir, nowMs) : undefined

    const frame: StatusPayload = {
      ...base,
      state: 'active',
      activity: this.currentActivity,
      ...(git ? { git } : {}),
      ...(this.burnHistory.length > 0 ? { burnHistory: [...this.burnHistory] } : {}),
      today: { costUsd: round2(this.todayCost), sessions: this.todaySessions.size },
      ...(base.cost
        ? {
            cost: {
              ...base.cost,
              ...(base.cost.sessionUsd !== undefined
                ? { sessionUsd: round2(base.cost.sessionUsd) }
                : {}),
              burnPerHr: round2(this.currentBurnPerHr()),
            },
          }
        : {}),
    }

    this.lastFrame = frame
    await session.send({ k: 'status', p: frame }).catch((err) => {
      log.error('status send failed', { error: (err as Error).message })
    })
  }

  /** A Claude Code hook fired. Update activity and immediately re-push so the
   *  badge reflects it without waiting for the next statusLine tick. Re-sends
   *  the last full frame (data preserved) with the new activity stamped. */
  async ingestHookEvent(event: string): Promise<void> {
    const session = this.session()
    if (!session || !session.info) return
    const next = hookToActivity(event)
    if (!next) return
    this.currentActivity = next
    const frame: StatusPayload = this.lastFrame
      ? { ...this.lastFrame, activity: next }
      : { state: 'active', activity: next }
    this.lastFrame = frame
    await session.send({ k: 'status', p: frame }).catch((err) => {
      log.error('activity send failed', { error: (err as Error).message })
    })
  }

  /** Called on a timer by main. Sends one `state:idle` frame when the session ends. */
  checkLiveness(now: () => number = Date.now): void {
    if (this.sessionIdle) return
    const session = this.session()
    if (!session || !session.info) return

    let ended: boolean
    if (typeof this.ccPid === 'number') {
      ended = !this.pidAlive(this.ccPid)
    } else {
      ended = now() - this.lastActivityMs > NO_PID_TTL_MS
    }
    if (!ended) return

    this.sessionIdle = true
    this.currentActivity = 'working'
    this.lastFrame = null
    this.ccPid = undefined
    log.info('session ended → idle')
    void session.send({ k: 'status', p: { state: 'idle' } }).catch((err) => {
      log.error('idle send failed', { error: (err as Error).message })
    })
  }

  private updateHistory(cc: StatusLineInput, nowMs: number): void {
    const cost = cc.cost?.total_cost_usd
    const day = localDayKey(nowMs)
    if (day !== this.todayDay) {
      this.todayDay = day
      this.todayCost = 0
      this.todaySessions.clear()
    }
    if (typeof cost === 'number') {
      this.todayCost = Math.max(this.todayCost, cost)
      if (cc.session_id) this.todaySessions.add(cc.session_id)
      if (this.lastSample) {
        const dtMin = (nowMs - this.lastSample.at) / 60000
        if (dtMin > 0.01) {
          const perMin = Math.max(0, (cost - this.lastSample.costUsd) / dtMin)
          this.burnHistory.push(round2(perMin))
          if (this.burnHistory.length > BURN_HISTORY_MAX) this.burnHistory.shift()
        }
      }
      this.lastSample = { at: nowMs, costUsd: cost }
    }
    this.persist()
  }

  private persist(): void {
    this.store?.save({
      burnHistory: this.burnHistory,
      todayCost: this.todayCost,
      todayDay: this.todayDay,
      todaySessions: [...this.todaySessions],
    })
  }

  private currentBurnPerHr(): number {
    if (this.burnHistory.length === 0) return 0
    const avgPerMin = this.burnHistory.reduce((a, b) => a + b, 0) / this.burnHistory.length
    return avgPerMin * 60
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
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
