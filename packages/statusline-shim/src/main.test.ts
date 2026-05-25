import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildDaemonPayload,
  buildSummary,
  chainedStatusLine,
  printVersionIfRequested,
} from './main.js'

describe('buildSummary', () => {
  it('renders a compact one-line terminal summary from CC JSON', () => {
    const line = buildSummary({
      model: { display_name: 'Sonnet 4.6' },
      context_window: { used_percentage: 47 },
      cost: { total_cost_usd: 0.42 },
    })
    expect(line).toContain('Sonnet 4.6')
    expect(line).toContain('47%')
    expect(line).toContain('$0.42')
  })

  it('degrades gracefully when fields missing', () => {
    expect(buildSummary({})).toMatch(/m5ct/i)
  })
})

it('includes ccPid and session_id when available', () => {
  const cc = { session_id: 'abc', model: { display_name: 'Opus' } }
  const p = buildDaemonPayload(cc, 51856)
  expect(p).toEqual({ statusLine: cc, ccPid: 51856, sessionId: 'abc' })
})

it('omits ccPid when null', () => {
  const cc = { session_id: 'abc' }
  const p = buildDaemonPayload(cc, null)
  expect(p).toEqual({ statusLine: cc, sessionId: 'abc' })
})

it('omits sessionId when absent', () => {
  const p = buildDaemonPayload({}, 10)
  expect(p).toEqual({ statusLine: {}, ccPid: 10 })
})

describe('chainedStatusLine', () => {
  it('reads install-state.json', () => {
    const home = mkdtempSync(resolve(tmpdir(), 'm5ct-shim-state-'))
    const dir = resolve(home, '.m5stack-coding-toys')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      resolve(dir, 'install-state.json'),
      JSON.stringify({ chainedStatusLine: 'npx -y ccstatusline@latest' }),
    )
    expect(chainedStatusLine(home)).toBe('npx -y ccstatusline@latest')
  })

  it('does not read legacy config.json', () => {
    const home = mkdtempSync(resolve(tmpdir(), 'm5ct-shim-state-'))
    const dir = resolve(home, '.m5stack-coding-toys')
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'config.json'), JSON.stringify({ chainedStatusLine: 'legacy' }))
    expect(chainedStatusLine(home)).toBeUndefined()
  })
})

describe('m5ct-statusline --version entry behavior', () => {
  let previous: string | undefined

  beforeEach(() => {
    previous = process.env.M5CT_VERSION
    process.env.M5CT_VERSION = '3.4.5'
  })

  afterEach(() => {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'M5CT_VERSION')
    else process.env.M5CT_VERSION = previous
  })

  it('prints statusline binary label and reports that startup should stop', () => {
    const out: string[] = []
    expect(printVersionIfRequested(['--version'], (line) => out.push(line))).toBe(true)
    expect(out).toEqual(['m5ct-statusline 3.4.5'])
  })

  it('ignores normal statusline invocations', () => {
    const out: string[] = []
    expect(printVersionIfRequested([], (line) => out.push(line))).toBe(false)
    expect(out).toEqual([])
  })
})
