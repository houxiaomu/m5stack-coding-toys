import { readFileSync } from 'node:fs'
import { ReadableStream, WritableStream } from 'node:stream/web'
import { ESPLoader, type LoaderOptions, Transport } from 'esptool-js'
import { SerialPort } from 'serialport'

export interface FlashFile {
  path: string
  offset: number
}
export interface FlashProgress {
  file: string
  written: number
  total: number
}
export type ProgressFn = (p: FlashProgress) => void

// esptool-js@0.6.x dropped the implementable Transport interface: Transport is
// now a concrete class wrapping a W3C Web Serial `SerialPort`. So instead of
// faking Transport, we expose a Web Serial-shaped device backed by node
// serialport and let the real Transport drive it. Only the members Transport
// touches are implemented: open/close/readable/writable/setSignals/getInfo.
class WebSerialPort {
  private sp: SerialPort | null = null
  readable: ReadableStream<Uint8Array> | null = null
  writable: WritableStream<Uint8Array> | null = null

  constructor(
    private readonly path: string,
    private readonly vendorId?: number,
    private readonly productId?: number,
  ) {}

  async open(options: { baudRate?: number }): Promise<void> {
    const sp = new SerialPort({
      path: this.path,
      baudRate: options.baudRate ?? 115200,
      autoOpen: false,
    })
    await new Promise<void>((res, rej) => sp.open((e) => (e ? rej(e) : res())))
    this.sp = sp
    this.readable = new ReadableStream<Uint8Array>({
      start(controller) {
        sp.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
        sp.on('close', () => {
          try {
            controller.close()
          } catch {
            // already closed
          }
        })
        sp.on('error', (err) => controller.error(err))
      },
    })
    this.writable = new WritableStream<Uint8Array>({
      write(chunk: Uint8Array) {
        return new Promise<void>((res, rej) =>
          sp.write(Buffer.from(chunk), (e) => (e ? rej(e) : res())),
        )
      },
    })
  }

  async close(): Promise<void> {
    const sp = this.sp
    this.readable = null
    this.writable = null
    if (sp?.isOpen) await new Promise<void>((res) => sp.close(() => res()))
    this.sp = null
  }

  async setSignals(signals: {
    dataTerminalReady?: boolean
    requestToSend?: boolean
  }): Promise<void> {
    if (!this.sp) return
    const set: { dtr?: boolean; rts?: boolean } = {}
    if (signals.dataTerminalReady !== undefined) set.dtr = signals.dataTerminalReady
    if (signals.requestToSend !== undefined) set.rts = signals.requestToSend
    await new Promise<void>((res, rej) => this.sp?.set(set, (e) => (e ? rej(e) : res())))
  }

  getInfo(): { usbVendorId?: number; usbProductId?: number } {
    return { usbVendorId: this.vendorId, usbProductId: this.productId }
  }
}

export class Flasher {
  private loader: ESPLoader | null = null
  private readonly transport: Transport
  private readonly baud: number

  constructor(opts: { port: string; baud?: number; log?: (s: string) => void }) {
    this.baud = opts.baud ?? 115200
    const device = new WebSerialPort(opts.port)
    // Transport's constructor only stores the device; it does not open it.
    this.transport = new Transport(device as unknown as never, false)
    this.log = opts.log
  }

  private readonly log?: (s: string) => void

  // Device is already in the ROM bootloader (user long-pressed RESET), so use
  // 'no_reset': sync without toggling DTR/RTS, which HWCDC can't honour anyway.
  async open(): Promise<{ chip: string }> {
    const terminal = {
      clean: () => {},
      writeLine: (d: string) => this.log?.(d),
      write: (d: string) => this.log?.(d),
    }
    const options: LoaderOptions = {
      transport: this.transport,
      baudrate: this.baud,
      terminal,
    }
    this.loader = new ESPLoader(options)
    const chip = await this.loader.main('no_reset')
    return { chip }
  }

  async erase(): Promise<void> {
    if (!this.loader) throw new Error('open() first')
    await this.loader.eraseFlash()
  }

  async write(files: FlashFile[], onProgress: ProgressFn): Promise<void> {
    if (!this.loader) throw new Error('open() first')
    const fileArray = files.map((f) => ({
      data: new Uint8Array(readFileSync(f.path)),
      address: f.offset,
    }))
    await this.loader.writeFlash({
      fileArray,
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (i: number, written: number, total: number) => {
        const f = files[i]
        if (f) onProgress({ file: f.path, written, total })
      },
    })
  }

  async close(): Promise<void> {
    await this.transport.disconnect().catch(() => {})
  }
}
