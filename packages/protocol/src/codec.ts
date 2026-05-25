import { ZodError } from 'zod'
import { PROTOCOL_VERSION, envelopeSchema } from './envelope.js'
import type { Kind } from './kinds.js'
import { PAYLOAD_SCHEMAS, type PayloadFor } from './registry.js'

export class CodecError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'CodecError'
  }
}

export interface EncodeInput<K extends Kind = Kind> {
  k: K
  id?: string
  p: PayloadFor<K>
  /** Override timestamp; defaults to Date.now(). */
  t?: number
}

export interface DecodedEnvelope<K extends Kind = Kind> {
  v: typeof PROTOCOL_VERSION
  k: K
  id?: string
  t: number
  p: PayloadFor<K>
}

export function encode<K extends Kind>(input: EncodeInput<K>): string {
  const schema = PAYLOAD_SCHEMAS[input.k]
  const payloadResult = schema.safeParse(input.p)
  if (!payloadResult.success) {
    throw new CodecError(`invalid payload for ${input.k}`, payloadResult.error)
  }
  const envelope = {
    v: PROTOCOL_VERSION,
    ...(input.id ? { id: input.id } : {}),
    k: input.k,
    t: input.t ?? Date.now(),
    p: payloadResult.data,
  }
  return JSON.stringify(envelope)
}

export function decode(line: string): DecodedEnvelope {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch (err) {
    throw new CodecError('malformed JSON', err)
  }
  const envResult = envelopeSchema.safeParse(raw)
  if (!envResult.success) {
    throw new CodecError('invalid envelope', envResult.error)
  }
  const env = envResult.data
  const kind = env.k as Kind
  const schema = PAYLOAD_SCHEMAS[kind] as (typeof PAYLOAD_SCHEMAS)[Kind] | undefined
  if (!schema) {
    throw new CodecError(`unknown kind: ${env.k}`)
  }
  const payloadResult = schema.safeParse(env.p)
  if (!payloadResult.success) {
    throw new CodecError(`invalid payload for ${env.k}`, payloadResult.error)
  }
  return {
    v: env.v,
    k: kind,
    ...(env.id ? { id: env.id } : {}),
    t: env.t,
    p: payloadResult.data,
  } as DecodedEnvelope
}

export { ZodError }
