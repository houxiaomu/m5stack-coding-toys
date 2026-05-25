import { describe, expect, it } from 'vitest'
import { type ProcNode, resolveClaudePid } from './ccpid.js'

// Build a snapshot keyed by pid. comm is the basename ps reports.
function snap(nodes: ProcNode[]): Map<number, ProcNode> {
  return new Map(nodes.map((n) => [n.pid, n]))
}

describe('resolveClaudePid', () => {
  it('walks up shell to the claude ancestor (comm match)', () => {
    const s = snap([
      { pid: 100, ppid: 90, comm: 'node', command: 'node main.js' },
      { pid: 90, ppid: 50, comm: 'zsh', command: '/bin/zsh -c ...' },
      { pid: 50, ppid: 40, comm: 'claude', command: 'claude --continue' },
      { pid: 40, ppid: 1, comm: 'zsh', command: '-zsh' },
    ])
    expect(resolveClaudePid(100, s)).toBe(50)
  })

  it('matches when comm is node but command path contains claude', () => {
    const s = snap([
      { pid: 100, ppid: 90, comm: 'node', command: 'node shim.js' },
      { pid: 90, ppid: 50, comm: 'sh', command: 'sh -c m5ct' },
      { pid: 50, ppid: 1, comm: 'node', command: 'node /usr/lib/claude/cli.js' },
    ])
    expect(resolveClaudePid(100, s)).toBe(50)
  })

  it('returns the nearest claude ancestor when nested', () => {
    const s = snap([
      { pid: 100, ppid: 50, comm: 'node', command: 'node shim.js' },
      { pid: 50, ppid: 30, comm: 'claude', command: 'claude (subagent)' },
      { pid: 30, ppid: 1, comm: 'claude', command: 'claude (outer)' },
    ])
    expect(resolveClaudePid(100, s)).toBe(50)
  })

  it('returns null when no claude ancestor exists', () => {
    const s = snap([
      { pid: 100, ppid: 90, comm: 'node', command: 'node shim.js' },
      { pid: 90, ppid: 1, comm: 'zsh', command: '-zsh' },
    ])
    expect(resolveClaudePid(100, s)).toBeNull()
  })

  it('stops on a broken chain without looping forever', () => {
    const s = snap([{ pid: 100, ppid: 999, comm: 'node', command: 'node shim.js' }])
    expect(resolveClaudePid(100, s)).toBeNull()
  })
})
