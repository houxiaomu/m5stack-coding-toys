import { z } from 'zod'

export const PROTOCOL_VERSION = 1 as const

export const envelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1).optional(),
  k: z.string().min(1),
  t: z.number().int().nonnegative(),
  p: z.record(z.unknown()),
})

export type Envelope = z.infer<typeof envelopeSchema>
