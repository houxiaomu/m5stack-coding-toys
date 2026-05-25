import type { DecodedEnvelope } from '@m5stack-coding-toys/protocol'
import { makeLogger } from './logger.js'

const log = makeLogger('router')

/**
 * Handles unsolicited device→host events. v1 has no actionable events
 * (prompt.submit removed); device.event is logged for diagnostics.
 */
export class Router {
  async handleDeviceEvent(env: DecodedEnvelope): Promise<void> {
    log.debug('device event', { k: env.k, p: env.p })
  }
}
