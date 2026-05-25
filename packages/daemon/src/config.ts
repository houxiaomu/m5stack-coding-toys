import { existsSync, readFileSync } from 'node:fs'
import { parse } from 'smol-toml'
import { configPath, socketPath } from './state-dir.js'

export interface DaemonConfig {
  socket: string
  log_level: 'debug' | 'info' | 'warn' | 'error'
  transport: TransportConfig
  policy: PolicyConfig
}

export type TransportConfig =
  | { kind: 'serial'; port: string; baud: number }
  | { kind: 'fake-stdio'; cmd: string[] }

export interface PolicyConfig {
  notify_timeout_ms: number
  ping_interval_ms: number
  idle_exit_ms: number
}

export function defaultConfig(): DaemonConfig {
  return {
    socket: socketPath(),
    log_level: 'info',
    transport: { kind: 'serial', port: 'auto', baud: 115200 },
    policy: {
      notify_timeout_ms: 3000,
      ping_interval_ms: 5000,
      idle_exit_ms: 600_000,
    },
  }
}

export function loadConfig(path: string = configPath()): DaemonConfig {
  if (!existsSync(path)) return defaultConfig()
  const raw = parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  return merge(defaultConfig(), raw)
}

function merge(base: DaemonConfig, raw: Record<string, unknown>): DaemonConfig {
  const out: DaemonConfig = JSON.parse(JSON.stringify(base))
  const daemon = (raw.daemon ?? {}) as Record<string, unknown>
  if (typeof daemon.socket === 'string') out.socket = daemon.socket
  if (
    typeof daemon.log_level === 'string' &&
    ['debug', 'info', 'warn', 'error'].includes(daemon.log_level)
  ) {
    out.log_level = daemon.log_level as DaemonConfig['log_level']
  }
  const transport = (raw.transport ?? {}) as Record<string, unknown>
  if (transport.kind === 'serial') {
    const s = (transport.serial ?? {}) as Record<string, unknown>
    out.transport = {
      kind: 'serial',
      port: typeof s.port === 'string' ? s.port : 'auto',
      baud: typeof s.baud === 'number' ? s.baud : 115200,
    }
  } else if (transport.kind === 'fake-stdio') {
    const f = (transport['fake-stdio'] ?? {}) as Record<string, unknown>
    out.transport = {
      kind: 'fake-stdio',
      cmd: Array.isArray(f.cmd) ? (f.cmd as string[]) : [],
    }
  }
  const policy = (raw.policy ?? {}) as Record<string, unknown>
  if (typeof policy.notify_timeout_ms === 'number') {
    out.policy.notify_timeout_ms = policy.notify_timeout_ms
  }
  if (typeof policy.ping_interval_ms === 'number') {
    out.policy.ping_interval_ms = policy.ping_interval_ms
  }
  if (typeof policy.idle_exit_ms === 'number') {
    out.policy.idle_exit_ms = policy.idle_exit_ms
  }
  return out
}
