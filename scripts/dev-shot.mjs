import { writeFileSync } from 'node:fs'
// Standalone host-side screenshot tool for the Waveshare round-AMOLED firmware.
// Bypasses the daemon: opens the serial port directly, does the m5ct hello
// handshake, requests a screenshot, decodes the raw big-endian RGB565 frame to
// PNG (reusing the daemon's png.js), and writes it out.
//
// Usage: node scripts/dev-shot.mjs <port> <out.png>
import { SerialPort } from 'serialport'
import { rgb565ToPng } from '../packages/daemon/dist/png.js'

const port = process.argv[2] ?? '/dev/cu.usbmodem1101'
const out = process.argv[3] ?? '/tmp/shot.png'

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
      continue // skip boot noise / non-JSON
    }
    for (const h of handlers) h(env)
  }
})

function send(obj) {
  sp.write(`${JSON.stringify(obj)}\n`)
}
function waitFor(pred, ms) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('timeout')), ms)
    handlers.push((env) => {
      if (pred(env)) {
        clearTimeout(to)
        resolve(env)
      }
    })
  })
}

sp.on('open', async () => {
  try {
    send({ v: 1, k: 'hello', t: Date.now(), p: { caps: ['display', 'notify'] }, id: 'h1' })
    const ack = await waitFor((e) => e.k === 'hello.ack', 4000)
    console.error('hello.ack', JSON.stringify(ack.p))

    send({ v: 1, k: 'screenshot', t: Date.now(), p: { fmt: 'png' }, id: 's1' })
    const shot = await waitFor((e) => e.k === 'screenshot.ack', 15000)
    const p = shot.p
    if (!p.ok || !p.data_b64) {
      console.error('capture failed', JSON.stringify({ ok: p.ok, err: p.err, w: p.w, h: p.h }))
      process.exit(1)
    }
    const raw = Buffer.from(p.data_b64, 'base64')
    console.error(
      `ack ok w=${p.w} h=${p.h} fmt=${p.fmt} b64=${p.data_b64.length} raw=${raw.length} expected=${p.w * p.h * 2}`,
    )
    const png = rgb565ToPng(raw, p.w, p.h)
    writeFileSync(out, png)
    console.error('wrote', out, png.length, 'bytes')
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
