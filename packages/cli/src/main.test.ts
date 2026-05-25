import { describe, expect, it } from 'vitest'
import { listCommands } from './main.js'

describe('@m5stack-coding-toys/cli', () => {
  it('declares only the implemented subcommands', () => {
    expect(listCommands()).toEqual(['status', 'watch', 'flash', 'install', 'uninstall'])
  })
})
