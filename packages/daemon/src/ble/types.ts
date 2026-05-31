export interface BleAdvertisement {
  deviceId: string
  board: string
  fw?: string
  name: string
  pairing: boolean
  serviceUuid: string
  peripheralUuid?: string
  rssi?: number
  pairCode?: string
  rxUuid?: string
  txUuid?: string
  infoUuid?: string
}

export interface BleCentral {
  scanPairing(opts: { timeoutMs: number }): Promise<BleAdvertisement[]>
  scanBound(opts: { deviceId: string; timeoutMs: number }): Promise<BleAdvertisement | null>
  connect(adv: BleAdvertisement, opts?: { timeoutMs?: number }): Promise<BleLink>
  close(): Promise<void>
}

export interface BleLink {
  readonly label: string
  write(bytes: Buffer): Promise<void>
  onData(fn: (bytes: Buffer) => void): void
  onClose(fn: () => void): void
  close(): Promise<void>
}

export class BleUnavailableError extends Error {
  override name = 'BleUnavailableError'

  constructor(
    message: string,
    readonly reason:
      | 'missing_backend'
      | 'powered_off'
      | 'permission_denied'
      | 'unsupported'
      | 'scan_timeout',
  ) {
    super(message)
  }
}

export type PairDeviceResult =
  | { ok: true; deviceId: string }
  | { ok: false; error: 'no_devices' | 'multiple_devices' | 'canceled' | 'backend_unavailable' }
