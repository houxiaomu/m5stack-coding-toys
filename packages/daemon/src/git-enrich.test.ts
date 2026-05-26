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

  it('computes merged staged and unstaged diff stats', async () => {
    const run = fakeRunner({
      'rev-parse --abbrev-ref HEAD': 'feat/workspace-ui\n',
      'status --porcelain':
        ' M firmware/lib/m5render/pages.cpp\nA  firmware/lib/m5render/status_model.h\n?? scratch.txt\n',
      'rev-list --left-right --count @{upstream}...HEAD': '0\t2\n',
      'log -1 --format=%h%x1f%s%x1f%ct': 'abc1234\x1fwork\x1f1000\n',
      'diff --numstat': '84\t12\tfirmware/lib/m5render/pages.cpp\n-\t-\tfirmware/assets/logo.png\n',
      'diff --cached --numstat':
        '18\t0\tfirmware/lib/m5render/status_model.h\n4\t2\tfirmware/lib/m5render/pages.cpp\n',
    })

    const out = await new GitEnricher(run).enrich('/repo', 1000_000)

    expect(out?.diff).toMatchObject({
      filesChanged: 3,
      linesAdded: 106,
      linesRemoved: 14,
    })
    expect(out?.diff?.topFiles).toEqual([
      { path: 'firmware/lib/m5render/pages.cpp', added: 88, removed: 14 },
      { path: 'firmware/lib/m5render/status_model.h', added: 18, removed: 0 },
      { path: 'firmware/assets/logo.png', added: 0, removed: 0 },
    ])
  })

  it('caps diff top files at three by line churn', async () => {
    const run = fakeRunner({
      'rev-parse --abbrev-ref HEAD': 'main\n',
      'status --porcelain': ' M a\n M b\n M c\n M d\n',
      'diff --numstat': '1\t0\ta\n20\t0\tb\n3\t4\tc\n9\t9\td\n',
      'diff --cached --numstat': '',
    })

    const out = await new GitEnricher(run).enrich('/repo', 0)

    expect(out?.diff?.topFiles).toEqual([
      { path: 'b', added: 20, removed: 0 },
      { path: 'd', added: 9, removed: 9 },
      { path: 'c', added: 3, removed: 4 },
    ])
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
    // 6 git subcommands per enrich; cached call adds none
    expect(run.mock.calls.length).toBe(6)
    // cached call returns the stored result, not just a git skip
    expect(second).toEqual(first)
  })
})
