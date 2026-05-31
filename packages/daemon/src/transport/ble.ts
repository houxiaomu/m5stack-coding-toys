import { EventEmitter } from 'node:events'
import type { BleLink } from '../ble/types.js'
import type { Transport } from './interface.js'

export interface BleTransportOpts {
  chunkSize?: number
}

export class BleTransport extends EventEmitter implements Transport {
  private _connected = false
  private readonly chunkSize: number

  constructor(
    private readonly link: BleLink,
    opts: BleTransportOpts = {},
  ) {
    super()
    this.chunkSize = opts.chunkSize ?? 180
  }

  get connected(): boolean {
    return this._connected
  }

  get label(): string {
    return this.link.label
  }

  get kind(): 'ble' {
    return 'ble'
  }

  async open(): Promise<void> {
    if (this._connected) return
    this.link.onData((bytes) => this.emit('data', Buffer.from(bytes)))
    this.link.onClose(() => {
      if (!this._connected) return
      this._connected = false
      this.emit('close')
    })
    this._connected = true
    this.emit('open')
  }

  async write(bytes: Buffer | string): Promise<void> {
    if (!this._connected) throw new Error('BleTransport not open')
    const buf = typeof bytes === 'string' ? Buffer.from(bytes) : bytes
    for (let off = 0; off < buf.length; off += this.chunkSize) {
      await this.link.write(buf.subarray(off, off + this.chunkSize))
    }
  }

  async close(): Promise<void> {
    if (!this._connected) return
    this._connected = false
    await this.link.close()
    this.emit('close')
  }
}
