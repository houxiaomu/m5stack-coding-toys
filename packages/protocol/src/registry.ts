import type { z } from 'zod'
import type { Kind } from './kinds.js'
import {
  deviceEventPayload,
  helloAckPayload,
  notifyAckPayload,
  pongPayload,
  screenshotAckPayload,
} from './messages-device.js'
import {
  helloPayload,
  notifyPayload,
  pingPayload,
  screenshotPayload,
  statusPayload,
} from './messages-host.js'

export const PAYLOAD_SCHEMAS = {
  hello: helloPayload,
  status: statusPayload,
  notify: notifyPayload,
  ping: pingPayload,
  screenshot: screenshotPayload,
  'hello.ack': helloAckPayload,
  'notify.ack': notifyAckPayload,
  'device.event': deviceEventPayload,
  pong: pongPayload,
  'screenshot.ack': screenshotAckPayload,
} as const satisfies Record<Kind, z.ZodTypeAny>

export type PayloadFor<K extends Kind> = z.infer<(typeof PAYLOAD_SCHEMAS)[K]>
