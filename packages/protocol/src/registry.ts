import type { z } from 'zod'
import type { Kind } from './kinds.js'
import {
  deviceEventPayload,
  helloAckPayload,
  notifyAckPayload,
  pongPayload,
} from './messages-device.js'
import { helloPayload, notifyPayload, pingPayload, statusPayload } from './messages-host.js'

export const PAYLOAD_SCHEMAS = {
  hello: helloPayload,
  status: statusPayload,
  notify: notifyPayload,
  ping: pingPayload,
  'hello.ack': helloAckPayload,
  'notify.ack': notifyAckPayload,
  'device.event': deviceEventPayload,
  pong: pongPayload,
} as const satisfies Record<Kind, z.ZodTypeAny>

export type PayloadFor<K extends Kind> = z.infer<(typeof PAYLOAD_SCHEMAS)[K]>
