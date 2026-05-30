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

export interface BleLink {
  readonly label: string
  write(bytes: Buffer): Promise<void>
  onData(fn: (bytes: Buffer) => void): void
  close(): Promise<void>
}

export class BleUnavailableError extends Error {
  override name = 'BleUnavailableError'

  constructor(
    message: string,
    readonly reason: 'missing_backend' | 'powered_off' | 'permission_denied' | 'unsupported',
  ) {
    super(message)
  }
}

export type PairDeviceResult =
  | { ok: true; deviceId: string }
  | { ok: false; error: 'no_devices' | 'multiple_devices' | 'canceled' | 'backend_unavailable' }
