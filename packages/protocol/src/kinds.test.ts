import { describe, expect, it } from 'vitest'
import { ALL_KINDS, CAPS, DEVICE_KINDS, HOST_KINDS, STATES, URGENCY } from './kinds.js'

describe('kinds', () => {
  it('host kinds are status-display only', () => {
    expect(HOST_KINDS).toEqual(['hello', 'status', 'notify', 'ping'])
  })

  it('device kinds drop approval/prompt', () => {
    expect(DEVICE_KINDS).toEqual(['hello.ack', 'notify.ack', 'device.event', 'pong'])
  })

  it('ALL_KINDS is host + device with no duplicates', () => {
    const set = new Set(ALL_KINDS)
    expect(set.size).toBe(ALL_KINDS.length)
    expect(ALL_KINDS.length).toBe(HOST_KINDS.length + DEVICE_KINDS.length)
  })

  it('caps drop approve/keys/keyboard/bar', () => {
    expect(CAPS).toEqual(['display', 'buttons', 'touch', 'haptic', 'notify'])
  })

  it('states are coarse liveness: active | idle', () => {
    expect(STATES).toEqual(['active', 'idle'])
  })

  it('declares notify urgency levels', () => {
    expect(URGENCY).toEqual(['low', 'normal', 'high'])
  })
})
