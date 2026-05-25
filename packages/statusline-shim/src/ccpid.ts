import { execFileSync } from 'node:child_process'

export interface ProcNode {
  pid: number
  ppid: number
  comm: string
  command: string
}

const MAX_HOPS = 12

function basename(s: string): string {
  return (s.split('/').pop() ?? '').trim()
}

function isClaude(n: ProcNode): boolean {
  if (basename(n.comm) === 'claude') return true
  const cmd0 = n.command.trim().split(/\s+/)[0] ?? ''
  // matches `node /…/claude/cli.js` style installs
  return cmd0.includes('claude') || n.command.includes('/claude/')
}

/**
 * Walk the parent chain from `startPid` and return the nearest ancestor that is
 * the Claude Code process, or null. Pure: operates on a pre-captured snapshot.
 */
export function resolveClaudePid(startPid: number, snapshot: Map<number, ProcNode>): number | null {
  let pid = startPid
  for (let hop = 0; hop < MAX_HOPS && pid > 1; hop++) {
    const node = snapshot.get(pid)
    if (!node) return null
    if (isClaude(node)) return node.pid
    pid = node.ppid
  }
  return null
}

/** Capture a process snapshot via one `ps` call. macOS + Linux compatible. */
export function captureSnapshot(): Map<number, ProcNode> {
  const out = execFileSync('ps', ['-axo', 'pid=,ppid=,comm=,command='], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 500,
  })
  const map = new Map<number, ProcNode>()
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)
    if (!m) continue
    const pid = Number(m[1])
    map.set(pid, { pid, ppid: Number(m[2]), comm: m[3] ?? '', command: m[4] ?? '' })
  }
  return map
}

/** Resolve the live Claude Code PID for the current process, or null. */
export function currentClaudePid(): number | null {
  try {
    return resolveClaudePid(process.pid, captureSnapshot())
  } catch {
    return null
  }
}
