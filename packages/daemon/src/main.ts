#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { FileAggregatorStore } from './aggregator-store.js'
import type { StatusLineInput } from './cc-statusline.js'
import { loadConfig } from './config.js'
import { makeControlHandler } from './control-ops.js'
import { DeviceManager } from './device-manager.js'
import { DevicePoller } from './device-poller.js'
import { DeviceProfile } from './device-profile.js'
import { DeviceSession } from './device-session.js'
import { GitEnricher } from './git-enrich.js'
import { HookServer } from './hook-server.js'
import { type LogLevel, closeLogFile, makeLogger, setLogFile, setLogLevel } from './logger.js'
import { Router } from './router.js'
import { SessionAggregator } from './session-aggregator.js'
import { acquireLock, defaultAlive, shouldExitIdle } from './singleton.js'
import { aggregatorStatePath, logPath, pidPath, socketPath, stateDir } from './state-dir.js'
import { FakeStdioTransport } from './transport/fake-stdio.js'
import type { Transport } from './transport/interface.js'
import { SerialTransport } from './transport/serial.js'
import { version } from './version.js'

const log = makeLogger('main')

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
  const dm = new DeviceManager({
    poller,
    profile,
    transportFactory: (path: string): Transport => {
      if (cfg.transport.kind === 'fake-stdio') return new FakeStdioTransport(cfg.transport.cmd)
      if (cfg.transport.kind === 'serial') {
        return new SerialTransport({ port: path, baud: cfg.transport.baud })
      }
      throw new Error(`unsupported transport: ${(cfg.transport as { kind: string }).kind}`)
    },
    sessionFactory: (t, c) => new DeviceSession(t, c),
    cfg: {
      helloTimeoutMs: 3000,
      pingIntervalMs: cfg.policy.ping_interval_ms,
      pingTimeoutMs: 3000,
    },
  })

  const router = new Router()
  const aggregator = new SessionAggregator(
    () => dm.currentSession(),
    new GitEnricher(),
    undefined,
    new FileAggregatorStore(aggregatorStatePath()),
  )

  // Re-wire 'event' to router on every successful (re)connect.
  dm.on('connected', () => {
    const sess = dm.currentSession()
    if (sess) sess.on('event', (env) => void router.handleDeviceEvent(env))
  })

  const sock = cfg.socket || socketPath()
  const server = new HookServer(sock)
  server.setControl(makeControlHandler(dm))
  server.setStatusLineHandler(
    (cc, meta) => void aggregator.ingest(cc as StatusLineInput, meta.ccPid),
  )
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
    await server.close()
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

main().catch((err) => {
  log.error('fatal', { error: (err as Error).message, stack: (err as Error).stack })
  process.exit(1)
})
