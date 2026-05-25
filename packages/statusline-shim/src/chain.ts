import { spawn } from 'node:child_process'

/**
 * Run the user's prior statusLine command, feeding it the same CC JSON on
 * stdin, and return its stdout. Best-effort: any failure/timeout yields ''.
 * The command string is run via the shell (matches how CC invokes statusLine).
 */
export function runChained(command: string, input: string, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve) => {
    let done = false
    const finish = (s: string): void => {
      if (done) return
      done = true
      resolve(s)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, { shell: true })
    } catch {
      finish('')
      return
    }
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      finish('')
    }, timeoutMs)
    timer.unref()
    child.stdout?.on('data', (c: Buffer) => {
      out += c.toString('utf8')
    })
    child.on('error', () => {
      clearTimeout(timer)
      finish('')
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish(code === 0 ? out.replace(/\n$/, '') : '')
    })
    child.stdin?.end(input)
  })
}
