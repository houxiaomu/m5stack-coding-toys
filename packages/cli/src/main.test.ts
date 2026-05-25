import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listCommands, runCli } from './main.js'

function capture() {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: {
      log: (line: string) => stdout.push(line),
      error: (line: string) => stderr.push(line),
    },
    stdout,
    stderr,
  }
}

describe('@m5stack-coding-toys/cli', () => {
  let previous: string | undefined

  beforeEach(() => {
    previous = process.env.M5CT_VERSION
    process.env.M5CT_VERSION = '1.2.3'
  })

  afterEach(() => {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'M5CT_VERSION')
    else process.env.M5CT_VERSION = previous
  })

  it('declares only the implemented subcommands', () => {
    expect(listCommands()).toEqual(['status', 'watch', 'flash', 'install', 'uninstall', 'version'])
  })

  it('prints usage when no command is provided', async () => {
    const c = capture()
    await expect(runCli([], c.io)).resolves.toBe(2)
    expect(c.stdout).toEqual(['usage: m5ct <status|watch|flash|install|uninstall|version>'])
    expect(c.stderr).toEqual([])
  })

  it('prints --version without running a subcommand', async () => {
    const c = capture()
    await expect(runCli(['--version'], c.io)).resolves.toBe(0)
    expect(c.stdout).toEqual(['m5ct 1.2.3'])
    expect(c.stderr).toEqual([])
  })

  it('rejects extra args after --version', async () => {
    const c = capture()
    await expect(runCli(['--version', 'extra'], c.io)).resolves.toBe(2)
    expect(c.stdout).toEqual([])
    expect(c.stderr).toEqual(['unexpected argument: extra'])
  })

  it('prints version as a subcommand', async () => {
    const c = capture()
    await expect(runCli(['version'], c.io)).resolves.toBe(0)
    expect(c.stdout).toEqual(['m5ct 1.2.3'])
    expect(c.stderr).toEqual([])
  })

  it('prints version as compact json', async () => {
    const c = capture()
    await expect(runCli(['version', '--json'], c.io)).resolves.toBe(0)
    expect(c.stdout).toEqual(['{"name":"m5ct","version":"1.2.3"}'])
    expect(c.stderr).toEqual([])
  })

  it('rejects unknown version args', async () => {
    const c = capture()
    await expect(runCli(['version', '--bogus'], c.io)).resolves.toBe(2)
    expect(c.stdout).toEqual([])
    expect(c.stderr).toEqual(['unexpected argument: --bogus'])
  })

  it('rejects extra args after version json', async () => {
    const c = capture()
    await expect(runCli(['version', '--json', '--bogus'], c.io)).resolves.toBe(2)
    expect(c.stdout).toEqual([])
    expect(c.stderr).toEqual(['unexpected argument: --bogus'])
  })

  it('keeps unknown commands as usage errors', async () => {
    const c = capture()
    await expect(runCli(['nope'], c.io)).resolves.toBe(2)
    expect(c.stdout).toEqual([])
    expect(c.stderr).toEqual(['unknown command: nope'])
  })

  it('does not alias -v to version', async () => {
    const c = capture()
    await expect(runCli(['-v'], c.io)).resolves.toBe(2)
    expect(c.stdout).toEqual([])
    expect(c.stderr).toEqual(['unknown command: -v'])
  })
})
