#!/usr/bin/env node
import { mkdirSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FileAggregatorStore } from './aggregator-store.js'
import { createNobleCentral } from './ble/backend-noble.js'
import { BleDiscovery } from './ble/discovery.js'
import type { StatusLineInput } from './cc-statusline.js'
import { loadConfig } from './config.js'
import { makeControlHandler } from './control-ops.js'
import { DeviceManager } from './device-manager.js'
import { DevicePoller } from './device-poller.js'
import { DeviceProfile } from './device-profile.js'
import { DeviceSession } from './device-session.js'
import {
  type DeviceStoreData,
  markDeviceSeen,
  readDeviceStore,
  writeDeviceStore,
} from './device-store.js'
import { GitEnricher } from './git-enrich.js'
import { HookServer } from './hook-server.js'
import { type LogLevel, closeLogFile, makeLogger, setLogFile, setLogLevel } from './logger.js'
import { Router } from './router.js'
import { SessionAggregator } from './session-aggregator.js'
import { acquireLock, defaultAlive, releaseLock, shouldExitIdle } from './singleton.js'
import {
  aggregatorStatePath,
  devicesPath,
  logPath,
  pidPath,
  socketPath,
  stateDir,
} from './state-dir.js'
import { BleTransport } from './transport/ble.js'
import { FakeStdioTransport } from './transport/fake-stdio.js'
import type { Transport } from './transport/interface.js'
import { SerialTransport } from './transport/serial.js'
import { runtimeLabel, version } from './version.js'

const log = makeLogger('main')

export function printVersionIfRequested(
  args: readonly string[],
  writeLine: (line: string) => void = (line) => console.log(line),
): boolean {
  if (!args.includes('--version')) return false
  writeLine(runtimeLabel('m5ctd'))
  return true
}

