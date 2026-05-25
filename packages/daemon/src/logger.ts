/**
 * Structured logger for the daemon.
 *
 * Levels (low → high noise): error < warn < info < debug < trace.
 * - `error` / `warn` go to stderr; everything else to stdout.
 * - When a log file is configured (see setLogFile), every emitted line is ALSO
 *   appended to it (tee), regardless of launch method.
 * - Default level is `info`. Override via `M5CT_LOG_LEVEL` env var or
 *   `log_level` in `~/.m5stack-coding-toys/config.toml`.
 *
 * Each log line is human-readable:
 *   2026-05-23T07:01:23.456Z DEBUG transport     opening { path: "..." }
 */

import { type WriteStream, createWriteStream } from 'node:fs'

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
}

let currentLevel: LogLevel = (process.env.M5CT_LOG_LEVEL as LogLevel) ?? 'info'

let logStream: WriteStream | null = null

export function setLogLevel(level: LogLevel): void {
  if (level in LEVELS) currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

/**
 * Tee all subsequent log lines to `filePath`, truncating it first so each
 * daemon run starts a fresh log. A file-write error never crashes the daemon —
 * it just drops the file sink and keeps logging to the console.
 */
export function setLogFile(filePath: string): void {
  if (logStream) {
    logStream.end()
    logStream = null
  }
  const s = createWriteStream(filePath, { flags: 'w' })
  s.on('error', () => {
    logStream = null
  })
  logStream = s
}

/** Flush and close the log file sink (call on shutdown). Safe if none is set. */
export function closeLogFile(): Promise<void> {
  return new Promise((resolve) => {
    const s = logStream
    logStream = null
    if (!s) return resolve()
    s.end(() => resolve())
  })
}

function emit(level: LogLevel, component: string, msg: string, fields?: unknown): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return
  const ts = new Date().toISOString()
  const tail = fields !== undefined ? ` ${safeStringify(fields)}` : ''
  const line = `${ts} ${level.toUpperCase().padEnd(5)} ${component.padEnd(12)} ${msg}${tail}\n`
  if (level === 'error' || level === 'warn') process.stderr.write(line)
  else process.stdout.write(line)
  logStream?.write(line)
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export interface ComponentLogger {
  trace: (msg: string, fields?: unknown) => void
  debug: (msg: string, fields?: unknown) => void
  info: (msg: string, fields?: unknown) => void
  warn: (msg: string, fields?: unknown) => void
  error: (msg: string, fields?: unknown) => void
}

/** Create a logger bound to a specific component name. */
export function makeLogger(component: string): ComponentLogger {
  return {
    trace: (m, f) => emit('trace', component, m, f),
    debug: (m, f) => emit('debug', component, m, f),
    info: (m, f) => emit('info', component, m, f),
    warn: (m, f) => emit('warn', component, m, f),
    error: (m, f) => emit('error', component, m, f),
  }
}
