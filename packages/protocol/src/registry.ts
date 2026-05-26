import type { z } from 'zod'
import type { Kind } from './kinds.js'
import {
  deviceEventPayload,
  helloAckPayload,
  notifyAckPayload,
  pongPayload,
  screenshotAckPayload,
  tapAckPayload,
} from './messages-device.js'
import {
  helloPayload,
  notifyPayload,
  pingPayload,
  screenshotPayload,
  statusPayload,
  tapPayload,
} from './messages-host.js'

export const PAYLOAD_SCHEMAS = {
  hello: helloPayload,
  status: statusPayload,
  notify: notifyPayload,
  ping: pingPayload,
  screenshot: screenshotPayload,
  tap: tapPayload,
  'hello.ack': helloAckPayload,
  'notify.ack': notifyAckPayload,
  'device.event': deviceEventPayload,
  pong: pongPayload,
  'screenshot.ack': screenshotAckPayload,
  'tap.ack': tapAckPayload,
} as const satisfies Record<Kind, z.ZodTypeAny>

export type PayloadFor<K extends Kind> = z.infer<(typeof PAYLOAD_SCHEMAS)[K]>
