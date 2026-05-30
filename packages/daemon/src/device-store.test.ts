import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type DeviceStoreData,
  type PairedDevice,
  addOrUpdateDevice,
  emptyDeviceStore,
  readDeviceStore,
  removeDevice,
  resolveDeviceId,
  setDefaultDevice,
  writeDeviceStore,
} from './device-store.js'

function tempStore(): { dir: string; path: string } {
  const dir = mkdtempSync(resolve(tmpdir(), 'm5ct-devices-'))
  return { dir, path: resolve(dir, '.m5stack-coding-toys/devices.json') }
}

function sampleDevice(deviceId = 'M5SE-A1B2C3'): PairedDevice {
  return {
    deviceId,
    board: 'cores3-se',
    name: 'CoreS3 SE',
    transport: 'ble',
    serviceUuid: '7d9a0000-6f4f-4f24-9b56-6d3563740000',
    peripheralUuid: '3F7C4E01-2A62-4B43-9E2B-9A96E8E0A123',
    pairedAt: 1780128000000,
    lastSeenAt: 1780128600000,
    lastTransport: 'ble',
  }
}

describe('device-store', () => {
  const cleanup: string[] = []

  afterEach(() => {
    for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('returns an empty v1 store when the file is missing', () => {
    const t = tempStore()
    cleanup.push(t.dir)
    expect(readDeviceStore(t.path)).toEqual(emptyDeviceStore())
  })

  it('round-trips devices and creates the state directory', () => {
    const t = tempStore()
    cleanup.push(t.dir)
    const data: DeviceStoreData = {
      version: 1,
      defaultDeviceId: 'M5SE-A1B2C3',
      devices: { 'M5SE-A1B2C3': sampleDevice() },
    }
    writeDeviceStore(t.path, data)
    expect(readDeviceStore(t.path)).toEqual(data)
  })

  it('adds a device and makes it default when requested', () => {
    const t = tempStore()
    cleanup.push(t.dir)
    const before = emptyDeviceStore()
    const after = addOrUpdateDevice(before, sampleDevice(), { makeDefault: true })
    writeDeviceStore(t.path, after)
    expect(readDeviceStore(t.path).defaultDeviceId).toBe('M5SE-A1B2C3')
    expect(readDeviceStore(t.path).devices['M5SE-A1B2C3']?.board).toBe('cores3-se')
  })

  it('sets the default device only when the id exists', () => {
    const data = addOrUpdateDevice(emptyDeviceStore(), sampleDevice(), { makeDefault: false })
    expect(setDefaultDevice(data, 'M5SE-A1B2C3').defaultDeviceId).toBe('M5SE-A1B2C3')
    expect(() => setDefaultDevice(data, 'M5SE-XXXXXX')).toThrow(/unknown device/)
  })

  it('clears default when removing the default device', () => {
    const data = addOrUpdateDevice(emptyDeviceStore(), sampleDevice(), { makeDefault: true })
    const after = removeDevice(data, 'M5SE-A1B2C3')
    expect(after.defaultDeviceId).toBeNull()
    expect(after.devices).toEqual({})
  })

  it('resolves full ids and unique prefixes', () => {
    let data = addOrUpdateDevice(emptyDeviceStore(), sampleDevice('M5SE-A1B2C3'), {
      makeDefault: true,
    })
    data = addOrUpdateDevice(data, sampleDevice('M5CP-00FFAA'), { makeDefault: false })
    expect(resolveDeviceId(data, 'M5SE-A1B2C3')).toBe('M5SE-A1B2C3')
    expect(resolveDeviceId(data, 'M5CP')).toBe('M5CP-00FFAA')
  })

  it('rejects missing and ambiguous prefixes', () => {
    let data = addOrUpdateDevice(emptyDeviceStore(), sampleDevice('M5SE-A1B2C3'), {
      makeDefault: true,
    })
    data = addOrUpdateDevice(data, sampleDevice('M5SE-A1B2C4'), { makeDefault: false })
    expect(() => resolveDeviceId(data, 'NOPE')).toThrow(/unknown device/)
    expect(() => resolveDeviceId(data, 'M5SE')).toThrow(/ambiguous device/)
  })
})
