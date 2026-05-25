import { homedir } from 'node:os'
import { resolve } from 'node:path'

export const PROJECT_DIR_NAME = '.m5stack-coding-toys'

export function stateDir(home: string = homedir()): string {
  return resolve(home, PROJECT_DIR_NAME)
}

export function socketPath(home: string = homedir()): string {
  return resolve(stateDir(home), 'daemon.sock')
}

export function configPath(home: string = homedir()): string {
  return resolve(stateDir(home), 'config.toml')
}

export function pidPath(home: string = homedir()): string {
  return resolve(stateDir(home), 'daemon.pid')
}

export function logPath(home: string = homedir()): string {
  return resolve(stateDir(home), 'daemon.log')
}

export function devicesPath(home: string = homedir()): string {
  return resolve(stateDir(home), 'devices.json')
}

export function aggregatorStatePath(home: string = homedir()): string {
  return resolve(stateDir(home), 'aggregator-state.json')
}
