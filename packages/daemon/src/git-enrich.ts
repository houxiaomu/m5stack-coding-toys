import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { StatusPayload } from '@m5stack-coding-toys/protocol'
import { makeLogger } from './logger.js'

const log = makeLogger('git')
const execFileP = promisify(execFile)

export type GitFields = NonNullable<StatusPayload['git']>
export type GitRunner = (args: string[], cwd: string) => Promise<string>

const defaultRunner: GitRunner = async (args, cwd) => {
  const { stdout } = await execFileP('git', args, { cwd, timeout: 2000 })
  return stdout
}

interface CacheEntry {
  at: number
  value: GitFields | undefined
}

export class GitEnricher {
  private cache = new Map<string, CacheEntry>()

  constructor(
    private readonly run: GitRunner = defaultRunner,
    private readonly ttlMs = 1500,
  ) {}

  async enrich(dir: string, nowMs: number): Promise<GitFields | undefined> {
    const hit = this.cache.get(dir)
    if (hit && nowMs - hit.at < this.ttlMs) return hit.value
    let value: GitFields | undefined
    try {
      const branch = (await this.run(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).trim()
      const status = await this.run(['status', '--porcelain'], dir)
      const { staged, unstaged, untracked } = parsePorcelain(status)
      const fields: GitFields = { branch, staged, unstaged, untracked, ahead: 0, behind: 0 }

      try {
        const ab = (
          await this.run(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], dir)
        ).trim()
        const [behind, ahead] = ab.split(/\s+/).map((n) => Number.parseInt(n, 10))
        if (Number.isFinite(behind)) fields.behind = behind
        if (Number.isFinite(ahead)) fields.ahead = ahead
      } catch {
        // no upstream; leave 0/0
      }

      try {
        const raw = (await this.run(['log', '-1', '--format=%h%x1f%s%x1f%ct'], dir)).trim()
        // `%x1f` emits the ASCII Unit Separator (0x1F), which cannot appear in a
        // commit subject, so splitting on it yields unambiguous fields:
        // <abbrev-hash>\x1f<subject>\x1f<unix-ts>.
        const [hash, msg, ct] = raw.split('\x1f')
        if (hash && msg !== undefined && ct !== undefined) {
          fields.lastCommit = {
            hash,
            msg,
            minsAgo: Math.max(0, Math.round((nowMs / 1000 - Number.parseInt(ct, 10)) / 60)),
          }
        }
      } catch {
        // no commits yet
      }
      value = fields
    } catch (err) {
      log.debug('git enrich skipped', { dir, error: (err as Error).message })
      value = undefined
    }
    this.cache.set(dir, { at: nowMs, value })
    return value
  }
}

function parsePorcelain(out: string): { staged: number; unstaged: number; untracked: number } {
  let staged = 0
  let unstaged = 0
  let untracked = 0
  for (const line of out.split('\n')) {
    if (line.length < 2) continue
    const x = line[0]
    const y = line[1]
    if (x === '?' && y === '?') {
      untracked += 1
      continue
    }
    if (x !== ' ' && x !== '?') staged += 1
    if (y !== ' ' && y !== '?') unstaged += 1
  }
  return { staged, unstaged, untracked }
}
