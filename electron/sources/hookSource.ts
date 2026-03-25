// SPDX-License-Identifier: Apache-2.0

import { watch, readFile, stat, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { parseHookLogLine } from '../parsers/hookEventParser'
import type { DataBusEvent, HookEvent } from '@shared/types'
import { createLogger } from '../platform/logger'

const log = createLogger('HookSource')

export interface HookSourceConfig {
  /** Path to the events.jsonl file to watch */
  eventsLog: string
  /**
   * Optional predicate — when it returns `true` for an event, that event
   * is silently dropped instead of being dispatched.
   *
   * Primary use: suppress CLI hook events for managed sessions (SDK
   * programmatic hooks are the authoritative source for those sessions).
   */
  shouldSkip?: (event: HookEvent) => boolean
}

export class HookSource {
  private dispatch: (event: DataBusEvent) => void
  private abortController: AbortController | null = null
  private lastReadOffset = 0
  private readonly eventsLog: string
  private readonly shouldSkip: ((event: HookEvent) => boolean) | undefined

  constructor(dispatch: (event: DataBusEvent) => void, config: HookSourceConfig) {
    this.dispatch = dispatch
    this.eventsLog = config.eventsLog
    this.shouldSkip = config.shouldSkip
  }

  async start(): Promise<void> {
    await mkdir(dirname(this.eventsLog), { recursive: true })
    await this.readNewEvents()
    this.abortController = new AbortController()
    this.watchFile(this.abortController.signal)
    log.info('HookSource started', { eventsLog: this.eventsLog })
  }

  private async watchFile(signal: AbortSignal): Promise<void> {
    const RETRY_INTERVAL = 2000
    while (!signal.aborted) {
      try {
        const watcher = watch(this.eventsLog, { signal })
        for await (const event of watcher) {
          if (event.eventType === 'change') {
            await this.readNewEvents()
          }
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).name === 'AbortError') break
        log.warn('HookSource watch loop failed; retrying', { eventsLog: this.eventsLog }, err)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, RETRY_INTERVAL)
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              resolve()
            },
            { once: true }
          )
        })
      }
    }
  }

  private async readNewEvents(): Promise<void> {
    try {
      const fileStat = await stat(this.eventsLog).catch(() => null)
      if (!fileStat) return
      const content = await readFile(this.eventsLog, 'utf-8')
      const newContent = content.slice(this.lastReadOffset)
      this.lastReadOffset = content.length
      if (!newContent.trim()) return
      let dispatched = 0
      let skipped = 0
      for (const line of newContent.split('\n')) {
        const event = parseHookLogLine(line)
        if (event && !this.shouldSkip?.(event)) {
          this.dispatch({ type: 'hooks:event', payload: event })
          dispatched += 1
        } else if (event) {
          skipped += 1
        }
      }
      if (dispatched > 0 || skipped > 0) {
        log.debug('HookSource processed new events', {
          eventsLog: this.eventsLog,
          dispatched,
          skipped,
        })
      }
    } catch (err) {
      // File may not exist yet
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('HookSource failed to read events log', { eventsLog: this.eventsLog }, err)
      }
    }
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    log.info('HookSource stopped', { eventsLog: this.eventsLog })
  }
}
