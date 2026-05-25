import { spawn } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

export function defaultSocketPath(): string {
  return process.env.M5CT_SOCKET ?? resolve(homedir(), '.m5stack-coding-toys', 'daemon.sock')
}

export function defaultPidPath(): string {
  return resolve(homedir(), '.m5stack-coding-toys', 'daemon.pid')
}

function detachedSpawn(cmd: string): void {
  const child = spawn(cmd, [], { detached: true, stdio: 'ignore' })
  child.on('error', () => {}) // silently ignore ENOENT / spawn errors
  child.unref()
}

function defaultAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readPid(
  path: string,
  exists: (path: string) => boolean,
  readFile: (path: string, encoding: BufferEncoding) => string,
): number | null {
  if (!exists(path)) return null
  try {
    const parsed = JSON.parse(readFile(path, 'utf8')) as { pid?: unknown }
    return typeof parsed.pid === 'number' ? parsed.pid : null
  } catch {
    return null
  }
}

export interface EnsureOpts {
  socketPath?: string
  pidPath?: string
  exists?: (path: string) => boolean
  readFile?: (path: string, encoding: BufferEncoding) => string
  unlink?: (path: string) => void
  alive?: (pid: number) => boolean
  spawnFn?: (cmd: string) => void
  daemonCmd?: string
}

/**
 * Lazily start the singleton daemon. Fire-and-forget: if the socket is present
 * and its lockfile names a live pid, we assume a daemon is reachable. If a
 * stale socket is left behind after a crash, remove it so a fresh daemon can
 * bind the same path.
 */
export function ensureDaemon(opts: EnsureOpts = {}): void {
  const socketPath = opts.socketPath ?? defaultSocketPath()
  const pidPath = opts.pidPath ?? defaultPidPath()
  const exists = opts.exists ?? existsSync
  const readFile = opts.readFile ?? readFileSync
  const unlink = opts.unlink ?? unlinkSync
  const alive = opts.alive ?? defaultAlive

  if (exists(socketPath)) {
    const pid = readPid(pidPath, exists, readFile)
    if (pid !== null && alive(pid)) return
    try {
      unlink(socketPath)
    } catch {
      // Best effort. If removal fails, spawning still lets the daemon's own
      // bind path report the real issue instead of silently doing nothing.
    }
  }

  const spawnFn = opts.spawnFn ?? detachedSpawn
  spawnFn(opts.daemonCmd ?? 'm5ctd')
}
