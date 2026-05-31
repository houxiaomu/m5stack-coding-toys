import { addOrUpdateDevice, readDeviceStore, writeDeviceStore } from '../device-store.js'
import type { BleAdvertisement, BleCentral, PairDeviceResult } from './types.js'

export interface PairDeviceOpts {
  central: BleCentral
  storePath: string
  timeoutMs?: number
  nowMs?: number
  select?: (devices: readonly BleAdvertisement[]) => Promise<BleAdvertisement | undefined>
  confirm?: (device: BleAdvertisement) => Promise<boolean>
}

export async function pairDevice(opts: PairDeviceOpts): Promise<PairDeviceResult> {
  const devices = await opts.central.scanPairing({ timeoutMs: opts.timeoutMs ?? 10_000 })
  if (devices.length === 0) return { ok: false, error: 'no_devices' }
  let selected: BleAdvertisement | undefined
  if (devices.length === 1) {
    selected = devices[0]
  } else if (opts.select) {
    selected = await opts.select(devices)
  } else {
    return { ok: false, error: 'multiple_devices' }
  }
  if (!selected) return { ok: false, error: 'canceled' }
  const link = await opts.central.connect(selected, { timeoutMs: opts.timeoutMs ?? 10_000 })
  const ok = opts.confirm ? await opts.confirm(selected) : true
  if (!ok) {
    await link.close()
    return { ok: false, error: 'canceled' }
  }
  const now = opts.nowMs ?? Date.now()
  const store = readDeviceStore(opts.storePath)
  const next = addOrUpdateDevice(
    store,
    {
      deviceId: selected.deviceId,
      board: selected.board,
      name: selected.name,
      transport: 'ble',
      serviceUuid: selected.serviceUuid,
      peripheralUuid: selected.peripheralUuid,
      pairedAt: now,
      lastSeenAt: now,
      lastTransport: 'ble',
    },
    { makeDefault: true },
  )
  writeDeviceStore(opts.storePath, next)
  await link.close()
  return { ok: true, deviceId: selected.deviceId }
}
