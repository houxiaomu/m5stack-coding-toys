import type { Socket } from 'node:net'
import { defaultSocket, streamSubscription } from './control-client.js'

export function runWatch(): Promise<number> {
  return new Promise((resolveP) => {
    let sock: Socket
    try {
      sock = streamSubscription(defaultSocket(), (e) => {
        const ts = new Date().toISOString().slice(11, 23)
        const ev = (e as { event?: string }).event
        if (ev === 'state') {
          const s = e as { state: string; from?: string }
          const from = s.from ? ` (from ${s.from})` : ''
          console.log(`[${ts}] state=${s.state}${from}`)
        } else if (ev === 'drift') {
          const d = e as { board: string; expected: string; actual: string; level: string }
          console.log(
            `[${ts}] drift   board=${d.board} expected=${d.expected} actual=${d.actual} level=${d.level}`,
          )
        } else {
          console.log(`[${ts}] ${JSON.stringify(e)}`)
        }
      })
    } catch (err) {
      console.error(`m5ct watch: ${(err as Error).message}`)
      resolveP(1)
      return
    }
    sock.on('end', () => resolveP(0))
    sock.on('close', () => resolveP(0))
    sock.on('error', () => resolveP(1))
    process.on('SIGINT', () => {
      sock.end()
      resolveP(0)
    })
  })
}
