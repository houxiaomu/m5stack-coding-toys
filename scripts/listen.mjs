import { SerialPort } from 'serialport'
const port = new SerialPort({ path: '/dev/cu.usbmodem1101', baudRate: 115200 })
let bytes = ''
port.on('data', (c) => {
  bytes += `${c.toString('hex')} `
})
console.log('listening 5s...')
await new Promise((r) => setTimeout(r, 5000))
console.log('raw hex:', bytes || '(silent)')
try {
  const ascii = Buffer.from(bytes.replace(/ /g, ''), 'hex').toString('utf8')
  console.log('as text:', JSON.stringify(ascii))
} catch {}
port.close()
