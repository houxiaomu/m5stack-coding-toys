import { callOnce, defaultSocket } from './control-client.js'
import type { CliIO } from './main.js'

interface TapResult {
  ok?: boolean
  error?: string
}

type TapCall = (sockPath: string, msg: object) => Promise<TapResult>

export interface TapOpts {
  call?: TapCall
  socket?: string
}

function parseNonNegativeInt(name: string, value: string | undefined): number {
  if (!value) throw new Error(`missing ${name}`)
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${name} must be a non-negative integer`)
  return Number(value)
}

function parseDuration(value: string | undefined): number {
  if (!value) throw new Error('missing value after --duration')
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('duration must be an integer from 1 to 5000')
  const durationMs = Number(value)
  if (durationMs < 1 || durationMs > 5000) {
    throw new Error('duration must be an integer from 1 to 5000')
  }
  return durationMs
}

function parseArgs(args: readonly string[]): { x: number; y: number; durationMs: number } {
  const positionals: string[] = []
  let durationMs = 50

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a) continue
    if (a === '--duration') {
      if (i + 1 >= args.length) throw new Error('missing value after --duration')
      durationMs = parseDuration(args[i + 1])
      i++
      continue
    }
    if (a.startsWith('-')) throw new Error(`unknown option: ${a}`)
    positionals.push(a)
  }

  if (positionals.length > 2) throw new Error(`unexpected argument: ${positionals[2]}`)
  return {
    x: parseNonNegativeInt('x', positionals[0]),
    y: parseNonNegativeInt('y', positionals[1]),
    durationMs,
  }
}

export async function runTap(
  args: readonly string[],
  io: CliIO,
  opts: TapOpts = {},
): Promise<number> {
  const call: TapCall = opts.call ?? ((s, m) => callOnce<TapResult>(s, m))
  const sock = opts.socket ?? defaultSocket()
  let parsed: { x: number; y: number; durationMs: number }
  try {
    parsed = parseArgs(args)
  } catch (err) {
    io.error(`m5ct tap: ${(err as Error).message}`)
    return 2
  }

  try {
    const r = await call(sock, {
      op: 'tap',
      x: parsed.x,
      y: parsed.y,
      duration_ms: parsed.durationMs,
    })
    if (r.ok) {
      io.log(`Tapped: x=${parsed.x} y=${parsed.y} duration=${parsed.durationMs}ms`)
      return 0
    }
    io.error(`m5ct tap: ${r.error ?? 'unknown error'}`)
    return 1
  } catch (err) {
    io.error(`m5ct tap: ${(err as Error).message}`)
    return 1
  }
}
