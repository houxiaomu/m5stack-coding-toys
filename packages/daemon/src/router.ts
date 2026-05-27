import type { DecodedEnvelope } from '@m5stack-coding-toys/protocol'
import { makeLogger } from './logger.js'

const log = makeLogger('router')

export type FocusRequest = { target: 'auto' } | { target: 'session'; sessionId: string }

/**
 * Handles unsolicited device→host events. Most device.event payloads are logged
 * for diagnostics; focus events are routed to the session foreground selector.
 */
export class Router {
  constructor(private readonly onFocus?: (focus: FocusRequest) => void | Promise<void>) {}

  async handleDeviceEvent(env: DecodedEnvelope): Promise<void> {
    if (env.k === 'device.event') {
      const p = env.p as { kind?: unknown; target?: unknown; sessionId?: unknown }
      if (p.kind === 'focus') {
        if (p.target === 'auto') {
          await this.onFocus?.({ target: 'auto' })
          return
        }
        if (p.target === 'session' && typeof p.sessionId === 'string') {
          await this.onFocus?.({ target: 'session', sessionId: p.sessionId })
          return
        }
      }
    }
    log.debug('device event', { k: env.k, p: env.p })
  }
}
