import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type PairedDevice,
  addOrUpdateDevice,
  emptyDeviceStore,
  writeDeviceStore,
} from '../../daemon/src/device-store.js'
import { runDevices } from './cmd-devices.js'
import { runUnpair } from './cmd-unpair.js'
import { runUse } from './cmd-use.js'

function tempStore(): { dir: string; path: string } {
  const dir = mkdtempSync(resolve(tmpdir(), 'm5ct-cli-devices-'))
  return { dir, path: resolve(dir, '.m5stack-coding-toys/devices.json') }
}

function capture() {
  const logs: string[] = []
  const errs: string[] = []
  return {
    logs,
    errs,
    io: { log: (line: string) => logs.push(line), error: (line: string) => errs.push(line) },
  }
}

function device(deviceId: string, name: string, lastSeenAt: number): PairedDevice {
  return {
    deviceId,
    board: deviceId.startsWith('M5CP') ? 'cardputer-adv' : 'cores3-se',
    name,
    transport: 'ble',
    serviceUuid: '7d9a0000-6f4f-4f24-9b56-6d3563740000',
    pairedAt: 1780127000000,
    lastSeenAt,
    lastTransport: 'ble',
  }
}

function seed(path: string): void {
  let data = emptyDeviceStore()
  data = addOrUpdateDevice(data, device('M5SE-A1B2C3', 'CoreS3 SE', 1780128600000), {
    makeDefault: true,
  })
  data = addOrUpdateDevice(data, device('M5CP-00FFAA', 'Cardputer ADV', 1780128000000), {
    makeDefault: false,
  })
  writeDeviceStore(path, data)
}

describe('device management commands', () => {
  const cleanup: string[] = []

  afterEach(() => {
    for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('prints a no-devices hint when the store is empty', () => {
    const t = tempStore()
    cleanup.push(t.dir)
    const c = capture()
    expect(runDevices({ storePath: t.path, io: c.io })).toBe(0)
    expect(c.logs).toEqual(['No paired BLE devices.', '', 'To pair a device:', '  m5ct pair'])
    expect(c.errs).toEqual([])
  })

  it('lists paired devices and marks the default', () => {
    const t = tempStore()
    cleanup.push(t.dir)
    seed(t.path)
    const c = capture()
    expect(runDevices({ storePath: t.path, io: c.io, nowMs: 1780128720000 })).toBe(0)
    expect(c.logs).toEqual([
      'Paired devices:',
      '',
      '* M5SE-A1B2C3  CoreS3 SE      last seen 2m ago   default',
      '  M5CP-00FFAA  Cardputer ADV  last seen 12m ago',
    ])
  })

  it('sets the default device by unique prefix', () => {
    const t = tempStore()
    cleanup.push(t.dir)
    seed(t.path)
    const c = capture()
    expect(runUse(['M5CP'], { storePath: t.path, io: c.io })).toBe(0)
    expect(c.logs).toEqual(['Default device set to M5CP-00FFAA.'])
    expect(c.errs).toEqual([])
  })

  it('notifies the daemon after changing the default device', () => {
    const t = tempStore()
    cleanup.push(t.dir)
    seed(t.path)
    const c = capture()
    const calls: object[] = []
    expect(
      runUse(['M5CP'], {
        storePath: t.path,
        io: c.io,
        controlCall: async (_sock, msg) => {
          calls.push(msg)
          return { ok: true }
        },
      }),
    ).toBe(0)
    expect(calls).toEqual([{ op: 'reloadDevices' }, { op: 'rescan' }])
  })

  it('reports ambiguous device prefixes', () => {
    const t = tempStore()
    cleanup.push(t.dir)
    seed(t.path)
    const c = capture()
    expect(runUse(['M5'], { storePath: t.path, io: c.io })).toBe(1)
    expect(c.errs).toEqual(['m5ct use: ambiguous device: M5'])
  })

  it('unpairs a default device and explains there is no default', () => {
    const t = tempStore()
    cleanup.push(t.dir)
    seed(t.path)
    const c = capture()
    expect(runUnpair(['M5SE'], { storePath: t.path, io: c.io })).toBe(0)
    expect(c.logs).toEqual([
      'Unpaired M5SE-A1B2C3.',
      'No default BLE device is set.',
      '',
      'To pair or select a device:',
      '  m5ct pair',
      '  m5ct use <device>',
    ])
  })

  it('notifies the daemon after unpairing a device', () => {
    const t = tempStore()
    cleanup.push(t.dir)
    seed(t.path)
    const c = capture()
    const calls: object[] = []
    expect(
      runUnpair(['M5CP'], {
        storePath: t.path,
        io: c.io,
        controlCall: async (_sock, msg) => {
          calls.push(msg)
          return { ok: true }
        },
      }),
    ).toBe(0)
    expect(calls).toEqual([{ op: 'reloadDevices' }, { op: 'rescan' }])
  })
})
