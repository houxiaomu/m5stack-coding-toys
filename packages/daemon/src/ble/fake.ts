import { EventEmitter } from 'node:events'
import type { BleAdvertisement, BleCentral, BleLink } from './types.js'

export class FakeBleLink extends EventEmitter implements BleLink {
  readonly writes: Buffer[] = []
  closed = false

  constructor(readonly label: string) {
    super()
  }

  async write(bytes: Buffer): Promise<void> {
    this.writes.push(Buffer.from(bytes))
  }

  onData(fn: (bytes: Buffer) => void): void {
    this.on('data', fn)
  }

  onClose(fn: () => void): void {
    this.on('close', fn)
  }

  pushData(bytes: Buffer): void {
    this.emit('data', Buffer.from(bytes))
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.emit('close')
  }
}

export class FakeBleCentral implements BleCentral {
  closed = false
  readonly connectedPeripheralUuids: string[] = []
  readonly links: FakeBleLink[] = []

  constructor(private readonly advertisements: readonly BleAdvertisement[]) {}

  async scanPairing(_opts: { timeoutMs: number }): Promise<BleAdvertisement[]> {
    return this.advertisements.filter((a) => a.pairing).map((a) => ({ ...a }))
  }

  async scanBound(opts: { deviceId: string; timeoutMs: number }): Promise<BleAdvertisement | null> {
    const found = this.advertisements.find((a) => a.deviceId === opts.deviceId)
    return found ? { ...found } : null
  }

  async connect(adv: BleAdvertisement): Promise<BleLink> {
    this.connectedPeripheralUuids.push(adv.peripheralUuid ?? adv.deviceId)
    const link = new FakeBleLink(`ble:${adv.deviceId}`)
    this.links.push(link)
    return link
  }

  async close(): Promise<void> {
    this.closed = true
  }
}
