#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { connect } from 'node:net'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDaemon } from './bootstrap.js'
import { currentClaudePid } from './ccpid.js'
import { runChained } from './chain.js'
import { runtimeLabel } from './runtime-version.js'

interface CC {
  session_id?: string
  model?: { display_name?: string }
  context_window?: { used_percentage?: number }
  cost?: { total_cost_usd?: number }
}

export function buildDaemonPayload(cc: CC, ccPid: number | null): Record<string, unknown> {
  const p: Record<string, unknown> = { statusLine: cc }
  if (ccPid !== null) p.ccPid = ccPid
  if (cc.session_id) p.sessionId = cc.session_id
  return p
}

export function buildSummary(cc: CC): string {
  const parts: string[] = []
  if (cc.model?.display_name) parts.push(cc.model.display_name)
  if (typeof cc.context_window?.used_percentage === 'number') {
    parts.push(`${Math.round(cc.context_window.used_percentage)}%`)
  }
  if (typeof cc.cost?.total_cost_usd === 'number') {
    parts.push(`$${cc.cost.total_cost_usd.toFixed(2)}`)
  }
  return parts.length > 0 ? `m5ct ${parts.join(' · ')}` : 'm5ct ·'
}

export function chainedStatusLine(home: string = process.env.HOME ?? ''): string | undefined {
  const path = resolve(home, '.m5stack-coding-toys', 'install-state.json')
  if (!existsSync(path)) return undefined
  try {
    const c = JSON.parse(readFileSync(path, 'utf8')) as { chainedStatusLine?: string }
    return c.chainedStatusLine
  } catch {
    return undefined
  }
}

export function printVersionIfRequested(
  args: readonly string[],
  writeLine: (line: string) => void = (line) => console.log(line),
): boolean {
  if (!args.includes('--version')) return false
  writeLine(runtimeLabel('m5ct-statusline'))
  return true
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => {
      buf += c
    })
    process.stdin.on('end', () => resolve(buf))
  })
}

async function main(): Promise<void> {
  const raw = await readStdin()
  let cc: CC = {}
  try {
    cc = JSON.parse(raw)
  } catch {
    process.stdout.write('m5ct ·\n')
    return
  }
  // Best-effort fire-and-forget to the daemon; never block CC.
  const sockPath = process.env.M5CT_SOCKET ?? `${process.env.HOME}/.m5stack-coding-toys/daemon.sock`
  try {
    const sock = connect(sockPath)
    const timer = setTimeout(() => sock.destroy(), 500)
    timer.unref() // never hold the event loop open on its own
    sock.on('error', () => {}) // daemon down → silently skip
    sock.on('close', () => clearTimeout(timer))
    sock.on('connect', () => {
      const payload = buildDaemonPayload(cc, currentClaudePid())
      sock.end(`${JSON.stringify(payload)}\n`)
    })
  } catch {
    // ignore
  }
  ensureDaemon()
  const chained = chainedStatusLine()
  if (chained) {
    const passthrough = await runChained(chained, raw)
    process.stdout.write(passthrough ? `${passthrough}\n` : `${buildSummary(cc)}\n`)
  } else {
    process.stdout.write(`${buildSummary(cc)}\n`)
  }
}

// Run main() only when invoked as the entry point. Compare real paths so this
// also fires under symlinked bins (global install / npm link), where argv[1] is
// the symlink but import.meta.url resolves to the real file.
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
  void main()
}
