import { z } from 'zod'
import { ACTIVITY, CAPS, STATES, URGENCY } from './kinds.js'

const capsSchema = z.array(z.enum(CAPS))
const pct = z.number().min(0).max(100)
const nonNegInt = z.number().int().nonnegative()
const epochSec = z.number().int().nonnegative()
const sessionSummary = z
  .object({
    index: nonNegInt,
    id: z.string().min(1),
    name: z.string().min(1).max(40),
    activity: z.enum(ACTIVITY),
    selected: z.boolean().optional(),
  })
  .strict()

export const helloPayload = z.object({
  caps: capsSchema,
  time: z
    .object({
      utc_ms: z.number().int().nonnegative(), // UTC epoch milliseconds
      offset_min: z.number().int().min(-840).max(840), // minutes EAST of UTC; UTC+8 → +480
    })
    .strict()
    .optional(),
})

export const notifyPayload = z.object({
  title: z.string().min(1).max(80),
  body: z.string().max(240).optional(),
  urgency: z.enum(URGENCY),
})

export const pingPayload = z.object({}).strict()

// The single consolidated status snapshot. Only `state` is required;
// every other group is optional and may be partially present, so devices
// degrade gracefully when the host can't supply a field (e.g. non-Pro/Max
// users have no rate_limits; current_usage is null before first API call).
export const statusPayload = z
  .object({
    state: z.enum(STATES),
    activity: z.enum(ACTIVITY).optional(),
    model: z.object({ id: z.string(), short: z.string() }).partial().optional(),
    context: z
      .object({
        usedPct: pct,
        tokens: nonNegInt,
        limit: z.number().int().positive(),
        exceeds200k: z.boolean(),
      })
      .partial()
      .optional(),
    cost: z
      .object({
        sessionUsd: z.number().nonnegative(),
        burnPerHr: z.number().nonnegative(),
        durationMin: nonNegInt,
        linesAdded: nonNegInt,
        linesRemoved: nonNegInt,
      })
      .partial()
      .optional(),
    block: z
      .object({ usedPct: pct, resetAt: epochSec, resetInMin: nonNegInt })
      .partial()
      .optional(),
    weekly: z.object({ usedPct: pct, resetAt: epochSec }).partial().optional(),
    today: z
      .object({ costUsd: z.number().nonnegative(), sessions: nonNegInt })
      .partial()
      .optional(),
    burnHistory: z.array(z.number().nonnegative()).max(60).optional(),
    sessions: z.array(sessionSummary).max(8).optional(),
    workspace: z.object({ dir: z.string(), worktree: z.string() }).partial().optional(),
    git: z
      .object({
        branch: z.string(),
        ahead: nonNegInt,
        behind: nonNegInt,
        staged: nonNegInt,
        unstaged: nonNegInt,
        untracked: nonNegInt,
        lastCommit: z.object({ hash: z.string(), msg: z.string(), minsAgo: nonNegInt }).partial(),
        diff: z
          .object({
            filesChanged: nonNegInt,
            linesAdded: nonNegInt,
            linesRemoved: nonNegInt,
            topFiles: z
              .array(
                z.object({
                  path: z.string(),
                  added: nonNegInt,
                  removed: nonNegInt,
                }),
              )
              .max(3),
          })
          .partial(),
      })
      .partial()
      .optional(),
    pr: z
      .object({ number: z.number().int().positive(), reviewState: z.string() })
      .partial()
      .optional(),
  })
  .strict()

export const screenshotPayload = z.object({
  fmt: z.literal('png').default('png'),
})

export const tapPayload = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    duration_ms: z.number().int().min(1).max(5000).default(50),
  })
  .strict()

export type HelloPayload = z.infer<typeof helloPayload>
export type NotifyPayload = z.infer<typeof notifyPayload>
export type PingPayload = z.infer<typeof pingPayload>
export type StatusPayload = z.infer<typeof statusPayload>
export type ScreenshotPayload = z.infer<typeof screenshotPayload>
export type TapPayload = z.infer<typeof tapPayload>
