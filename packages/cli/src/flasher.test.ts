import { describe, expect, it } from 'vitest'
import { watchdogResetEsp32S3 } from './flasher.js'

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

  it('performs the ESP32-S3 watchdog reset register sequence', async () => {
    const writes: Array<{ addr: number; value: number }> = []
    await watchdogResetEsp32S3({
      writeReg: async (addr: number, value: number) => {
        writes.push({ addr, value })
      },
    })

    expect(writes).toEqual([
      { addr: 0x600080b0, value: 0x50d83aa1 },
      { addr: 0x6000809c, value: 2000 },
      { addr: 0x60008098, value: (1 << 31) | (5 << 28) | (1 << 8) | 2 },
      { addr: 0x600080b0, value: 0 },
    ])
  })
})
