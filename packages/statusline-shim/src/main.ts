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
  // Hook-event stdin extras (Notification):
  notification_type?: string
  message?: string
}

export function buildDaemonPayload(cc: CC, ccPid: number | null): Record<string, unknown> {
  const p: Record<string, unknown> = { statusLine: cc }
  if (ccPid !== null) p.ccPid = ccPid
  if (cc.session_id) p.sessionId = cc.session_id
  return p
}

const HOOK_EVENTS = ['UserPromptSubmit', 'Stop', 'Notification', 'PostToolUse'] as const
type HookEvent = (typeof HOOK_EVENTS)[number]

/** Extract a valid `--event <Name>` value, or undefined. */
export function parseEventFlag(args: readonly string[]): HookEvent | undefined {
  const i = args.indexOf('--event')
  if (i === -1) return undefined
  const v = args[i + 1]
  return (HOOK_EVENTS as readonly string[]).includes(v ?? '') ? (v as HookEvent) : undefined
}

/** The NDJSON frame the daemon expects for a hook event. Forwards the
 * Notification stdin extras so the daemon can classify the notification. */
export function buildHookPayload(event: HookEvent, cc: CC): Record<string, unknown> {
  const p: Record<string, unknown> = { event }
  if (typeof cc.session_id === 'string') p.sessionId = cc.session_id
  if (typeof cc.notification_type === 'string') p.notificationType = cc.notification_type
  if (typeof cc.message === 'string') p.message = cc.message
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
  const eventName = parseEventFlag(process.argv.slice(2))
  const raw = await readStdin()
  let cc: CC = {}
  try {
    cc = JSON.parse(raw)
  } catch {
    if (!eventName) process.stdout.write('m5ct ·\n')
    // event mode has no stdout contract; still try to fire below using parsed {}
  }
  const sockPath = process.env.M5CT_SOCKET ?? `${process.env.HOME}/.m5stack-coding-toys/daemon.sock`
  const payload = eventName
    ? buildHookPayload(eventName, cc)
    : buildDaemonPayload(cc, currentClaudePid())
  try {
    const sock = connect(sockPath)
    const timer = setTimeout(() => sock.destroy(), 500)
    timer.unref()
    sock.on('error', () => {})
    sock.on('close', () => clearTimeout(timer))
    sock.on('connect', () => {
      sock.end(`${JSON.stringify(payload)}\n`)
    })
  } catch {
    // ignore
  }
  ensureDaemon()
  if (eventName) return // hooks produce no status-line output
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