async function main(): Promise<void> {
  const cfg = loadConfig()
  const envLevel = process.env.M5CT_LOG_LEVEL as LogLevel | undefined
  setLogLevel((envLevel as LogLevel) ?? (cfg.log_level as LogLevel))
  mkdirSync(stateDir(), { recursive: true })
  const lock = acquireLock(pidPath(), { pid: process.pid, version: version() })
  if (lock.outcome === 'running') {
    log.info('another m5ctd already running; exiting', { holder: lock.holder })
    process.exit(0)
  }
  if (lock.outcome === 'superseded') {
    log.info('superseding older m5ctd', { holder: lock.holder })
    try {
      process.kill(lock.holder.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
    // Wait (bounded) for the old daemon to release the serial port before we
    // bind it; otherwise our open races and loses. Proceed anyway after 3s.
    const deadline = Date.now() + 3000
    while (defaultAlive(lock.holder.pid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  setLogFile(logPath()) // tee logs to ~/.m5stack-coding-toys/daemon.log (truncated each run)
  log.info('startup', { version: version(), cfg })

  const fwDist = process.env.M5CT_FW_DIST ?? resolve(process.cwd(), 'firmware/dist')
  const profile = new DeviceProfile(fwDist)

  const poller = new DevicePoller({ vendorIds: ['303a'], intervalMs: 2000 })
  const storePath = devicesPath()
  let deviceStore: DeviceStoreData = readDeviceStore(storePath)
  const reloadDevices = (): void => {
    deviceStore = readDeviceStore(storePath)
  }
  const defaultBleDevice = () => {
    const id = deviceStore.defaultDeviceId
    return id ? (deviceStore.devices[id] ?? null) : null
  }
  const bleCentral =
    cfg.transport.kind === 'serial'
      ? await createNobleCentral().catch((err) => {
          log.warn('BLE backend unavailable', { error: (err as Error).message })
          return null
        })
      : null
  const bleDiscovery = bleCentral
    ? new BleDiscovery({
        central: bleCentral,
        getDefaultDevice: defaultBleDevice,
        intervalMs: 5000,
        scanTimeoutMs: 1500,
      })
    : null
  const dm = new DeviceManager({
    discoveries: bleDiscovery ? [poller, bleDiscovery] : [poller],
    profile,
    defaultDeviceId: () => deviceStore.defaultDeviceId,
    reloadDevices,
    transportFactory: async (candidate): Promise<Transport> => {
      if (cfg.transport.kind === 'fake-stdio') return new FakeStdioTransport(cfg.transport.cmd)
      if (candidate.kind === 'ble') {
        if (!bleCentral || !candidate.ble) throw new Error('BLE candidate missing advertisement')
        const link = await bleCentral.connect(candidate.ble, { timeoutMs: 5000 })
        return new BleTransport(link)
      }
      if (cfg.transport.kind === 'serial') {
        return new SerialTransport({ port: candidate.openKey, baud: cfg.transport.baud })
      }
      throw new Error(`unsupported transport: ${(cfg.transport as { kind: string }).kind}`)
    },
    sessionFactory: (t, c) => new DeviceSession(t, c),
    cfg: {
      helloTimeoutMs: 3000,
      pingIntervalMs: cfg.policy.ping_interval_ms,
      pingTimeoutMs: 3000,
      // ~3 × 5s ≈ 15s, matching the firmware's own NoLink silence window.
      maxMissedPings: 3,
    },
  })

  const aggregator = new SessionAggregator(
    () => dm.currentSession(),
    new GitEnricher(),
    undefined,
    new FileAggregatorStore(aggregatorStatePath()),
  )
  const router = new Router((focus) => void aggregator.setFocus(focus))

  // Re-wire 'event' to router on every successful (re)connect.
  dm.on('connected', () => {
    const sess = dm.currentSession()
    if (sess) sess.on('event', (env) => void router.handleDeviceEvent(env))
    if (sess?.transportKind === 'ble' && sess.info?.device_id) {
      deviceStore = markDeviceSeen(deviceStore, sess.info.device_id, {
        lastSeenAt: Date.now(),
        lastTransport: 'ble',
      })
      writeDeviceStore(storePath, deviceStore)
    }
  })

  const sock = cfg.socket || socketPath()
  const server = new HookServer(sock)
  server.setControl(makeControlHandler(dm))
  server.setStatusLineHandler(
    (cc, meta) => void aggregator.ingest(cc as StatusLineInput, meta.ccPid),
  )
  server.setHookEventHandler((ev, meta) => void aggregator.ingestHookEvent(ev, meta.sessionId))
  let lastActivityMs = Date.now()
  server.setActivityHandler(() => {
    lastActivityMs = Date.now()
  })
  await server.listen()
  log.info('m5ctd up', { version: version(), socket: sock })

  // Fake-stdio transport (used by e2e tests) has no real serial port; the
  // poller's SerialPort.list() will never report it. Synthesize a one-shot
  // 'attached' so the manager kicks off Opening immediately.
  if (cfg.transport.kind === 'fake-stdio') {
    setImmediate(() =>
      poller.emit('attached', { path: 'fake-stdio', vendorId: '303a', productId: '0000' }),
    )
  }
  dm.start()
  const livenessTimer = setInterval(() => aggregator.checkLiveness(), 5000)
  livenessTimer.unref()

  let idleTimer: ReturnType<typeof setInterval> | null = null
  const shutdown = async (): Promise<void> => {
    clearInterval(livenessTimer)
    if (idleTimer != null) clearInterval(idleTimer)
    log.info('shutdown requested')
    dm.stop()
    await bleCentral?.close().catch(() => {})
    await server.close()
    releaseLock(pidPath())
    await closeLogFile()
    process.exit(0)
  }
  idleTimer = setInterval(() => {
    const deviceConnected = dm.currentSession()?.info != null
    if (
      shouldExitIdle({
        now: Date.now(),
        lastActivityMs,
        idleMs: cfg.policy.idle_exit_ms,
        deviceConnected,
      })
    ) {
      log.info('idle timeout reached → exiting', { idleMs: cfg.policy.idle_exit_ms })
      void shutdown()
    }
  }, 30_000)
  idleTimer.unref()
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function isEntryPoint(): boolean {
  const argv1 = process.argv[1]
  if (!argv1) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  if (printVersionIfRequested(process.argv.slice(2))) {
    process.exit(0)
  }
  main().catch((err) => {
    log.error('fatal', { error: (err as Error).message, stack: (err as Error).stack })
    process.exit(1)
  })
}
