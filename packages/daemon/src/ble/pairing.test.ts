import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readDeviceStore } from '../device-store.js'
import { FakeBleCentral } from './fake.js'
import { pairDevice } from './pairing.js'
import type { BleAdvertisement } from './types.js'

const SERVICE = '7d9a0000-6f4f-4f24-9b56-6d3563740000'

function adv(deviceId: string): BleAdvertisement {
  return {
    deviceId,
    board: 'cores3-se',
    name: 'CoreS3 SE',
    pairing: true,
    rssi: -42,
    serviceUuid: SERVICE,
    peripheralUuid: `peripheral-${deviceId}`,
  }
}

function tempStore(): { dir: string; path: string } {
  const dir = mkdtempSync(resolve(tmpdir(), 'm5ct-pair-'))
  return { dir, path: resolve(dir, '.m5stack-coding-toys/devices.json') }
}

describe('pairDevice', () => {
  const cleanup: string[] = []

  afterEach(() => {
    for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('returns no_devices when scan finds no pairing advertisements', async () => {
    const t = tempStore()
    cleanup.push(t.dir)
    const result = await pairDevice({
      central: new FakeBleCentral([]),
      storePath: t.path,
      nowMs: 1780128000000,
    })
    expect(result).toEqual({ ok: false, error: 'no_devices' })
  })

  it('pairs one discovered device and makes it default', async () => {
    const t = tempStore()
    cleanup.push(t.dir)
    const central = new FakeBleCentral([adv('M5SE-A1B2C3')])
    const result = await pairDevice({
      central,
      storePath: t.path,
      nowMs: 1780128000000,
      confirm: async () => true,
    })
    expect(result).toEqual({ ok: true, deviceId: 'M5SE-A1B2C3' })
    expect(central.connectedPeripheralUuids).toEqual(['peripheral-M5SE-A1B2C3'])
    const store = readDeviceStore(t.path)
    expect(store.defaultDeviceId).toBe('M5SE-A1B2C3')
    expect(store.devices['M5SE-A1B2C3']).toMatchObject({
      board: 'cores3-se',
      name: 'CoreS3 SE',
      peripheralUuid: 'peripheral-M5SE-A1B2C3',
    })
  })

  it('uses the selection callback when multiple devices are found', async () => {
    const t = tempStore()
    cleanup.push(t.dir)
    const result = await pairDevice({
      central: new FakeBleCentral([adv('M5SE-A1B2C3'), adv('M5CP-00FFAA')]),
      storePath: t.path,
      nowMs: 1780128000000,
      select: async (devices) => devices[1] ?? devices[0],
      confirm: async () => true,
    })
    expect(result).toEqual({ ok: true, deviceId: 'M5CP-00FFAA' })
    expect(readDeviceStore(t.path).defaultDeviceId).toBe('M5CP-00FFAA')
  })

  it('finds a bound device by device id', async () => {
    const central = new FakeBleCentral([adv('M5SE-A1B2C3')])
    await expect(
      central.scanBound({ deviceId: 'M5SE-A1B2C3', timeoutMs: 10 }),
    ).resolves.toMatchObject({
      deviceId: 'M5SE-A1B2C3',
      pairing: true,
    })
    await expect(central.scanBound({ deviceId: 'M5SE-NONE', timeoutMs: 10 })).resolves.toBeNull()
  })

  it('does not write the store when confirmation is rejected', async () => {
    const t = tempStore()
    cleanup.push(t.dir)
    const result = await pairDevice({
      central: new FakeBleCentral([adv('M5SE-A1B2C3')]),
      storePath: t.path,
      nowMs: 1780128000000,
      confirm: async () => false,
    })
    expect(result).toEqual({ ok: false, error: 'canceled' })
    expect(readDeviceStore(t.path).devices).toEqual({})
  })
})
