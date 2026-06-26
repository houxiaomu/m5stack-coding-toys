import { writeFileSync } from 'node:fs'
// Drive the firmware through UI states and screenshot each, by speaking the
// host side of the m5ct protocol directly over serial. For design review.
//
// Usage: node scripts/dev-drive.mjs <port> <outdir>
import { SerialPort } from 'serialport'
import { rgb565ToPng } from '../packages/daemon/dist/png.js'

const port = process.argv[2] ?? '/dev/cu.usbmodem1101'
const outdir = process.argv[3] ?? '/tmp'

const sp = new SerialPort({ path: port, baudRate: 115200 })
let buf = ''
const handlers = []
sp.on('data', (d) => {
  buf += d.toString('latin1')
  let nl = buf.indexOf('\n')
  while (nl >= 0) {
    const line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    nl = buf.indexOf('\n')
    if (!line.trim()) continue
    let env
    try {
      env = JSON.parse(line)
    } catch {
      continue
    }
    for (const h of handlers) h(env)
  }
})
const send = (o) => sp.write(`${JSON.stringify(o)}\n`)
const waitFor = (pred, ms) =>
  new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('timeout')), ms)
    handlers.push((e) => {
      if (pred(e)) {
        clearTimeout(to)
        resolve(e)
      }
    })
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(name) {
  send({ v: 1, k: 'screenshot', t: Date.now(), p: { fmt: 'png' }, id: `sh-${name}` })
  const e = await waitFor((x) => x.k === 'screenshot.ack', 15000)
  if (!e.p.ok || !e.p.data_b64) {
    console.error(name, 'capture failed', e.p)
    return
  }
  const raw = Buffer.from(e.p.data_b64, 'base64')
  writeFileSync(`${outdir}/${name}.png`, rgb565ToPng(raw, e.p.w, e.p.h))
  console.error(`${name}.png  ${e.p.w}x${e.p.h}`)
}

const LIVE = {
  state: 'active',
  activity: 'working',
  model: { short: 'Opus 4.8' },
  context: { usedPct: 42, tokens: 84000, limit: 200000, exceeds200k: false },
  cost: { sessionUsd: 1.83, burnPerHr: 4.2, durationMin: 96, linesAdded: 213, linesRemoved: 48 },
  block: { usedPct: 30, resetInMin: 120 },
  weekly: { usedPct: 55 },
  git: { branch: 'feat/waveshare-amoled', staged: 2, unstaged: 3, untracked: 1 },
  sessions: [
    { index: 0, id: 's1', name: 'waveshare-amoled', activity: 'working', selected: true },
    { index: 1, id: 's2', name: 'daemon', activity: 'awaiting_input' },
  ],
}

sp.on('open', async () => {
  try {
    send({
      v: 1,
      k: 'hello',
      t: Date.now(),
      p: { caps: ['display', 'notify'], time: { utc_ms: Date.now(), offset_min: 600 } },
      id: 'h1',
    })
    await waitFor((e) => e.k === 'hello.ack', 4000)

    // 1. idle / linked
    send({ v: 1, k: 'status', t: Date.now(), p: { state: 'idle' }, id: 'st0' })
    await sleep(600)
    await shot('01_idle')

    // 2. live working
    send({ v: 1, k: 'status', t: Date.now(), p: LIVE, id: 'st1' })
    await sleep(700)
    await shot('02_live_working')

    // 3. awaiting input (amber)
    send({
      v: 1,
      k: 'status',
      t: Date.now(),
      p: {
        ...LIVE,
        activity: 'awaiting_input',
        context: { usedPct: 73, tokens: 146000, limit: 200000, exceeds200k: false },
      },
      id: 'st2',
    })
    await sleep(700)
    await shot('03_awaiting')

    // 4. needs attention (red, high ctx)
    send({
      v: 1,
      k: 'status',
      t: Date.now(),
      p: {
        ...LIVE,
        activity: 'needs_attention',
        context: { usedPct: 94, tokens: 188000, limit: 200000, exceeds200k: false },
      },
      id: 'st3',
    })
    await sleep(700)
    await shot('04_attention')

    // 5. notify overlay
    send({
      v: 1,
      k: 'notify',
      t: Date.now(),
      p: { title: 'Permission needed', body: 'Allow edit to proto.c?', urgency: 'high' },
      id: 'nt1',
    })
    await sleep(700)
    await shot('05_notify')

    console.error('done')
    process.exit(0)
  } catch (e) {
    console.error('ERR', e.message)
    process.exit(2)
  }
})
sp.on('error', (e) => {
  console.error('PORT ERR', e.message)
  process.exit(3)
})
