import { readFileSync, writeFileSync } from 'node:fs'
import { makeLogger } from './logger.js'

const log = makeLogger('aggstore')

/** History that should survive a daemon restart (process-scoped otherwise). */
export interface PersistedAggregatorState {
  burnHistory: number[]
  todayCost: number
  todayDay: string
  todaySessions: string[]
}

export interface AggregatorStore {
  load(): PersistedAggregatorState | null
  save(state: PersistedAggregatorState): void
}

/** JSON-file-backed store. Reads/writes are best-effort; failures never throw. */
export class FileAggregatorStore implements AggregatorStore {
  constructor(private readonly path: string) {}

  load(): PersistedAggregatorState | null {
    try {
      const parsed = JSON.parse(
        readFileSync(this.path, 'utf8'),
      ) as Partial<PersistedAggregatorState>
      if (!Array.isArray(parsed.burnHistory) || typeof parsed.todayDay !== 'string') return null
      return {
        burnHistory: parsed.burnHistory.filter((n) => typeof n === 'number'),
        todayCost: typeof parsed.todayCost === 'number' ? parsed.todayCost : 0,
        todayDay: parsed.todayDay,
        todaySessions: Array.isArray(parsed.todaySessions)
          ? parsed.todaySessions.filter((s) => typeof s === 'string')
          : [],
      }
    } catch {
      return null // missing or corrupt → start fresh
    }
  }

  save(state: PersistedAggregatorState): void {
    try {
      writeFileSync(this.path, JSON.stringify(state))
    } catch (err) {
      log.debug('persist failed', { error: (err as Error).message })
    }
  }
}
