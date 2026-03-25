// SPDX-License-Identifier: Apache-2.0

import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { watchFile, unwatchFile } from 'fs'
import { parseStatsSnapshot } from '../parsers/statsParser'
import type { DataBusEvent } from '@shared/types'
import { createLogger } from '../platform/logger'

const log = createLogger('StatsSource')

const DEFAULT_STATS_FILE = join(homedir(), '.claude', 'stats-cache.json')

export class StatsSource {
  private dispatch: (event: DataBusEvent) => void
  private statsFile: string

  constructor(dispatch: (event: DataBusEvent) => void, statsFile?: string) {
    this.dispatch = dispatch
    this.statsFile = statsFile ?? DEFAULT_STATS_FILE
  }

  async start(): Promise<void> {
    await this.scan()
    watchFile(this.statsFile, { interval: 5000 }, () => {
      this.scan().catch((e) => log.error('Scan failed', e))
    })
    log.info('StatsSource started', { statsFile: this.statsFile })
  }

  async scan(): Promise<void> {
    try {
      // Check if file exists
      await stat(this.statsFile)

      // Read and parse file
      const content = await readFile(this.statsFile, 'utf-8')
      const raw: unknown = JSON.parse(content)

      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().slice(0, 10)
      const snapshot = parseStatsSnapshot(raw, today)

      this.dispatch({ type: 'stats:updated', payload: snapshot })
      log.debug('Stats snapshot updated', {
        statsFile: this.statsFile,
        todayCostUSD: snapshot.todayCostUSD,
        todaySessions: snapshot.todaySessions,
        todayToolCalls: snapshot.todayToolCalls,
      })
    } catch (err) {
      // File might not exist, be unreadable, or contain invalid JSON
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        log.warn('StatsSource scan failed', { statsFile: this.statsFile }, err)
      }
    }
  }

  stop(): void {
    unwatchFile(this.statsFile)
    log.info('StatsSource stopped', { statsFile: this.statsFile })
  }
}
