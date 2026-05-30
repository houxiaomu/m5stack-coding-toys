export interface BleAdvertisement {
  deviceId: string
  board: string
  name: string
  pairing: boolean
  serviceUuid: string
  peripheralUuid?: string
  rssi?: number
}

export interface BleCentral {
  scanPairing(opts: { timeoutMs: number }): Promise<BleAdvertisement[]>
  close(): Promise<void>
}

export type PairDeviceResult =
  | { ok: true; deviceId: string }
  | { ok: false; error: 'no_devices' | 'multiple_devices' | 'canceled' | 'backend_unavailable' }
