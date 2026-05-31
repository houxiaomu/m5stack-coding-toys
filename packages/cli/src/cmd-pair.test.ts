import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeBleCentral } from '../../daemon/src/ble/fake.js'
import { BleUnavailableError, type BleAdvertisement } from '../../daemon/src/ble/types.js'
import { runPair } from './cmd-pair.js'

const SERVICE = '7d9a0000-6f4f-4f24-9b56-6d3563740000'

function capture() {
  const logs: string[] = []
  const errs: string[] = []
  return {
    logs,
    errs,
    io: { log: (line: string) => logs.push(line), error: (line: string) => errs.push(line) },
  }
}

function adv(deviceId: string): BleAdvertisement {
  return {
    deviceId,
    board: 'cores3-se',
    name: 'CoreS3 SE',
    pairing: true,
    serviceUuid: SERVICE,
    peripheralUuid: `peripheral-${deviceId}`,
  }
}

describe('runPair', () => {
  const cleanup: string[] = []

  afterEach(() => {
    for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('pairs a discovered device and prints the result', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'm5ct-cli-pair-'))
    cleanup.push(dir)
    const c = capture()
    const code = await runPair([], c.io, {
      storePath: resolve(dir, '.m5stack-coding-toys/devices.json'),
      central: new FakeBleCentral([adv('M5SE-A1B2C3')]),
      confirm: async () => true,
      nowMs: 1780128000000,
    })
    expect(code).toBe(0)
    expect(c.logs).toEqual([
      'Scanning for M5Stack devices in pairing mode...',
      'Paired M5SE-A1B2C3 as default device.',
    ])
    expect(c.errs).toEqual([])
  })

  it('prints pairing-mode guidance when no devices are found', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'm5ct-cli-pair-'))
    cleanup.push(dir)
    const c = capture()
    const code = await runPair([], c.io, {
      storePath: resolve(dir, '.m5stack-coding-toys/devices.json'),
      central: new FakeBleCentral([]),
    })
    expect(code).toBe(1)
    expect(c.errs).toEqual([
      'No devices found in pairing mode.',
      '',
      'On the M5Stack waiting screen, enter BLE pairing mode, then run:',
      '  m5ct pair',
    ])
  })

  it('uses the real backend path and notifies the daemon around pairing', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'm5ct-cli-pair-'))
    cleanup.push(dir)
    const c = capture()
    const calls: object[] = []
    const code = await runPair([], c.io, {
      storePath: resolve(dir, '.m5stack-coding-toys/devices.json'),
      createCentral: async () => new FakeBleCentral([adv('M5SE-A1B2C3')]),
      controlCall: async (_sock, msg) => {
        calls.push(msg)
        return { ok: true }
      },
      confirm: async () => true,
      nowMs: 1780128000000,
    })
    expect(code).toBe(0)
    expect(calls).toEqual([
      { op: 'pauseBle', client: 'm5ct-pair' },
      { op: 'reloadDevices' },
      { op: 'rescan' },
      { op: 'resumeBle', client: 'm5ct-pair' },
    ])
    expect(c.logs).toContain('Paired M5SE-A1B2C3 as default device.')
  })

  it('prints a powered-off hint when Bluetooth is off', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'm5ct-cli-pair-'))
    cleanup.push(dir)
    const c = capture()
    const code = await runPair([], c.io, {
      storePath: resolve(dir, '.m5stack-coding-toys/devices.json'),
      createCentral: async () => {
        throw new BleUnavailableError('Bluetooth adapter is powered off', 'powered_off')
      },
    })
    expect(code).toBe(1)
    expect(c.errs.join('\n')).toContain('Turn on Bluetooth')
  })
})
