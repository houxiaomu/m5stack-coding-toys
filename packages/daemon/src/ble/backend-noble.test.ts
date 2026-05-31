import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createNobleCentral } from './backend-noble.js'
import {
  M5CT_BLE_INFO_UUID,
  M5CT_BLE_RX_UUID,
  M5CT_BLE_SERVICE_UUID,
  M5CT_BLE_TX_UUID,
} from './constants.js'
import { BleUnavailableError } from './types.js'

const svc = M5CT_BLE_SERVICE_UUID.replaceAll('-', '')
const rx = M5CT_BLE_RX_UUID.replaceAll('-', '')
const tx = M5CT_BLE_TX_UUID.replaceAll('-', '')
const info = M5CT_BLE_INFO_UUID.replaceAll('-', '')

class FakeCharacteristic extends EventEmitter {
  writes: Buffer[] = []

  constructor(
    readonly uuid: string,
    private readonly readValue: Buffer = Buffer.alloc(0),
  ) {
    super()
  }

  async readAsync(): Promise<Buffer> {
    return this.readValue
  }

  async writeAsync(bytes: Buffer): Promise<void> {
    this.writes.push(Buffer.from(bytes))
  }

  async subscribeAsync(): Promise<void> {}
}

class FakePeripheral extends EventEmitter {
  readonly rxChar = new FakeCharacteristic(rx)
  readonly txChar = new FakeCharacteristic(tx)
  readonly infoChar: FakeCharacteristic
  connected = false

  constructor(
    readonly uuid: string,
    readonly advertisement: Record<string, unknown>,
    readonly rssi: number,
  ) {
    super()
    this.infoChar = new FakeCharacteristic(
      info,
      Buffer.from(
        JSON.stringify({
          v: 1,
          board: 'cores3-se',
          fw: '0.4.0',
          device_id: 'M5SE-A1B2C3',
          pairing: true,
          pair_code: '123456',
        }),
      ),
    )
  }

  async connectAsync(): Promise<void> {
    this.connected = true
  }

  async disconnectAsync(): Promise<void> {
    this.connected = false
    this.emit('disconnect')
  }

  async discoverSomeServicesAndCharacteristicsAsync(): Promise<{
    characteristics: FakeCharacteristic[]
  }> {
    return { characteristics: [this.rxChar, this.txChar, this.infoChar] }
  }
}

class FakeNoble extends EventEmitter {
  scanning = false
  scanServiceUuids: string[] = []

  constructor(readonly state: string = 'poweredOn') {
    super()
  }

  async startScanningAsync(serviceUuids: string[]): Promise<void> {
    this.scanning = true
    this.scanServiceUuids = serviceUuids
  }

  async stopScanningAsync(): Promise<void> {
    this.scanning = false
  }
}

function adv(pairing = true): FakePeripheral {
  return new FakePeripheral(
    'peripheral-1',
    {
      localName: 'm5ct-M5SE-A1B2C3',
      serviceUuids: [svc],
      serviceData: [
        {
          uuid: svc,
          data: Buffer.from(
            JSON.stringify({
              device_id: 'M5SE-A1B2C3',
              board: 'cores3-se',
              pairing,
              pair_code: '123456',
            }),
          ),
        },
      ],
    },
    -52,
  )
}

describe('createNobleCentral', () => {
  it('scans pairing advertisements', async () => {
    const noble = new FakeNoble()
    const central = await createNobleCentral({ importNoble: async () => ({ default: noble }) })
    const scan = central.scanPairing({ timeoutMs: 100 })
    noble.emit('discover', adv(true))
    const devices = await scan
    expect(noble.scanServiceUuids).toEqual([svc])
    expect(devices).toEqual([
      {
        deviceId: 'M5SE-A1B2C3',
        board: 'cores3-se',
        name: 'm5ct-M5SE-A1B2C3',
        pairing: true,
        serviceUuid: M5CT_BLE_SERVICE_UUID,
        peripheralUuid: 'peripheral-1',
        rssi: -52,
        pairCode: '123456',
      },
    ])
  })

  it('connects and exposes writes plus tx notifications', async () => {
    const noble = new FakeNoble()
    const peripheral = adv(true)
    const central = await createNobleCentral({ importNoble: async () => ({ default: noble }) })
    const link = await central.connect(
      {
        deviceId: 'M5SE-A1B2C3',
        board: 'cores3-se',
        name: 'm5ct-M5SE-A1B2C3',
        pairing: true,
        serviceUuid: M5CT_BLE_SERVICE_UUID,
        peripheralUuid: 'peripheral-1',
        peripheral,
      } as never,
      { timeoutMs: 100 },
    )
    const chunks: Buffer[] = []
    let closed = false
    link.onData((bytes) => chunks.push(bytes))
    link.onClose(() => {
      closed = true
    })
    await link.write(Buffer.from('hello'))
    peripheral.txChar.emit('data', Buffer.from('world'))
    await link.close()
    expect(peripheral.rxChar.writes.map((b) => b.toString('utf8'))).toEqual(['hello'])
    expect(chunks.map((b) => b.toString('utf8'))).toEqual(['world'])
    expect(closed).toBe(true)
  })

  it('maps poweredOff to a Bluetooth unavailable error', async () => {
    await expect(
      createNobleCentral({ importNoble: async () => ({ default: new FakeNoble('poweredOff') }) }),
    ).rejects.toMatchObject({
      name: 'BleUnavailableError',
      reason: 'powered_off',
    })
  })

  it('maps a missing dynamic module to missing_backend', async () => {
    await expect(
      createNobleCentral({
        importNoble: async () => {
          const err = new Error('missing') as Error & { code?: string }
          err.code = 'ERR_MODULE_NOT_FOUND'
          throw err
        },
      }),
    ).rejects.toBeInstanceOf(BleUnavailableError)
  })
})
