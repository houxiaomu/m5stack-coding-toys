import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { type FirmwareEntry, resolveFirmware } from './firmware-index.js'
import { type FetchFn, ensureFirmware, sha256 } from './firmware-store.js'
import { parseManifest } from './manifest.js'

export interface PreparedFile {
  path: string
  offset: number
  name: string
  size: number
  sha256?: string
}

export interface PreparedFirmware {
  board: string | null
  version: string | null
  files: PreparedFile[]
  verified: boolean
  sourceLabel: string
}

export type FlashSource =
  | { kind: 'builtin'; board: string; fw?: string }
  | { kind: 'local'; dir: string; board?: string }
  | { kind: 'remote'; manifestUrl: string; board?: string }

export interface PrepareDeps {
  fetchFn?: FetchFn
  // Test seam: override the builtin index lookup so unit tests don't depend on
  // real release bytes.
  indexEntry?: FirmwareEntry
}

// ESP32-S3 default 3-file layout, used when a --dir has no manifest.json.
const DEFAULT_TRIPLET: { name: string; offset: number }[] = [
  { name: 'bootloader.bin', offset: 0x0 },
  { name: 'partitions.bin', offset: 0x8000 },
  { name: 'firmware.bin', offset: 0x10000 },
]

function prepareLocal(dir: string): PreparedFirmware {
  const manifestPath = resolve(dir, 'manifest.json')
  if (existsSync(manifestPath)) {
    const m = parseManifest(readFileSync(manifestPath, 'utf8'))
    const files: PreparedFile[] = m.files.map((f) => {
      const path = resolve(dir, f.name)
      if (!existsSync(path)) throw new Error(`missing ${f.name} in ${dir} (listed in manifest)`)
      const bytes = readFileSync(path)
      if (f.sha256 && sha256(bytes) !== f.sha256) {
        throw new Error(`sha256 mismatch for ${f.name}`)
      }
      return { path, offset: f.offset, name: f.name, size: bytes.length, sha256: f.sha256 }
    })
    return {
      board: m.board,
      version: m.version,
      files,
      verified: files.every((f) => f.sha256 !== undefined),
      sourceLabel: `local dir=${dir}`,
    }
  }
  // No manifest: bare flash the conventional triplet, no sha verification.
  const files: PreparedFile[] = DEFAULT_TRIPLET.map((t) => {
    const path = resolve(dir, t.name)
    if (!existsSync(path)) throw new Error(`missing ${t.name} in ${dir} (no manifest.json)`)
    return { path, offset: t.offset, name: t.name, size: statSync(path).size }
  })
  return { board: null, version: null, files, verified: false, sourceLabel: `local dir=${dir}` }
}

async function prepareBuiltin(
  board: string,
  fw: string | undefined,
  cacheDir: string,
  deps: PrepareDeps,
): Promise<PreparedFirmware> {
  const entry = deps.indexEntry ?? resolveFirmware(board, fw)
  const resolved = await ensureFirmware(entry, cacheDir, deps.fetchFn)
  const byOffset = new Map(entry.files.map((f) => [f.offset, f]))
  const files: PreparedFile[] = resolved.map((r) => {
    const meta = byOffset.get(r.offset)
    const bytes = readFileSync(r.path)
    return {
      path: r.path,
      offset: r.offset,
      name: meta?.name ?? r.path.split('/').pop() ?? 'firmware.bin',
      size: bytes.length,
      sha256: meta?.sha256,
    }
  })
  return {
    board: entry.board,
    version: entry.version,
    files,
    verified: true,
    sourceLabel: 'builtin',
  }
}

async function prepareRemote(
  manifestUrl: string,
  cacheDir: string,
  deps: PrepareDeps,
): Promise<PreparedFirmware> {
  const fetchFn: FetchFn =
    deps.fetchFn ??
    (async (url) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`)
      return new Uint8Array(await res.arrayBuffer())
    })
  const manifestBytes = await fetchFn(manifestUrl)
  const m = parseManifest(new TextDecoder().decode(manifestBytes))
  // Build a FirmwareEntry whose file URLs resolve relative to the manifest URL,
  // then reuse ensureFirmware for download + sha256 verification + caching.
  const entry: FirmwareEntry = {
    board: m.board,
    version: m.version,
    files: m.files.map((f) => {
      if (!f.sha256) throw new Error(`invalid manifest: sha256 missing for ${f.name}`)
      return {
        name: f.name,
        url: new URL(f.name, manifestUrl).toString(),
        sha256: f.sha256,
        offset: f.offset,
      }
    }),
  }
  const resolved = await ensureFirmware(entry, cacheDir, fetchFn)
  const byOffset = new Map(entry.files.map((f) => [f.offset, f]))
  const files: PreparedFile[] = resolved.map((r) => {
    const meta = byOffset.get(r.offset)
    const bytes = readFileSync(r.path)
    return {
      path: r.path,
      offset: r.offset,
      name: meta?.name ?? 'firmware.bin',
      size: bytes.length,
      sha256: meta?.sha256,
    }
  })
  return {
    board: m.board,
    version: m.version,
    files,
    verified: true,
    sourceLabel: `remote url=${manifestUrl}`,
  }
}

export async function prepareFirmware(
  source: FlashSource,
  cacheDir: string,
  deps: PrepareDeps = {},
): Promise<PreparedFirmware> {
  if (source.kind === 'builtin') return prepareBuiltin(source.board, source.fw, cacheDir, deps)
  if (source.kind === 'local') return prepareLocal(source.dir)
  if (source.kind === 'remote') return prepareRemote(source.manifestUrl, cacheDir, deps)
  throw new Error(`unsupported source kind: ${(source as { kind: string }).kind}`)
}
