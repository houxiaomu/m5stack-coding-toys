import { describe, expect, it } from 'vitest'

// Smoke test only: esptool-js drives a real serial port, so full flashing is
// verified on hardware (see plan Phase 5). Here we just assert the module
// loads and constructs without throwing (catches import/type-shape breaks).
describe('Flasher', () => {
  it('module loads and exports Flasher class', async () => {
    const mod = await import('./flasher.js')
    expect(typeof mod.Flasher).toBe('function')
  })

  it('constructs without opening a port', async () => {
    const { Flasher } = await import('./flasher.js')
    const f = new Flasher({ port: '/dev/null', baud: 115200 })
    expect(f).toBeInstanceOf(Flasher)
  })
})
