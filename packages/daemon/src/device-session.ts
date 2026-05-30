import { EventEmitter } from 'node:events'
import {
  type DecodedEnvelope,
  type EncodeInput,
  type Kind,
  NdjsonFramer,
  type PayloadFor,
  decode,
  encode,
} from '@m5stack-coding-toys/protocol'
import { makeLogger } from './logger.js'
import type { Transport, TransportKind } from './transport/interface.js'

const log = makeLogger('session')

export interface DeviceInfo {
  board: string
  fw: string
  caps: readonly string[]
  device_id: string
}

export interface SessionConfig {
  helloTimeoutMs: number
  pingIntervalMs: number
  pingTimeoutMs: number
}

const DEFAULT_CONFIG: SessionConfig = {
  helloTimeoutMs: 3000,
  pingIntervalMs: 5000,
  pingTimeoutMs: 3000,
}

type PendingResolver = {
  resolve: (env: DecodedEnvelope) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Derive the device clock-set payload from a host Date.
 * `offset_min` is minutes EAST of UTC (UTC+8 → +480); getTimezoneOffset()
 * returns minutes WEST (positive for west), so we negate it.
 */
export function deriveDeviceTime(now: Date): { utc_ms: number; offset_min: number } {
  return { utc_ms: now.getTime(), offset_min: -now.getTimezoneOffset() }
}

/**
 * DeviceSession owns a Transport, performs hello/heartbeat, and tracks pending
 * RPC ids. Emits 'hello' once handshake completes, 'event' for unsolicited
 * device→host messages, 'disconnect' when transport drops.
 */
export class DeviceSession extends EventEmitter {
  private framer = new NdjsonFramer()
  private pending = new Map<string, PendingResolver>()
  private device: DeviceInfo | null = null
  private idCounter = 0
  private pingTimer: NodeJS.Timeout | null = null
  private destroyed = false

  constructor(
    private readonly transport: Transport,
    private readonly cfg: SessionConfig = DEFAULT_CONFIG,
  ) {
    super()
  }

  get info(): DeviceInfo | null {
    return this.device
  }

  get caps(): readonly string[] {
    return this.device?.caps ?? []
  }

  get transportKind(): TransportKind {
    return this.transport.kind
  }

  get transportLabel(): string {
    return this.transport.label
  }

  hasCap(cap: string): boolean {
    return this.caps.includes(cap)
  }

  async start(): Promise<DeviceInfo> {
    log.info('starting session', { transport: this.transport.label })
    this.transport.on('data', (chunk: Buffer) => this.onData(chunk))
    this.transport.on('close', () => this.onDisconnect())
    if (!this.transport.connected) await this.transport.open()
    log.debug('transport connected, sending hello')

    const helloResult = await this.request(
      { k: 'hello', p: { caps: ['display', 'notify'], time: deriveDeviceTime(new Date()) } },
      this.cfg.helloTimeoutMs,
    )
    if (helloResult.k !== 'hello.ack') {
      throw new Error(`expected hello.ack, got ${helloResult.k}`)
    }
    const p = helloResult.p as {
      board: string
      fw: string
      caps: readonly string[]
      device_id: string
    }
    this.device = { board: p.board, fw: p.fw, caps: p.caps, device_id: p.device_id }
    log.info('hello complete', this.device)
    this.emit('hello', this.device)
    this.startPing()
    return this.device
  }

  /** Send a message that does not need a response. */
  async send<K extends Kind>(msg: { k: K; p: PayloadFor<K> }): Promise<void> {
    log.debug('→', { k: msg.k, p: msg.p })
    const wire = NdjsonFramer.frame(encode(msg as EncodeInput))
    await this.transport.write(wire)
  }

  /**
   * Send a request and wait for a same-id response. Timeout rejects with a
   * tagged Error so callers can fall through.
   */
  async request<K extends Kind>(
    msg: { k: K; p: PayloadFor<K> },
    timeoutMs: number,
  ): Promise<DecodedEnvelope> {
    const id = this.nextId()
    log.debug('→ request', { k: msg.k, id, timeoutMs })
    const payload: EncodeInput = { k: msg.k, id, p: msg.p } as EncodeInput
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        log.warn('request timeout', { k: msg.k, id, timeoutMs })
        const err = new Error(`request ${msg.k} timed out after ${timeoutMs}ms`)
        ;(err as Error & { code?: string }).code = 'ETIMEDOUT'
        reject(err)
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.transport.write(NdjsonFramer.frame(encode(payload))).catch((err) => {
        clearTimeout(timer)
        this.pending.delete(id)
        log.error('request write failed', { k: msg.k, id, error: (err as Error).message })
        reject(err as Error)
      })
    })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('session destroyed'))
      this.pending.delete(id)
    }
    void this.transport.close()
  }

  private nextId(): string {
    this.idCounter += 1
    return `m${this.idCounter.toString(36)}`
  }

  private onData(chunk: Buffer): void {
    const lines = this.framer.push(chunk)
    for (const line of lines) {
      // Protocol frames are JSON objects. Skip any non-`{` line silently —
      // e.g. device-side debug logging (M5CT_DBG emits `[dbg] …` lines on the
      // same serial port) is noise, not a decode failure worth surfacing.
      if (line.trimStart()[0] !== '{') continue
      let env: DecodedEnvelope
      try {
        env = decode(line)
      } catch (err) {
        log.error('decode failed', { line, error: (err as Error).message })
        this.emit('decode-error', err, line)
        continue
      }
      if (env.id && this.pending.has(env.id)) {
        log.debug('← response', { k: env.k, id: env.id })
        const r = this.pending.get(env.id)
        if (!r) continue
        clearTimeout(r.timer)
        this.pending.delete(env.id)
        r.resolve(env)
        continue
      }
      log.debug('← event', { k: env.k, p: env.p })
      this.emit('event', env)
    }
  }

  private onDisconnect(): void {
    log.warn('disconnect', { pending: this.pending.size })
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      const err = new Error('transport disconnected')
      ;(err as Error & { code?: string }).code = 'EDISCONNECT'
      p.reject(err)
      this.pending.delete(id)
    }
    this.device = null
    this.emit('disconnect')
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      this.request({ k: 'ping', p: {} }, this.cfg.pingTimeoutMs).catch(() => {
        // missed ping; let the next disconnect handler decide
      })
    }, this.cfg.pingIntervalMs)
  }
}
