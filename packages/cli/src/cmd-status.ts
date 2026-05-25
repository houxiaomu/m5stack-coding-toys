import { type DaemonStatus, callOnce, defaultSocket } from './control-client.js'

export async function runStatus(opts: { json?: boolean } = {}): Promise<number> {
  try {
    const r = await callOnce<DaemonStatus>(defaultSocket(), { op: 'status' })
    if (opts.json) {
      console.log(JSON.stringify(r, null, 2))
      return 0
    }
    console.log(`state:       ${r.state}`)
    console.log(`board:       ${r.board ?? '-'}`)
    console.log(`fw:          ${r.fw ?? '-'}`)
    console.log(`caps:        ${r.caps.join(', ') || '-'}`)
    console.log(`device_id:   ${r.device_id ?? '-'}`)
    return 0
  } catch (err) {
    console.error(`m5ct status: ${(err as Error).message}`)
    return 1
  }
}
