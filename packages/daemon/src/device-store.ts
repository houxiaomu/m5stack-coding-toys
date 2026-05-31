import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { devicesPath } from './state-dir.js'

export interface PairedDevice {
  deviceId: string
  board: string
  name: string
  transport: 'ble'
  serviceUuid: string
  peripheralUuid?: string
  pairedAt: number
  lastSeenAt: number
  lastTransport?: 'ble' | 'serial'
}

export interface DeviceStoreData {
  version: 1
  defaultDeviceId: string | null
  devices: Record<string, PairedDevice>
}

export function emptyDeviceStore(): DeviceStoreData {
  return { version: 1, defaultDeviceId: null, devices: {} }
}

export function readDeviceStore(path: string = devicesPath()): DeviceStoreData {
  if (!existsSync(path)) return emptyDeviceStore()
  try {
    return normalize(JSON.parse(readFileSync(path, 'utf8')) as Partial<DeviceStoreData>)
  } catch {
    return emptyDeviceStore()
  }
}

export function writeDeviceStore(path: string, data: DeviceStoreData): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(normalize(data), null, 2)}\n`)
}

export function addOrUpdateDevice(
  data: DeviceStoreData,
  device: PairedDevice,
  opts: { makeDefault: boolean },
): DeviceStoreData {
  const next = clone(data)
  next.devices[device.deviceId] = { ...device }
  if (opts.makeDefault) next.defaultDeviceId = device.deviceId
  return next
}

export function setDefaultDevice(data: DeviceStoreData, deviceId: string): DeviceStoreData {
  if (!data.devices[deviceId]) throw new Error(`unknown device: ${deviceId}`)
  return { ...clone(data), defaultDeviceId: deviceId }
}

export function removeDevice(data: DeviceStoreData, deviceId: string): DeviceStoreData {
  if (!data.devices[deviceId]) throw new Error(`unknown device: ${deviceId}`)
  const next = clone(data)
  delete next.devices[deviceId]
  if (next.defaultDeviceId === deviceId) next.defaultDeviceId = null
  return next
}

export function markDeviceSeen(
  data: DeviceStoreData,
  deviceId: string,
  seen: { lastSeenAt: number; lastTransport: 'ble' | 'serial'; peripheralUuid?: string },
): DeviceStoreData {
  const current = data.devices[deviceId]
  if (!current) return clone(data)
  const next = clone(data)
  next.devices[deviceId] = {
    ...current,
    lastSeenAt: seen.lastSeenAt,
    lastTransport: seen.lastTransport,
    peripheralUuid: seen.peripheralUuid ?? current.peripheralUuid,
  }
  return next
}

export function resolveDeviceId(data: DeviceStoreData, query: string): string {
  if (data.devices[query]) return query
  const matches = Object.keys(data.devices).filter((id) => id.startsWith(query))
  if (matches.length === 0) throw new Error(`unknown device: ${query}`)
  if (matches.length > 1) throw new Error(`ambiguous device: ${query}`)
  const [match] = matches
  if (!match) throw new Error(`unknown device: ${query}`)
  return match
}

function normalize(raw: Partial<DeviceStoreData>): DeviceStoreData {
  const out = emptyDeviceStore()
  if (raw.version !== 1 || !raw.devices || typeof raw.devices !== 'object') return out
  for (const [id, device] of Object.entries(raw.devices)) {
    if (!isPairedDevice(device) || device.deviceId !== id) continue
    out.devices[id] = { ...device }
  }
  if (raw.defaultDeviceId && out.devices[raw.defaultDeviceId]) {
    out.defaultDeviceId = raw.defaultDeviceId
  }
  return out
}

function isPairedDevice(value: unknown): value is PairedDevice {
  const d = value as Partial<PairedDevice>
  return (
    !!d &&
    typeof d.deviceId === 'string' &&
    typeof d.board === 'string' &&
    typeof d.name === 'string' &&
    d.transport === 'ble' &&
    typeof d.serviceUuid === 'string' &&
    typeof d.pairedAt === 'number' &&
    typeof d.lastSeenAt === 'number'
  )
}

function clone(data: DeviceStoreData): DeviceStoreData {
  return {
    version: 1,
    defaultDeviceId: data.defaultDeviceId,
    devices: Object.fromEntries(
      Object.entries(data.devices).map(([id, device]) => [id, { ...device }]),
    ),
  }
}
