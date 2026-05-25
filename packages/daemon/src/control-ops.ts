import type { Socket } from 'node:net'
import type { DeviceManager, DriftEvent, ManagerState } from './device-manager.js'
import { makeLogger } from './logger.js'
import { runtimeInfo, type RuntimeInfo } from './version.js'

const log = makeLogger('control')

export interface StatusSnapshot {
  runtime: RuntimeInfo
  state: ManagerState
  board: string | null
  fw: string | null
  caps: readonly string[]
  device_id: string | null
}

export interface ControlHandler {
  status(): Promise<StatusSnapshot>
  subscribeState(sock: Socket): void
  flashHold(clientId: string): Promise<unknown>
  flashRelease(clientId: string): Promise<unknown>
}

export function makeControlHandler(dm: DeviceManager): ControlHandler {
  return {
    async status() {
      const sess = dm.currentSession()
      return {
        runtime: runtimeInfo(),
        state: dm.state(),
        board: sess?.info?.board ?? null,
        fw: sess?.info?.fw ?? null,
        caps: sess?.info?.caps ?? [],
        device_id: sess?.info?.device_id ?? null,
      }
    },
    subscribeState(sock: Socket) {
      const onState = (state: ManagerState, ctx: { from?: ManagerState }): void => {
        sock.write(`${JSON.stringify({ event: 'state', state, from: ctx?.from })}\n`)
      }
      const onDrift = (info: DriftEvent): void => {
        sock.write(`${JSON.stringify({ event: 'drift', ...info })}\n`)
      }
      dm.on('state', onState)
      dm.on('drift', onDrift)
      sock.on('close', () => {
        dm.off('state', onState)
        dm.off('drift', onDrift)
        log.debug('subscriber closed')
      })
      onState(dm.state(), {})
    },
    flashHold(clientId: string) {
      return dm.flashHold(clientId)
    },
    flashRelease(clientId: string) {
      return dm.flashRelease(clientId)
    },
  }
}
