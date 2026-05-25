import { EventEmitter } from 'node:events'
import { SerialPort } from 'serialport'
import { makeLogger } from './logger.js'

const log = makeLogger('poller')

export interface PortInfo {
  path: string
  vendorId: string
  productId: string
  serialNumber?: string
}

export interface DevicePollerOpts {
  vendorIds: string[]
  intervalMs: number
}

export class DevicePoller extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private seen = new Map<string, PortInfo>()
  private running = false
  private inScan = false

  constructor(private readonly opts: DevicePollerOpts) {
    super()
  }

  start(): void {
    if (this.running) return
    this.running = true
    log.info('start', { vendorIds: this.opts.vendorIds, intervalMs: this.opts.intervalMs })
    void this.scan()
    this.timer = setInterval(() => void this.scan(), this.opts.intervalMs)
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    log.info('stop')
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.seen.clear()
  }

  private async scan(): Promise<void> {
    if (this.inScan) return
    this.inScan = true
    try {
      const wanted = new Set(this.opts.vendorIds.map((v) => v.toLowerCase()))
      const raw = await SerialPort.list()
      const present = new Map<string, PortInfo>()
      for (const p of raw) {
        const vid = (p.vendorId ?? '').toLowerCase()
        if (!wanted.has(vid)) continue
        present.set(p.path, {
          path: p.path,
          vendorId: vid,
          productId: (p.productId ?? '').toLowerCase(),
          serialNumber: p.serialNumber,
        })
      }
      for (const [path, info] of present) {
        if (!this.seen.has(path)) {
          log.info('attached', info as unknown as Record<string, unknown>)
          this.emit('attached', info)
        }
      }
      for (const [path, info] of this.seen) {
        if (!present.has(path)) {
          log.info('detached', { path })
          this.emit('detached', info)
        }
      }
      this.seen = present
    } catch (err) {
      log.warn('scan error', { error: (err as Error).message })
    } finally {
      this.inScan = false
    }
  }
}
