import { describe, expect, it } from 'vitest'
import * as d from './index.js'

describe('@m5stack-coding-toys/daemon barrel', () => {
  it('exports core classes', () => {
    expect(typeof d.DeviceSession).toBe('function')
    expect(typeof d.Router).toBe('function')
    expect(typeof d.HookServer).toBe('function')
    expect(typeof d.FakeStdioTransport).toBe('function')
  })

  it('exports config helpers', () => {
    expect(typeof d.defaultConfig).toBe('function')
    expect(typeof d.loadConfig).toBe('function')
  })

  it('exports runtime version helpers', () => {
    expect(d.RUNTIME_NAME).toBe('m5ct')
    expect(typeof d.runtimeVersion).toBe('function')
    expect(typeof d.runtimeInfo).toBe('function')
    expect(typeof d.runtimeLabel).toBe('function')
    expect(typeof d.version).toBe('function')
  })
})
