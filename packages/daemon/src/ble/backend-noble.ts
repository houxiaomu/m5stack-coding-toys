import { EventEmitter } from 'node:events'
import {
  M5CT_BLE_INFO_UUID,
  M5CT_BLE_RX_UUID,
  M5CT_BLE_SERVICE_UUID,
  M5CT_BLE_TX_UUID,
} from './constants.js'
import type { BleAdvertisement, BleCentral, BleLink } from './types.js'
import { BleUnavailableError } from './types.js'

export type DynamicImport = (specifier: string) => Promise<unknown>

const dynamicImport = new Function('specifier', 'return import(specifier)') as DynamicImport

interface NobleLike {
  state?: string
  on(event: 'stateChange' | 'discover', fn: (...args: never[]) => void): void
  removeListener(event: 'stateChange' | 'discover', fn: (...args: never[]) => void): void
  startScanningAsync?(serviceUuids: string[], allowDuplicates?: boolean): Promise<void>
  stopScanningAsync?(): Promise<void>
  startScanning?(serviceUuids: string[], allowDuplicates?: boolean, cb?: (err?: Error) => void): void
  stopScanning?(): void
}

interface NoblePeripheral {
  uuid?: string
  id?: string
  address?: string
  advertisement?: {
    localName?: string
    serviceUuids?: string[]
    serviceData?: Array<{ uuid?: string; data?: Buffer }>
    manufacturerData?: Buffer
  }
  rssi?: number
  on(event: 'disconnect', fn: () => void): void
  removeListener?(event: 'disconnect', fn: () => void): void
  connectAsync?(): Promise<void>
  disconnectAsync?(): Promise<void>
  connect?(cb: (err?: Error) => void): void
  disconnect?(cb?: () => void): void
  discoverSomeServicesAndCharacteristicsAsync?(
    serviceUuids: string[],
    characteristicUuids: string[],
  ): Promise<{ characteristics: NobleCharacteristic[] }>
  discoverSomeServicesAndCharacteristics?(
    serviceUuids: string[],
    characteristicUuids: string[],
    cb: (err: Error | null, services: unknown[], characteristics: NobleCharacteristic[]) => void,
  ): void
}

interface NobleCharacteristic {
  uuid: string
  on(event: 'data', fn: (data: Buffer) => void): void
  readAsync?(): Promise<Buffer>
  writeAsync?(data: Buffer, withoutResponse?: boolean): Promise<void>
  subscribeAsync?(): Promise<void>
  read?(cb: (err: Error | null, data: Buffer) => void): void
  write?(data: Buffer, withoutResponse: boolean, cb?: (err?: Error) => void): void
  subscribe?(cb?: (err?: Error) => void): void
}

interface ParsedServiceData {
  deviceId?: string
  board?: string
  pairing?: boolean
  pairCode?: string
}

export async function createNobleCentral(
  opts: { importNoble?: DynamicImport; adapterTimeoutMs?: number } = {},
): Promise<BleCentral> {
  let noble: NobleLike
  try {
    const mod = await (opts.importNoble ?? dynamicImport)('@abandonware/noble')
    noble = ((mod as { default?: unknown }).default ?? mod) as NobleLike
  } catch (err) {
    const code = (err as Error & { code?: string }).code
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      throw new BleUnavailableError('BLE backend is not installed', 'missing_backend')
    }
    throw new BleUnavailableError((err as Error).message, 'unsupported')
  }
  await waitPoweredOn(noble, opts.adapterTimeoutMs ?? 5000)
  return new NobleCentral(noble)
}

class NobleCentral implements BleCentral {
  private readonly peripherals = new Map<string, NoblePeripheral>()

  constructor(private readonly noble: NobleLike) {}

  async scanPairing(opts: { timeoutMs: number }): Promise<BleAdvertisement[]> {
    const devices = await this.scan(opts.timeoutMs, (adv) => adv.pairing)
    return devices
  }

  async scanBound(opts: {
    deviceId: string
    timeoutMs: number
  }): Promise<BleAdvertisement | null> {
    const devices = await this.scan(opts.timeoutMs, (adv) => adv.deviceId === opts.deviceId)
    return devices[0] ?? null
  }

  async connect(adv: BleAdvertisement, _opts: { timeoutMs?: number } = {}): Promise<BleLink> {
    const peripheral =
      this.peripherals.get(adv.peripheralUuid ?? '') ??
      ((adv as BleAdvertisement & { peripheral?: NoblePeripheral }).peripheral as
        | NoblePeripheral
        | undefined)
    if (!peripheral) throw new Error(`BLE peripheral not available: ${adv.deviceId}`)
    await connectPeripheral(peripheral)
    const chars = await discoverCharacteristics(peripheral)
    const rx = requiredChar(chars, M5CT_BLE_RX_UUID)
    const tx = requiredChar(chars, M5CT_BLE_TX_UUID)
    await subscribe(tx)
    return new NobleBleLink(`ble:${adv.deviceId}`, peripheral, rx, tx)
  }

