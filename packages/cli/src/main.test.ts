import { describe, expect, it } from 'vitest'
import { listCommands } from './main.js'

describe('@m5stack-coding-toys/cli', () => {
  it('declares the V1 subcommand names from spec §6.6.6', () => {
    expect(listCommands()).toEqual([
      'pair',
      'devices',
      'use',
      'forget',
      'status',
      'watch',
      'flash',
      'log',
      'install',
      'uninstall',
    ])
  })
})
