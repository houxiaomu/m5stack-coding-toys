import { mkdir, writeFile } from 'node:fs/promises'
import type { Socket } from 'node:net'
import { dirname, resolve } from 'node:path'
import type { DeviceManager, DriftEvent, ManagerState } from './device-manager.js'
import { makeLogger } from './logger.js'
import { rgb565ToPng } from './png.js'
import { screenshotFilename, screenshotsDir } from './state-dir.js'
import { type RuntimeInfo, runtimeInfo } from './version.js'

const log = makeLogger('control')

export interface StatusSnapshot {
  runtime: RuntimeInfo
  state: ManagerState
  board: string | null
  fw: string | null
  caps: readonly string[]
  device_id: string | null
}

export interface ControlHandler {
  status(): Promise<StatusSnapshot>
  subscribeState(sock: Socket): void
  flashHold(clientId: string): Promise<unknown>
  flashRelease(clientId: string): Promise<unknown>
  screenshot(out?: string): Promise<{ ok: true; path: string } | { error: string }>
}

export function makeControlHandler(dm: DeviceManager): ControlHandler {
  return {
    async status() {
      const sess = dm.currentSession()
      return {
        runtime: runtimeInfo(),
        state: dm.state(),
        board: sess?.info?.board ?? null,
        fw: sess?.info?.fw ?? null,
        caps: sess?.info?.caps ?? [],
        device_id: sess?.info?.device_id ?? null,
      }
    },
    subscribeState(sock: Socket) {
      const onState = (state: ManagerState, ctx: { from?: ManagerState }): void => {
        sock.write(`${JSON.stringify({ event: 'state', state, from: ctx?.from })}\n`)
      }
      const onDrift = (info: DriftEvent): void => {
        sock.write(`${JSON.stringify({ event: 'drift', ...info })}\n`)
      }
      dm.on('state', onState)
      dm.on('drift', onDrift)
      sock.on('close', () => {
        dm.off('state', onState)
        dm.off('drift', onDrift)
        log.debug('subscriber closed')
      })
      onState(dm.state(), {})
    },
    flashHold(clientId: string) {
      return dm.flashHold(clientId)
    },
    flashRelease(clientId: string) {
      return dm.flashRelease(clientId)
    },
    async screenshot(out?: string): Promise<{ ok: true; path: string } | { error: string }> {
      const sess = dm.currentSession()
      if (!sess) return { error: 'no_device' }
      let env: Awaited<ReturnType<typeof sess.request>>
      try {
        env = await sess.request({ k: 'screenshot', p: { fmt: 'png' } }, 5000)
      } catch (err) {
        const e = err as Error & { code?: string }
        return { error: e.code === 'ETIMEDOUT' ? 'device_timeout' : e.message }
      }
      const p = env.p as {
        ok: boolean
        w?: number
        h?: number
        fmt?: string
        data_b64?: string
        err?: string
      }
      if (!p.ok || !p.data_b64 || !p.w || !p.h) return { error: p.err ?? 'capture_failed' }
      if (p.fmt !== 'rgb565') return { error: `unsupported_format: ${p.fmt}` }
      // Device sends the raw framebuffer; encode the PNG host-side.
      const png = rgb565ToPng(Buffer.from(p.data_b64, 'base64'), p.w, p.h)
      const path = out ?? resolve(screenshotsDir(), screenshotFilename())
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, png)
      return { ok: true as const, path }
    },
  }
}
