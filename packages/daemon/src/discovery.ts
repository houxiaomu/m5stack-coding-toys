import type { EventEmitter } from 'node:events'
import type { TransportKind } from './transport/interface.js'

export interface DeviceCandidate {
  kind: TransportKind
  openKey: string
  label: string
  priority: number
  deviceId?: string
  board?: string
  lastSeenAt: number
}

export interface DeviceDiscovery extends EventEmitter {
  start(): void
  stop(): void
}

export const SERIAL_PRIORITY = 100
