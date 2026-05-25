import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultConfig, loadConfig } from './config.js'

describe('config', () => {
  it('defaults match spec §6.5', () => {
    const c = defaultConfig()
    expect(c.transport.kind).toBe('serial')
    expect(c.policy.notify_timeout_ms).toBe(3000)
  })

  it('returns defaults when file missing', () => {
    expect(loadConfig('/no/such/path.toml')).toEqual(defaultConfig())
  })

  it('defaults idle_exit_ms to 10 minutes', () => {
    expect(defaultConfig().policy.idle_exit_ms).toBe(600_000)
  })

  it('overrides from TOML', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'm5ct-cfg-'))
    const path = resolve(dir, 'config.toml')
    writeFileSync(
      path,
      `
[daemon]
log_level = "debug"

[transport]
kind = "fake-stdio"
[transport.fake-stdio]
cmd = ["node", "fake.js"]

[policy]
approval_timeout_ms = 30000
notify_timeout_ms = 2500
`,
    )
    const c = loadConfig(path)
    expect(c.log_level).toBe('debug')
    expect(c.transport.kind).toBe('fake-stdio')
    if (c.transport.kind === 'fake-stdio') {
      expect(c.transport.cmd).toEqual(['node', 'fake.js'])
    }
    expect(c.policy.notify_timeout_ms).toBe(2500)
    expect(c.policy).not.toHaveProperty('approval_timeout_ms')
  })
})
