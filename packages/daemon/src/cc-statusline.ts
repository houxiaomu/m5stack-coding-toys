import type { StatusPayload } from '@m5stack-coding-toys/protocol'

/** Raw shape of Claude Code's statusLine stdin JSON (only fields we read). */
export interface StatusLineInput {
  session_id?: string
  model?: { id?: string; display_name?: string }
  context_window?: {
    used_percentage?: number | null
    total_input_tokens?: number | null
    context_window_size?: number | null
    current_usage?: unknown
  }
  exceeds_200k_tokens?: boolean
  cost?: {
    total_cost_usd?: number
    total_duration_ms?: number
    total_lines_added?: number
    total_lines_removed?: number
  }
  rate_limits?: {
    five_hour?: { used_percentage?: number; resets_at?: number }
    seven_day?: { used_percentage?: number; resets_at?: number }
  }
  workspace?: { current_dir?: string }
  worktree?: { name?: string }
  pr?: { number?: number; review_state?: string }
}

/** Partial status — everything the host can derive from CC alone (no git/history). */
export type StatusFromCC = Omit<Partial<StatusPayload>, 'state' | 'git' | 'burnHistory' | 'today'>

function defined<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined
}

/** Build an object containing only the defined keys. Returns undefined if empty. */
function compact<T extends Record<string, unknown>>(obj: T): T | undefined {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) if (defined(v)) out[k] = v
  return Object.keys(out).length > 0 ? (out as T) : undefined
}

export function mapStatusLineInput(cc: StatusLineInput, nowMs: number): StatusFromCC {
  const out: StatusFromCC = {}

  if (defined(cc.model?.id) || defined(cc.model?.display_name)) {
    out.model = compact({ id: cc.model?.id, short: cc.model?.display_name })
  }

  const ctx = cc.context_window
  if (ctx) {
    out.context = compact({
      usedPct: defined(ctx.used_percentage) ? ctx.used_percentage : undefined,
      tokens: defined(ctx.total_input_tokens) ? ctx.total_input_tokens : undefined,
      limit: defined(ctx.context_window_size) ? ctx.context_window_size : undefined,
      exceeds200k: defined(cc.exceeds_200k_tokens) ? cc.exceeds_200k_tokens : undefined,
    })
  }

  if (cc.cost) {
    out.cost = compact({
      sessionUsd: cc.cost.total_cost_usd,
      durationMin: defined(cc.cost.total_duration_ms)
        ? Math.round(cc.cost.total_duration_ms / 60000)
        : undefined,
      linesAdded: cc.cost.total_lines_added,
      linesRemoved: cc.cost.total_lines_removed,
    })
  }

  const fh = cc.rate_limits?.five_hour
  if (fh && (defined(fh.used_percentage) || defined(fh.resets_at))) {
    out.block = compact({
      usedPct: fh.used_percentage,
      resetAt: fh.resets_at,
      resetInMin: defined(fh.resets_at)
        ? Math.max(0, Math.round((fh.resets_at * 1000 - nowMs) / 60000))
        : undefined,
    })
  }

  const sd = cc.rate_limits?.seven_day
  if (sd && (defined(sd.used_percentage) || defined(sd.resets_at))) {
    out.weekly = compact({ usedPct: sd.used_percentage, resetAt: sd.resets_at })
  }

  if (defined(cc.workspace?.current_dir) || defined(cc.worktree?.name)) {
    out.workspace = compact({ dir: cc.workspace?.current_dir, worktree: cc.worktree?.name })
  }

  if (defined(cc.pr?.number)) {
    out.pr = compact({ number: cc.pr?.number, reviewState: cc.pr?.review_state })
  }

  return out
}
