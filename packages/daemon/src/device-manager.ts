import { EventEmitter } from 'node:events'
import { SERIAL_PRIORITY, type DeviceCandidate } from './discovery.js'
import type { DevicePoller, PortInfo } from './device-poller.js'
import type { DeviceProfile, DriftLevel } from './device-profile.js'
import type { DeviceSession, SessionConfig } from './device-session.js'
import { makeLogger } from './logger.js'
import type { Transport } from './transport/interface.js'

const log = makeLogger('manager')

export type ManagerState =
  | 'Scanning'
  | 'Opening'
  | 'Handshaking'
  | 'Connected'
  | 'Cooldown'
  | 'Held'

export type TransportFactory = (candidate: DeviceCandidate) => Transport
export type SessionFactory = (transport: Transport, cfg: SessionConfig) => DeviceSession

export interface DeviceManagerOpts {
  poller: DevicePoller
  transportFactory: TransportFactory
  sessionFactory: SessionFactory
  profile?: DeviceProfile
  cfg?: SessionConfig
  backoffMs?: readonly number[]
  heldTimeoutMs?: number
}

export interface DriftEvent {
  board: string
  expected: string
  actual: string
  level: DriftLevel
}

const DEFAULT_BACKOFF = [2000, 4000, 8000, 16000, 30000] as const
const DEFAULT_CFG: SessionConfig = {
  helloTimeoutMs: 3000,
  pingIntervalMs: 5000,
  pingTimeoutMs: 3000,
}

export class DeviceManager extends EventEmitter {
  private _state: ManagerState = 'Scanning'
  private session: DeviceSession | null = null
  private currentTransport: Transport | null = null
  private cooldownIdx = 0
  private cooldownTimer: NodeJS.Timeout | null = null
  private heldTimer: NodeJS.Timeout | null = null
  private heldBy: string | null = null
  private started = false
  private readonly backoff: readonly number[]
  private readonly heldTimeoutMs: number
  private readonly cfg: SessionConfig

  constructor(private readonly opts: DeviceManagerOpts) {
    super()
    this.backoff = opts.backoffMs ?? DEFAULT_BACKOFF
    this.heldTimeoutMs = opts.heldTimeoutMs ?? 60000
    this.cfg = opts.cfg ?? DEFAULT_CFG
    opts.poller.on('candidate', (candidate: DeviceCandidate) => this.onCandidate(candidate))
    opts.poller.on('attached', (info: PortInfo) => this.onCandidate(serialCandidate(info)))
  }

  start(): void {
    if (this.started) return
    this.started = true
    log.info('start')
    // Initial state is already 'Scanning', so transition() would no-op.
    // Kick the poller explicitly here.
    this.opts.poller.start()
    this.emit('state', this._state, { from: this._state })
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    log.info('stop')
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer)
    if (this.heldTimer) clearTimeout(this.heldTimer)
    this.cooldownTimer = null
    this.heldTimer = null
    if (this.session) this.session.destroy()
    this.session = null
    this.opts.poller.stop()
  }

  state(): ManagerState {
    return this._state
  }
  currentSession(): DeviceSession | null {
    return this.session
  }

  async flashHold(clientId: string): Promise<{
    ok: boolean
    prevState?: ManagerState
    error?: string
    heldBy?: string
  }> {
    if (this._state === 'Held') {
      return { ok: false, error: 'already_held', heldBy: this.heldBy ?? undefined }
    }
    const prev = this._state
    log.info('flashHold', { clientId, prevState: prev })
    this.heldBy = clientId
    if (this.session) {
      this.session.destroy()
      this.session = null
    }
    if (this.currentTransport) {
      try {
        await this.currentTransport.close()
      } catch {
        /* ignore */
      }
      this.currentTransport = null
    }
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer)
      this.cooldownTimer = null
    }
    this.transition('Held')
    if (this.heldTimer) clearTimeout(this.heldTimer)
    this.heldTimer = setTimeout(() => {
      log.warn('Held timed out; auto-release', { heldBy: this.heldBy })
      this.heldBy = null
      this.heldTimer = null
      if (this._state === 'Held') this.transition('Scanning')
    }, this.heldTimeoutMs)
    return { ok: true, prevState: prev }
  }

  async flashRelease(clientId: string): Promise<{ ok: boolean; error?: string }> {
    if (this._state !== 'Held') return { ok: false, error: 'not_held' }
    if (this.heldBy && this.heldBy !== clientId) return { ok: false, error: 'wrong_client' }
    log.info('flashRelease', { clientId })
    if (this.heldTimer) clearTimeout(this.heldTimer)
    this.heldTimer = null
    this.heldBy = null
    this.transition('Scanning')
    return { ok: true }
  }

  private transition(next: ManagerState): void {
    if (this._state === next) return
    const prev = this._state
    this._state = next
    log.info('state', { from: prev, to: next })
    this.emit('state', next, { from: prev })
    if (next === 'Scanning') this.opts.poller.start()
    else this.opts.poller.stop()
  }

  private onCandidate(candidate: DeviceCandidate): void {
    if (this._state !== 'Scanning') return
    void this.openAndHandshake(candidate)
  }

  private async openAndHandshake(candidate: DeviceCandidate): Promise<void> {
    this.transition('Opening')
    let transport: Transport
    try {
      transport = this.opts.transportFactory(candidate)
      this.currentTransport = transport
      await transport.open()
    } catch (err) {
      log.warn('open failed', { candidate: candidate.label, error: (err as Error).message })
      this.currentTransport = null
      this.enterCooldown()
      return
    }
    this.transition('Handshaking')
    const session = this.opts.sessionFactory(transport, this.cfg)
    try {
      await session.start()
    } catch (err) {
      log.warn('hello failed', { error: (err as Error).message })
      session.destroy()
      this.currentTransport = null
      this.enterCooldown()
      return
    }
    this.session = session
    session.on('disconnect', () => {
      if (this.session === session) {
        this.session = null
        this.currentTransport = null
        if (this._state === 'Connected') this.enterCooldown()
      }
    })
    this.cooldownIdx = 0
    this.transition('Connected')
    this.emit('connected', session.info)
    if (session.info && this.opts.profile) {
      const { board, fw } = session.info
      const level = this.opts.profile.driftLevel(board, fw)
      if (level !== 'none') {
        const expected = this.opts.profile.expectedVersion(board) ?? '?'
        log.warn('fw drift', { board, expected, actual: fw, level })
        const event: DriftEvent = { board, expected, actual: fw, level }
        this.emit('drift', event)
      }
    }
  }

  private enterCooldown(): void {
    this.transition('Cooldown')
    const idx = Math.min(this.cooldownIdx, this.backoff.length - 1)
    const delay = this.backoff[idx] ?? 30000
    this.cooldownIdx += 1
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer)
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = null
      if (this._state === 'Cooldown' && this.started) this.transition('Scanning')
    }, delay)
  }
}

function serialCandidate(info: PortInfo): DeviceCandidate {
  return {
    kind: 'serial',
    openKey: info.path,
    label: info.path,
    priority: SERIAL_PRIORITY,
    deviceId: info.serialNumber,
    lastSeenAt: Date.now(),
  }
}
