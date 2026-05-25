import { describe, expect, it, vi } from 'vitest'
import { GitEnricher } from './git-enrich.js'

function fakeRunner(map: Record<string, string>) {
  return vi.fn(async (args: string[], _cwd: string) => map[args.join(' ')] ?? '')
}

describe('GitEnricher', () => {
  it('parses branch / ahead-behind / counts / last commit', async () => {
    const run = fakeRunner({
      'rev-parse --abbrev-ref HEAD': 'feat/checkout-v2\n',
      'rev-list --left-right --count @{upstream}...HEAD': '0\t3\n',
      'status --porcelain': ' M a.ts\nA  b.ts\n?? c.ts\nMM d.ts\n',
      'log -1 --format=%h%x1f%s%x1f%ct': `8a3c2f1\x1fwire up retry\x1f${String(
        Math.floor(Date.now() / 1000 - 720),
      )}`,
    })
    const g = new GitEnricher(run)
    const out = await g.enrich('/repo', Date.now())
    expect(out?.branch).toBe('feat/checkout-v2')
    expect(out).toMatchObject({ ahead: 3, behind: 0 })
    // ' M' unstaged, 'A ' staged, '??' untracked, 'MM' staged+unstaged
    expect(out).toMatchObject({ staged: 2, unstaged: 2, untracked: 1 })
    expect(out?.lastCommit).toMatchObject({ hash: '8a3c2f1', msg: 'wire up retry', minsAgo: 12 })
  })

  it('parses a commit subject that ends in a digit (delimiter robustness)', async () => {
    // With the old `%h%s%ct` no-delimiter format the trailing `\d+` regex would
    // greedily consume the subject's trailing digits. The unit-separator format
    // splits cleanly, so the subject is preserved exactly.
    const run = fakeRunner({
      'rev-parse --abbrev-ref HEAD': 'main\n',
      'status --porcelain': '',
      'log -1 --format=%h%x1f%s%x1f%ct': `deadbee\x1frelease 2024\x1f${String(
        Math.floor(Date.now() / 1000 - 720),
      )}`,
    })
    const out = await new GitEnricher(run).enrich('/repo', Date.now())
    expect(out?.lastCommit).toMatchObject({ hash: 'deadbee', msg: 'release 2024', minsAgo: 12 })
  })

  it('returns undefined when not a git repo', async () => {
    const run = vi.fn(async () => {
      throw new Error('not a git repository')
    })
    expect(await new GitEnricher(run).enrich('/tmp', Date.now())).toBeUndefined()
  })

  it('caches within TTL (no second run for same dir)', async () => {
    const run = fakeRunner({ 'rev-parse --abbrev-ref HEAD': 'main\n', 'status --porcelain': '' })
    const g = new GitEnricher(run, 5000)
    const t = 1000
    const first = await g.enrich('/repo', t)
    const second = await g.enrich('/repo', t + 100)
    // 4 git subcommands per enrich; cached call adds none
    expect(run.mock.calls.length).toBe(4)
    // cached call returns the stored result, not just a git skip
    expect(second).toEqual(first)
  })
})