  async close(): Promise<void> {
    await stopScanning(this.noble).catch(() => {})
    this.peripherals.clear()
  }

  private async scan(
    timeoutMs: number,
    keep: (adv: BleAdvertisement) => boolean,
  ): Promise<BleAdvertisement[]> {
    const found = new Map<string, BleAdvertisement>()
    const service = toNobleUuid(M5CT_BLE_SERVICE_UUID)
    return new Promise((resolve) => {
      let finishTimer: NodeJS.Timeout | null = null
      const done = () => {
        if (finishTimer) clearTimeout(finishTimer)
        this.noble.removeListener('discover', onDiscover as never)
        void stopScanning(this.noble).finally(() => resolve([...found.values()]))
      }
      const scheduleFoundDone = () => {
        if (finishTimer || timeoutMs <= 0) return
        finishTimer = setTimeout(done, Math.min(timeoutMs, 250))
      }
      const timeout = setTimeout(done, timeoutMs)
      finishTimer = timeout
      const onDiscover = (peripheral: NoblePeripheral) => {
        const adv = parseAdvertisement(peripheral)
        if (!adv || !keep(adv)) return
        this.peripherals.set(adv.peripheralUuid ?? adv.deviceId, peripheral)
        found.set(adv.deviceId, adv)
        if (finishTimer === timeout) {
          clearTimeout(timeout)
          finishTimer = null
          scheduleFoundDone()
        }
      }
      this.noble.on('discover', onDiscover as never)
      void startScanning(this.noble, [service]).catch(done)
    })
  }
}

class NobleBleLink extends EventEmitter implements BleLink {
  private closed = false

  constructor(
    readonly label: string,
    private readonly peripheral: NoblePeripheral,
    private readonly rx: NobleCharacteristic,
    tx: NobleCharacteristic,
  ) {
    super()
    tx.on('data', (data) => this.emit('data', Buffer.from(data)))
    peripheral.on('disconnect', () => {
      if (!this.closed) {
        this.closed = true
        this.emit('close')
      }
    })
  }

  async write(bytes: Buffer): Promise<void> {
    await writeCharacteristic(this.rx, Buffer.from(bytes))
  }

  onData(fn: (bytes: Buffer) => void): void {
    this.on('data', fn)
  }

  onClose(fn: () => void): void {
    this.on('close', fn)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await disconnectPeripheral(this.peripheral)
    this.emit('close')
  }
}

async function waitPoweredOn(noble: NobleLike, timeoutMs: number): Promise<void> {
  if (noble.state === 'poweredOn') return
  if (noble.state === 'poweredOff') {
    throw new BleUnavailableError('Bluetooth adapter is powered off', 'powered_off')
  }
  if (noble.state === 'unauthorized') {
    throw new BleUnavailableError('Bluetooth permission denied', 'permission_denied')
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      noble.removeListener('stateChange', onState as never)
      reject(new BleUnavailableError('Bluetooth adapter did not become ready', 'powered_off'))
    }, timeoutMs)
    const onState = (state: string) => {
      if (state === 'poweredOn') {
        clearTimeout(timer)
        noble.removeListener('stateChange', onState as never)
        resolve()
        return
      }
      if (state === 'poweredOff') {
        clearTimeout(timer)
        noble.removeListener('stateChange', onState as never)
        reject(new BleUnavailableError('Bluetooth adapter is powered off', 'powered_off'))
      }
      if (state === 'unauthorized') {
        clearTimeout(timer)
        noble.removeListener('stateChange', onState as never)
        reject(new BleUnavailableError('Bluetooth permission denied', 'permission_denied'))
      }
    }
    noble.on('stateChange', onState as never)
  })
}

async function startScanning(noble: NobleLike, serviceUuids: string[]): Promise<void> {
  if (noble.startScanningAsync) {
    await noble.startScanningAsync(serviceUuids, false)
    return
  }
  await new Promise<void>((resolve, reject) => {
    noble.startScanning?.(serviceUuids, false, (err?: Error) => (err ? reject(err) : resolve()))
  })
}

async function stopScanning(noble: NobleLike): Promise<void> {
  if (noble.stopScanningAsync) {
    await noble.stopScanningAsync()
    return
  }
  noble.stopScanning?.()
}

async function connectPeripheral(peripheral: NoblePeripheral): Promise<void> {
  if (peripheral.connectAsync) {
    await peripheral.connectAsync()
    return
  }
  await new Promise<void>((resolve, reject) => {
    peripheral.connect?.((err?: Error) => (err ? reject(err) : resolve()))
  })
}

