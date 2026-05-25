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

export type HelloAckPayload = z.infer<typeof helloAckPayload>
export type NotifyAckPayload = z.infer<typeof notifyAckPayload>
export type DeviceEventPayload = z.infer<typeof deviceEventPayload>
export type PongPayload = z.infer<typeof pongPayload>
