import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeLogFile, getLogLevel, makeLogger, setLogFile, setLogLevel } from './logger.js'

describe('logger', () => {
  afterEach(async () => {
    setLogLevel('info')
    await closeLogFile()
    vi.restoreAllMocks()
  })

  it('tees log lines to the configured file and truncates it on open', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'm5ct-log-'))
    const file = join(dir, 'daemon.log')
    writeFileSync(file, 'STALE-FROM-PREVIOUS-RUN\n')
    setLogLevel('info')
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    setLogFile(file)
    const log = makeLogger('test')
    log.info('hello world', { a: 1 })
    await closeLogFile()
    const content = readFileSync(file, 'utf8')
    expect(content).not.toContain('STALE-FROM-PREVIOUS-RUN') // truncated on open
    expect(content).toContain('hello world')
    expect(content).toContain('"a":1')
    expect(out).toHaveBeenCalledOnce() // still tees to console
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not write to a file when none is configured', () => {
    // closeLogFile() in afterEach guarantees no leftover sink from prior test.
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const log = makeLogger('test')
    log.info('no file here')
    expect(out).toHaveBeenCalledOnce() // console only, no throw
  })

  it('drops log lines below current level', () => {
    setLogLevel('warn')
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const log = makeLogger('test')
    log.info('hello')
    log.debug('quiet')
    expect(out).not.toHaveBeenCalled()
    log.warn('loud')
    expect(err).toHaveBeenCalledOnce()
  })

  it('routes warn/error to stderr, others to stdout', () => {
    setLogLevel('trace')
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const log = makeLogger('t')
    log.trace('1')
    log.debug('2')
    log.info('3')
    expect(out).toHaveBeenCalledTimes(3)
    log.warn('4')
    log.error('5')
    expect(err).toHaveBeenCalledTimes(2)
  })

  it('formats with timestamp + level + component + msg + fields', () => {
    setLogLevel('debug')
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const log = makeLogger('xport')
    log.info('opening', { path: '/dev/cu.usbmodem1101', baud: 115200 })
    const line = out.mock.calls[0]?.[0] as string
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/)
    expect(line).toContain('INFO')
    expect(line).toContain('xport')
    expect(line).toContain('opening')
    expect(line).toContain('"path":"/dev/cu.usbmodem1101"')
  })

  it('setLogLevel ignores invalid values', () => {
    setLogLevel('debug')
    setLogLevel('bogus' as never)
    expect(getLogLevel()).toBe('debug')
  })
})
