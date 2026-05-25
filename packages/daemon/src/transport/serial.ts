import { EventEmitter } from 'node:events'
import { SerialPort } from 'serialport'
import { makeLogger } from '../logger.js'
import type { Transport } from './interface.js'

const log = makeLogger('serial')

export interface SerialTransportOptions {
  /** Port path (e.g. /dev/cu.usbmodem1101) or 'auto' to scan. */
  port: string
  baud: number
  /** USB VendorIDs to match when port='auto'. Default: Espressif 303a. */
  autoVendorIds?: string[]
}

export class SerialTransport extends EventEmitter implements Transport {
  private sp: SerialPort | null = null
  private _connected = false
  private resolvedPath = ''

  constructor(private readonly opts: SerialTransportOptions) {
    super()
  }

  get connected(): boolean {
    return this._connected
  }

  get label(): string {
    return `serial:${this.resolvedPath || this.opts.port}`
  }

  async open(): Promise<void> {
    if (this.sp) {
      log.debug('open called while already open', { path: this.resolvedPath })
      return
    }
    log.info('opening', { port: this.opts.port, baud: this.opts.baud })
    const path =
      this.opts.port === 'auto'
        ? await SerialTransport.findEspressifPort(this.opts.autoVendorIds)
        : this.opts.port
    this.resolvedPath = path
    log.debug('resolved path', { path })
    this.sp = new SerialPort({ path, baudRate: this.opts.baud, autoOpen: false })
    await new Promise<void>((resolve, reject) => {
      this.sp?.open((err) => (err ? reject(err) : resolve()))
    })
    log.debug('port opened, asserting DTR/RTS (HWCDC RX activation)')
    await new Promise<void>((resolve, reject) => {
      this.sp?.set({ dtr: true, rts: true }, (err) => (err ? reject(err) : resolve()))
    })
    this.sp.on('data', (chunk: Buffer) => {
      log.trace('rx', { bytes: chunk.length, utf8: chunk.toString('utf8').replace(/\n$/, '') })
      this.emit('data', chunk)
    })
    this.sp.on('close', () => {
      log.warn('port closed')
      this._connected = false
      this.emit('close')
    })
    this.sp.on('error', (err) => {
      log.error('port error', { message: err.message })
      this.emit('error', err)
    })
    this._connected = true
    log.info('open ok', { path: this.resolvedPath })
    this.emit('open')
  }

  async write(bytes: Buffer | string): Promise<void> {
    if (!this.sp) {
      log.error('write before open')
      throw new Error('SerialTransport not open')
    }
    const text = typeof bytes === 'string' ? bytes : bytes.toString('utf8')
    log.trace('tx', { bytes: text.length, utf8: text.replace(/\n$/, '') })
    await new Promise<void>((resolve, reject) => {
      this.sp?.write(bytes, (err) => (err ? reject(err) : resolve()))
    })
  }

  async close(): Promise<void> {
    if (!this.sp) return
    log.info('closing', { path: this.resolvedPath })
    const sp = this.sp
    this.sp = null
    this._connected = false
    await new Promise<void>((resolve) => sp.close(() => resolve()))
    log.debug('closed')
  }

  static async findEspressifPort(vendorIds: string[] = ['303a']): Promise<string> {
    const ports = await SerialPort.list()
    log.debug('scanning ports', { count: ports.length, vendorIds })
    const wanted = new Set(vendorIds.map((v) => v.toLowerCase()))
    for (const p of ports) {
      const vid = (p.vendorId ?? '').toLowerCase()
      log.trace('candidate', { path: p.path, vendorId: vid, productId: p.productId })
      if (wanted.has(vid)) {
        log.info('found device', { path: p.path, vendorId: vid })
        return p.path
      }
    }
    throw new Error(
      `no port matching vendor IDs ${vendorIds.join(',')} found; ` +
        `available: ${ports.map((p) => `${p.path}(${p.vendorId ?? '?'})`).join(', ')}`,
    )
  }
}