async function disconnectPeripheral(peripheral: NoblePeripheral): Promise<void> {
  if (peripheral.disconnectAsync) {
    await peripheral.disconnectAsync()
    return
  }
  await new Promise<void>((resolve) => peripheral.disconnect?.(() => resolve()))
}

async function discoverCharacteristics(
  peripheral: NoblePeripheral,
): Promise<NobleCharacteristic[]> {
  const serviceUuids = [toNobleUuid(M5CT_BLE_SERVICE_UUID)]
  const characteristicUuids = [
    toNobleUuid(M5CT_BLE_RX_UUID),
    toNobleUuid(M5CT_BLE_TX_UUID),
    toNobleUuid(M5CT_BLE_INFO_UUID),
  ]
  if (peripheral.discoverSomeServicesAndCharacteristicsAsync) {
    const result = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
      serviceUuids,
      characteristicUuids,
    )
    return result.characteristics
  }
  return new Promise((resolve, reject) => {
    peripheral.discoverSomeServicesAndCharacteristics?.(
      serviceUuids,
      characteristicUuids,
      (err, _services, characteristics) => (err ? reject(err) : resolve(characteristics)),
    )
  })
}

function requiredChar(chars: NobleCharacteristic[], uuid: string): NobleCharacteristic {
  const wanted = toNobleUuid(uuid)
  const found = chars.find((c) => normalizeUuid(c.uuid) === wanted)
  if (!found) throw new Error(`missing BLE characteristic: ${uuid}`)
  return found
}

async function subscribe(ch: NobleCharacteristic): Promise<void> {
  if (ch.subscribeAsync) {
    await ch.subscribeAsync()
    return
  }
  await new Promise<void>((resolve, reject) => {
    ch.subscribe?.((err?: Error) => (err ? reject(err) : resolve()))
  })
}

async function writeCharacteristic(ch: NobleCharacteristic, data: Buffer): Promise<void> {
  if (ch.writeAsync) {
    await ch.writeAsync(data, false)
    return
  }
  await new Promise<void>((resolve, reject) => {
    ch.write?.(data, false, (err?: Error) => (err ? reject(err) : resolve()))
  })
}

function parseAdvertisement(peripheral: NoblePeripheral): BleAdvertisement | null {
  const a = peripheral.advertisement ?? {}
  const name = a.localName ?? ''
  const serviceUuids = (a.serviceUuids ?? []).map(normalizeUuid)
  const service = toNobleUuid(M5CT_BLE_SERVICE_UUID)
  if (!name.startsWith('m5ct-') || !serviceUuids.includes(service)) return null
  const serviceData = parseServiceData(a.serviceData, a.manufacturerData)
  const deviceId = serviceData.deviceId ?? name.replace(/^m5ct-/, '')
  if (!deviceId) return null
  return {
    deviceId,
    board: serviceData.board ?? 'unknown',
    name,
    pairing: serviceData.pairing ?? false,
    serviceUuid: M5CT_BLE_SERVICE_UUID,
    peripheralUuid: peripheral.uuid ?? peripheral.id ?? peripheral.address ?? deviceId,
    rssi: peripheral.rssi,
    pairCode: serviceData.pairCode,
  }
}

function parseServiceData(
  serviceData: Array<{ uuid?: string; data?: Buffer }> | undefined,
  manufacturerData: Buffer | undefined,
): ParsedServiceData {
  const service = toNobleUuid(M5CT_BLE_SERVICE_UUID)
  const chunks = [
    ...(serviceData ?? []).filter((d) => normalizeUuid(d.uuid ?? '') === service).map((d) => d.data),
    manufacturerData,
  ].filter((d): d is Buffer => Buffer.isBuffer(d))
  for (const chunk of chunks) {
    const parsed = parseInfoJson(chunk)
    if (parsed) return parsed
    const text = chunk.toString('utf8')
    if (text.includes('pair=1')) {
      return {
        deviceId: /id=([^;]+)/.exec(text)?.[1],
        pairing: true,
      }
    }
  }
  return {}
}

function parseInfoJson(buf: Buffer): ParsedServiceData | null {
  try {
    const raw = JSON.parse(buf.toString('utf8')) as Record<string, unknown>
    return {
      deviceId:
        typeof raw.device_id === 'string'
          ? raw.device_id
          : typeof raw.deviceId === 'string'
            ? raw.deviceId
            : undefined,
      board: typeof raw.board === 'string' ? raw.board : undefined,
      pairing: typeof raw.pairing === 'boolean' ? raw.pairing : undefined,
      pairCode:
        typeof raw.pair_code === 'string'
          ? raw.pair_code
          : typeof raw.pairCode === 'string'
            ? raw.pairCode
            : undefined,
    }
  } catch {
    return null
  }
}

function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase().replaceAll('-', '')
}

function toNobleUuid(uuid: string): string {
  return normalizeUuid(uuid)
}
