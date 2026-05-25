import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

export function defaultSocketPath(): string {
  return process.env.M5CT_SOCKET ?? resolve(homedir(), '.m5stack-coding-toys', 'daemon.sock')
}

function detachedSpawn(cmd: string): void {
  const child = spawn(cmd, [], { detached: true, stdio: 'ignore' })
  child.on('error', () => {}) // silently ignore ENOENT / spawn errors
  child.unref()
}

export interface EnsureOpts {
  socketExists?: () => boolean
  spawnFn?: (cmd: string) => void
  daemonCmd?: string
}

/**
 * Lazily start the singleton daemon. Fire-and-forget: if the socket is present
 * we assume a daemon is (or will be) reachable; the daemon's own lockfile guard
 * makes a redundant spawn a no-op.
 */
export function ensureDaemon(opts: EnsureOpts = {}): void {
  const socketExists = opts.socketExists ?? (() => existsSync(defaultSocketPath()))
  if (socketExists()) return
  const spawnFn = opts.spawnFn ?? detachedSpawn
  spawnFn(opts.daemonCmd ?? 'm5ctd')
}
