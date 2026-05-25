import { z } from 'zod'
import { CAPS } from './kinds.js'

const capsSchema = z.array(z.enum(CAPS))

export const helloAckPayload = z.object({
  board: z.string().min(1),
  fw: z.string().min(1),
  caps: capsSchema,
  device_id: z.string().min(1),
  battery: z
    .object({
      pct: z.number().int().min(0).max(100),
      mV: z.number().int().optional(),
      mA: z.number().int().optional(),
      usb: z.boolean(),
    })
    .optional(),
})

export const notifyAckPayload = z.object({}).strict()

export const deviceEventPayload = z
  .object({
    kind: z.enum(['battery', 'button', 'shake']),
  })
  .passthrough()

export const pongPayload = z.object({}).strict()

// The ok/payload correlation (ok:true ⇒ png_b64/w/h present; ok:false ⇒ err)
// is enforced at the daemon call site, not by the schema — matching the
// optional-field style used by the other device payloads above.
export const screenshotAckPayload = z.object({
  ok: z.boolean(),
  w: z.number().int().positive().optional(),
  h: z.number().int().positive().optional(),
  fmt: z.literal('png').optional(),
  png_b64: z.string().optional(),
  err: z.string().optional(),
})

export type HelloAckPayload = z.infer<typeof helloAckPayload>
export type NotifyAckPayload = z.infer<typeof notifyAckPayload>
export type DeviceEventPayload = z.infer<typeof deviceEventPayload>
export type PongPayload = z.infer<typeof pongPayload>
export type ScreenshotAckPayload = z.infer<typeof screenshotAckPayload>
