import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FirmwareEntry } from './firmware-index.js'

export interface ResolvedFile {
  path: string
  offset: number
}
export type FetchFn = (url: string) => Promise<Uint8Array>

const nodeFetch: FetchFn = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Ensure all firmware files for `entry` are present and verified under
 * `<cacheDir>/<board>/<version>/`. Downloads missing/invalid files via fetchFn,
 * verifies sha256, and returns local paths + flash offsets.
 */
export async function ensureFirmware(
  entry: FirmwareEntry,
  cacheDir: string,
  fetchFn: FetchFn = nodeFetch,
): Promise<ResolvedFile[]> {
  const dir = resolve(cacheDir, entry.board, entry.version)
  mkdirSync(dir, { recursive: true })
  const out: ResolvedFile[] = []
  for (const f of entry.files) {
    const path = resolve(dir, f.name)
    const cached = existsSync(path) && sha256(readFileSync(path)) === f.sha256
    if (!cached) {
      const bytes = Buffer.from(await fetchFn(f.url))
      if (sha256(bytes) !== f.sha256) {
        throw new Error(`sha256 mismatch for ${f.name}: expected ${f.sha256}`)
      }
      writeFileSync(path, bytes)
    }
    out.push({ path, offset: f.offset })
  }
  return out
}
