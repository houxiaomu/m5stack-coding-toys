import { EventEmitter } from 'node:events'
import type { DevicePoller, PortInfo } from './device-poller.js'
import type { DeviceProfile, DriftLevel } from './device-profile.js'
import type { DeviceSession, SessionConfig } from './device-session.js'
import { type DeviceCandidate, type DeviceDiscovery, SERIAL_PRIORITY } from './discovery.js'
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

export type TransportFactory = (candidate: DeviceCandidate) => Transport | Promise<Transport>
export type SessionFactory = (transport: Transport, cfg: SessionConfig) => DeviceSession

export interface DeviceManagerOpts {
  poller?: DevicePoller
  discoveries?: DeviceDiscovery[]
  transportFactory: TransportFactory
  sessionFactory: SessionFactory
  profile?: DeviceProfile
  cfg?: SessionConfig
  backoffMs?: readonly number[]
  heldTimeoutMs?: number
  defaultDeviceId?: () => string | null
  reloadDevices?: () => void
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
  maxMissedPings: 3,
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
  private candidateQueue: DeviceCandidate[] = []
  private candidateDrainScheduled = false
  private currentPriority = 0
  private blePausedBy = new Set<string>()
  private readonly backoff: readonly number[]
  private readonly heldTimeoutMs: number
  private readonly cfg: SessionConfig
  private readonly discoveries: DeviceDiscovery[]

  constructor(private readonly opts: DeviceManagerOpts) {
    super()
    this.backoff = opts.backoffMs ?? DEFAULT_BACKOFF
    this.heldTimeoutMs = opts.heldTimeoutMs ?? 60000
    this.cfg = opts.cfg ?? DEFAULT_CFG
    this.discoveries = opts.discoveries ?? (opts.poller ? [opts.poller] : [])
    for (const discovery of this.discoveries) {
      discovery.on('candidate', (candidate: DeviceCandidate) => this.onCandidate(candidate))
      discovery.on('attached', (info: PortInfo) => this.onCandidate(serialCandidate(info)))
    }
  }

  start(): void {
    if (this.started) return
    this.started = true
    log.info('start')
    // Initial state is already 'Scanning', so transition() would no-op.
    // Kick the poller explicitly here.
    this.syncDiscoveries()
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
    this.currentTransport = null
    this.currentPriority = 0
    this.candidateQueue = []
    for (const discovery of this.discoveries) discovery.stop()
  }

  state(): ManagerState {
    return this._state
  }
  currentSession(): DeviceSession | null {
    return this.session
  }

  defaultDeviceId(): string | null {
    return this.opts.defaultDeviceId?.() ?? null
  }

  async pauseBle(clientId: string): Promise<{ ok: true }> {
    this.blePausedBy.add(clientId)
    this.candidateQueue = this.candidateQueue.filter((candidate) => candidate.kind !== 'ble')
    this.syncDiscoveries()
    return { ok: true }
  }

  async resumeBle(clientId: string): Promise<{ ok: true }> {
    this.blePausedBy.delete(clientId)
    this.syncDiscoveries()
    this.rescan()
    return { ok: true }
  }

  reloadDevices(): { ok: true } {
    this.opts.reloadDevices?.()
    return { ok: true }
  }

  rescan(): { ok: true } {
    if (!this.started) return { ok: true }
    for (const discovery of this.discoveries) {
      discovery.stop()
      discovery.start()
    }
    return { ok: true }
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
    this.syncDiscoveries()
    if (next === 'Scanning') this.scheduleCandidateDrain()
  }

  private onCandidate(candidate: DeviceCandidate): void {
    if (this.blePausedBy.size > 0 && candidate.kind === 'ble') return
    if (this._state === 'Connected') {
      if (candidate.priority > this.currentPriority) void this.replaceWithCandidate(candidate)
      return
    }
    if (this._state !== 'Scanning') return
    this.candidateQueue.push(candidate)
    this.scheduleCandidateDrain()
  }

  private async openAndHandshake(candidate: DeviceCandidate): Promise<void> {
    if (this._state !== 'Scanning') return
    this.transition('Opening')
    let transport: Transport
    try {
      transport = await this.opts.transportFactory(candidate)
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
    this.currentPriority = candidate.priority
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

  private scheduleCandidateDrain(): void {
    if (this.candidateDrainScheduled) return
    this.candidateDrainScheduled = true
    setImmediate(() => {
      this.candidateDrainScheduled = false
      this.drainCandidates()
    })
  }

  private drainCandidates(): void {
    if (this._state !== 'Scanning') return
    const candidate = this.candidateQueue
      .splice(0)
      .sort((a, b) => b.priority - a.priority || b.lastSeenAt - a.lastSeenAt)[0]
    if (!candidate) return
    void this.openAndHandshake(candidate)
  }

  private async replaceWithCandidate(candidate: DeviceCandidate): Promise<void> {
    const oldSession = this.session
    const oldTransport = this.currentTransport
    this.session = null
    this.currentTransport = null
    this.currentPriority = 0
    this.transition('Scanning')
    oldSession?.destroy()
    if (oldTransport) {
      try {
        await oldTransport.close()
      } catch {
        /* ignore */
      }
    }
    await this.openAndHandshake(candidate)
  }

  private syncDiscoveries(): void {
    if (!this.started) return
    const shouldRun =
      this._state === 'Scanning' ||
      (this._state === 'Connected' && this.currentTransport?.kind === 'ble')
    if (shouldRun) {
      for (const discovery of this.discoveries) discovery.start()
    } else {
      for (const discovery of this.discoveries) discovery.stop()
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
