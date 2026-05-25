import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RUNTIME_NAME, runtimeInfo, runtimeLabel, runtimeVersion, version } from './version.js'

describe('runtime version helpers', () => {
  let previous: string | undefined

  beforeEach(() => {
    previous = process.env.M5CT_VERSION
    delete process.env.M5CT_VERSION
  })

  afterEach(() => {
    if (previous === undefined) delete process.env.M5CT_VERSION
    else process.env.M5CT_VERSION = previous
  })

  it('falls back to 0.0.0 when no bundle version is injected', () => {
    expect(RUNTIME_NAME).toBe('m5ct')
    expect(runtimeVersion()).toBe('0.0.0')
    expect(version()).toBe('0.0.0')
    expect(runtimeInfo()).toEqual({ name: 'm5ct', version: '0.0.0' })
    expect(runtimeLabel()).toBe('m5ct 0.0.0')
  })

  it('uses the injected suite version when present', () => {
    process.env.M5CT_VERSION = '9.8.7'
    expect(runtimeVersion()).toBe('9.8.7')
    expect(version()).toBe('9.8.7')
    expect(runtimeInfo()).toEqual({ name: 'm5ct', version: '9.8.7' })
    expect(runtimeLabel('m5ctd')).toBe('m5ctd 9.8.7')
  })
})
