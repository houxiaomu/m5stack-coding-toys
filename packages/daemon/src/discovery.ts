import type { EventEmitter } from 'node:events'
import type { BleAdvertisement } from './ble/types.js'
import type { TransportKind } from './transport/interface.js'

export interface DeviceCandidate {
  kind: TransportKind
  openKey: string
  label: string
  priority: number
  deviceId?: string
  board?: string
  ble?: BleAdvertisement
  lastSeenAt: number
}

export interface DeviceDiscovery extends EventEmitter {
  start(): void
  stop(): void
}

export const SERIAL_PRIORITY = 100
export const BLE_PRIORITY = 50
