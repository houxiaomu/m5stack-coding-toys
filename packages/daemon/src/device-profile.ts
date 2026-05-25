import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeLogger } from './logger.js'

const log = makeLogger('profile')

export interface FlashFile {
  path: string
  offset: number
}

export type DriftLevel = 'none' | 'patch' | 'minor' | 'major'

interface ManifestRaw {
  board: string
  fw_version: string
  chip: string
  files: { path: string; offset: string }[]
  sha256?: Record<string, string>
}

interface BoardEntry {
  version: string
  files: FlashFile[]
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

function parseVersion(v: string): ParsedVersion | null {
  const parts = v.split('.').map((x) => Number.parseInt(x, 10))
  if (parts.length !== 3) return null
  const [maj, min, pat] = parts
  if (maj === undefined || min === undefined || pat === undefined) return null
  if (Number.isNaN(maj) || Number.isNaN(min) || Number.isNaN(pat)) return null
  return { major: maj, minor: min, patch: pat }
}

function cmp(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

export class DeviceProfile {
  private boards = new Map<string, BoardEntry>()

  constructor(distRoot: string) {
    if (!existsSync(distRoot)) {
      log.warn('firmware dist root missing', { distRoot })
      return
    }
    for (const board of readdirSync(distRoot, { withFileTypes: true })) {
      if (!board.isDirectory()) continue
      const mPath = resolve(distRoot, board.name, 'manifest.json')
      if (!existsSync(mPath)) continue
      const raw = JSON.parse(readFileSync(mPath, 'utf8')) as ManifestRaw
      const files: FlashFile[] = []
      for (const f of raw.files) {
        const abs = resolve(distRoot, board.name, f.path)
        if (!existsSync(abs)) throw new Error(`manifest references missing file: ${abs}`)
        if (raw.sha256?.[f.path]) {
          const actual = createHash('sha256').update(readFileSync(abs)).digest('hex')
          if (actual !== raw.sha256[f.path]) {
            throw new Error(`sha256 mismatch for ${abs}: got ${actual}, want ${raw.sha256[f.path]}`)
          }
        }
        files.push({ path: abs, offset: Number.parseInt(f.offset, 16) })
      }
      this.boards.set(raw.board, { version: raw.fw_version, files })
      log.info('loaded manifest', {
        board: raw.board,
        version: raw.fw_version,
        files: files.length,
      })
    }
  }

  expectedVersion(board: string): string | null {
    return this.boards.get(board)?.version ?? null
  }

  binaries(board: string): FlashFile[] | null {
    return this.boards.get(board)?.files ?? null
  }

  driftLevel(board: string, actual: string): DriftLevel {
    const want = this.expectedVersion(board)
    if (!want) return 'none'
    const w = parseVersion(want)
    const a = parseVersion(actual)
    if (!w || !a) return 'major'
    if (cmp(a, w) >= 0) return 'none'
    if (a.major < w.major) return 'major'
    const minorDiff = w.minor - a.minor
    if (minorDiff >= 2) return 'minor'
    if (minorDiff === 1) {
      // 1 minor behind: if device stayed on a late patch of the previous line,
      // treat as patch-level drift; if it skipped the line entirely (.0), it's minor.
      return a.patch > 0 ? 'patch' : 'minor'
    }
    return 'patch'
  }
}
