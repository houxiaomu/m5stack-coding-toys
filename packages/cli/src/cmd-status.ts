import { type DaemonStatus, callOnce, defaultSocket } from './control-client.js'

type StatusCall = (sockPath: string, msg: object) => Promise<DaemonStatus>

export interface StatusRunOpts {
  json?: boolean
  socket?: string
  call?: StatusCall
  log?: (line: string) => void
  error?: (line: string) => void
}

export function formatStatusLines(r: DaemonStatus): string[] {
  const daemon = r.runtime ? `${r.runtime.name} ${r.runtime.version}` : '-'
  const lines = [`daemon:      ${daemon}`, `state:       ${r.state}`]
  if (r.transport) lines.push(`transport:   ${r.transport}`)
  if (r.default_device_id) lines.push(`default:     ${r.default_device_id}`)
  if (r.reconnecting) {
    lines.push('hint:        device is not nearby, powered off, or not advertising')
  }
  lines.push(
    `board:       ${r.board ?? '-'}`,
    `fw:          ${r.fw ?? '-'}`,
    `caps:        ${r.caps.join(', ') || '-'}`,
    `device_id:   ${r.device_id ?? '-'}`,
  )
  return lines
}

export async function runStatus(opts: StatusRunOpts = {}): Promise<number> {
  const log = opts.log ?? console.log
  const error = opts.error ?? console.error
  const call: StatusCall = opts.call ?? ((sockPath, msg) => callOnce<DaemonStatus>(sockPath, msg))
  try {
    const r = await call(opts.socket ?? defaultSocket(), { op: 'status' })
    if (opts.json) {
      log(JSON.stringify(r, null, 2))
      return 0
    }
    for (const line of formatStatusLines(r)) log(line)
    return 0
  } catch (err) {
    error(`m5ct status: ${(err as Error).message}`)
    return 1
  }
}
