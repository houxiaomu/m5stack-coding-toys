import { describe, expect, it } from 'vitest'
import { type DaemonStatus } from './control-client.js'
import { formatStatusLines, runStatus } from './cmd-status.js'

const baseStatus: DaemonStatus = {
  runtime: { name: 'm5ct', version: '1.2.3' },
  state: 'Connected',
  board: 'cores3-se',
  fw: '0.3.0',
  caps: ['display'],
  device_id: 'dev-1',
}

describe('formatStatusLines', () => {
  it('includes daemon runtime before device state', () => {
    expect(formatStatusLines(baseStatus)).toEqual([
      'daemon:      m5ct 1.2.3',
      'state:       Connected',
      'board:       cores3-se',
      'fw:          0.3.0',
      'caps:        display',
      'device_id:   dev-1',
    ])
  })

  it('is compatible with old daemon status without runtime', () => {
    const oldStatus = { ...baseStatus, runtime: undefined }
    expect(formatStatusLines(oldStatus).at(0)).toBe('daemon:      -')
  })
})

describe('runStatus', () => {
  it('prints human status lines', async () => {
    const out: string[] = []
    const code = await runStatus({
      call: async () => baseStatus,
      log: (line) => out.push(line),
    })
    expect(code).toBe(0)
    expect(out[0]).toBe('daemon:      m5ct 1.2.3')
  })

  it('passes json status through unchanged', async () => {
    const out: string[] = []
    const code = await runStatus({
      json: true,
      call: async () => baseStatus,
      log: (line) => out.push(line),
    })
    expect(code).toBe(0)
    expect(JSON.parse(out[0] ?? '{}')).toEqual(baseStatus)
  })
})
