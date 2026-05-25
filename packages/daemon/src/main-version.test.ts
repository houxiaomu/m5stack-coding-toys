import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { printVersionIfRequested } from './main.js'

describe('m5ctd --version entry behavior', () => {
  let previous: string | undefined

  beforeEach(() => {
    previous = process.env.M5CT_VERSION
    process.env.M5CT_VERSION = '2.3.4'
  })

  afterEach(() => {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'M5CT_VERSION')
    else process.env.M5CT_VERSION = previous
  })

  it('prints daemon binary label and reports that startup should stop', () => {
    const out: string[] = []
    expect(printVersionIfRequested(['--version'], (line) => out.push(line))).toBe(true)
    expect(out).toEqual(['m5ctd 2.3.4'])
  })

  it('ignores normal daemon startup args', () => {
    const out: string[] = []
    expect(printVersionIfRequested([], (line) => out.push(line))).toBe(false)
    expect(out).toEqual([])
  })
})
