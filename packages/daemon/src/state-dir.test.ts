import { describe, expect, it } from 'vitest'
import {
  configPath,
  devicesPath,
  logPath,
  pidPath,
  screenshotFilename,
  screenshotsDir,
  socketPath,
  stateDir,
} from './state-dir.js'

describe('state-dir', () => {
  const fakeHome = '/Users/test'

  it('stateDir is under home', () => {
    expect(stateDir(fakeHome)).toBe('/Users/test/.m5stack-coding-toys')
  })

  it('all paths live inside stateDir', () => {
    const dir = stateDir(fakeHome)
    for (const p of [
      socketPath(fakeHome),
      configPath(fakeHome),
      pidPath(fakeHome),
      logPath(fakeHome),
      devicesPath(fakeHome),
    ]) {
      expect(p.startsWith(dir)).toBe(true)
    }
  })

  it('uses canonical filenames per spec §6.5', () => {
    expect(socketPath(fakeHome).endsWith('/daemon.sock')).toBe(true)
    expect(configPath(fakeHome).endsWith('/config.toml')).toBe(true)
  })
})

describe('screenshot paths', () => {
  it('screenshotsDir is under the state dir', () => {
    expect(screenshotsDir('/home/x')).toBe('/home/x/.m5stack-coding-toys/screenshots')
  })
  it('screenshotFilename is filesystem-safe and ends with .png', () => {
    const name = screenshotFilename(new Date('2026-05-26T14:03:05.123Z'))
    expect(name).toBe('2026-05-26T14-03-05.png')
  })
})
