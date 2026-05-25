import { resolve } from 'node:path'
import { callOnce, defaultSocket } from './control-client.js'
import type { CliIO } from './main.js'

interface ShotResult {
  ok?: boolean
  path?: string
  error?: string
}

type ShotCall = (sockPath: string, msg: object) => Promise<ShotResult>

export interface ScreenshotOpts {
  call?: ShotCall
  socket?: string
}

function parseOut(args: readonly string[]): string | undefined {
  const i = args.findIndex((a) => a === '-o' || a === '--out')
  if (i === -1) return undefined
  const v = args[i + 1]
  if (!v) throw new Error('missing path after -o')
  return resolve(process.cwd(), v)
}

export async function runScreenshot(
  args: readonly string[],
  io: CliIO,
  opts: ScreenshotOpts = {},
): Promise<number> {
  const call: ShotCall = opts.call ?? ((s, m) => callOnce<ShotResult>(s, m))
  const sock = opts.socket ?? defaultSocket()
  let out: string | undefined
  try {
    out = parseOut(args)
  } catch (err) {
    io.error(`m5ct screenshot: ${(err as Error).message}`)
    return 1
  }
  try {
    const r = await call(sock, { op: 'screenshot', ...(out ? { out } : {}) })
    if (r.ok && r.path) {
      io.log(`Saved: ${r.path}`)
      return 0
    }
    io.error(`m5ct screenshot: ${r.error ?? 'unknown error'}`)
    return 1
  } catch (err) {
    io.error(`m5ct screenshot: ${(err as Error).message}`)
    return 1
  }
}
