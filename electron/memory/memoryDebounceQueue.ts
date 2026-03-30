// SPDX-License-Identifier: Apache-2.0

import type { InteractionEvent } from './types'
import { MEMORY_DEFAULTS } from '@shared/types'
import { createLogger } from '../platform/logger'

const log = createLogger('MemoryDebounceQueue')

type FlushListener = (event: InteractionEvent) => void

/**
 * Debounce queue that batches rapid interaction events before
 * sending them to the LLM extractor. Events with the same key
 * (projectId:sourceType:sessionId) are merged within a window.
 *
 * Uses a composable listener pattern (consistent with DataBus).
 */
export class MemoryDebounceQueue {
  private queue = new Map<
    string,
    { events: InteractionEvent[]; timer: ReturnType<typeof setTimeout> }
  >()
  private flushListeners: FlushListener[] = []

  private readonly getDebounceMs: () => number
  private readonly maxQueueDepth = 20
  private readonly maxBatchSize = 5

  constructor(getDebounceMs?: () => number) {
    this.getDebounceMs = getDebounceMs ?? (() => MEMORY_DEFAULTS.extractionDelaySeconds * 1000)
  }

  /**
   * Register a flush listener. Returns an unsubscribe function.
   * Consistent with DataBus.onBroadcast() pattern.
   */
  addFlushListener(fn: FlushListener): () => void {
    this.flushListeners.push(fn)
    return () => {
      this.flushListeners = this.flushListeners.filter((l) => l !== fn)
    }
  }

  enqueue(event: InteractionEvent): void {
    const key = this.getKey(event)
    const entry = this.queue.get(key)

    if (entry) {
      entry.events.push(event)
      if (entry.events.length > this.maxQueueDepth) {
        log.warn('queue overflow, dropping oldest event', { key, depth: entry.events.length })
        entry.events.shift()
      }
      clearTimeout(entry.timer)
    }
    log.debug('enqueue', { key, source: event.type, queueDepth: entry ? entry.events.length : 1 })

    const timer = setTimeout(() => this.flush(key), this.getDebounceMs())

    if (entry) {
      entry.timer = timer
    } else {
      this.queue.set(key, { events: [event], timer })
    }
  }

  private flush(key: string): void {
    const entry = this.queue.get(key)
    if (!entry) return
    this.queue.delete(key)

    const batch = entry.events.slice(-this.maxBatchSize)
    const merged = this.mergeEvents(batch)
    log.debug('flush', { key, batchSize: batch.length, mergedContentLength: merged.content.length })

    for (const listener of this.flushListeners) {
      listener(merged)
    }
  }

  private mergeEvents(events: InteractionEvent[]): InteractionEvent {
    if (events.length === 1) return events[0]

    const latest = events[events.length - 1]
    return {
      ...latest,
      content: events.map((e) => e.content).join('\n---\n'),
    }
  }

  private getKey(event: InteractionEvent): string {
    return `${event.projectId ?? 'global'}:${event.type}:${event.sessionId ?? 'none'}`
  }

  /** Clear all pending timers (for shutdown). */
  dispose(): void {
    for (const entry of this.queue.values()) {
      clearTimeout(entry.timer)
    }
    this.queue.clear()
    this.flushListeners = []
  }
}
