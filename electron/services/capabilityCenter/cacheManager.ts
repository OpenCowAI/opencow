// SPDX-License-Identifier: Apache-2.0

/**
 * Capability Cache Manager — project-keyed snapshot cache with file watching.
 *
 * v3.1 fixes:
 *   #18 — project-keyed Map<string, CapabilitySnapshot> instead of single slot
 *   #12 — watch() per category directory, called by CapabilityCenter.startWatching()
 *   #24 — onInvalidate() callback mechanism for DataBus dispatch
 *
 * Quality review fixes:
 *   - debounce returns cancellable handle; dispose() cancels pending timers
 *   - dispose() properly handles watcher.close() Promise
 *   - chokidar 'error' events are logged instead of silently swallowed
 *   - magic numbers extracted to named constants
 *   - empty catch replaced with log.warn
 *
 * Uses chokidar to watch *.md and *.json files with:
 *   - STABILITY_THRESHOLD_MS stability threshold (awaitWriteFinish)
 *   - DEBOUNCE_MS debounce to batch rapid changes
 */

import chokidar, { type FSWatcher } from 'chokidar'
import type { CapabilitySnapshot } from '@shared/types'
import { createLogger } from '../../platform/logger'

const log = createLogger('CapabilityCacheManager')

// ─── Constants ──────────────────────────────────────────────────────────

const STABILITY_THRESHOLD_MS = 300
const POLL_INTERVAL_MS = 100
const DEBOUNCE_MS = 200

// ─── Debounce with cancel ───────────────────────────────────────────────

interface Debounced {
  call: () => void
  cancel: () => void
}

function debounce(fn: () => void, ms: number): Debounced {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    call: () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(fn, ms)
    },
    cancel: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

// ─── CapabilityCacheManager ───────────────────────────────────────────────

export class CapabilityCacheManager {
  private snapshots = new Map<string, CapabilitySnapshot>()
  private watchers = new Map<string, FSWatcher>()
  private debouncedHandles: Debounced[] = []
  private listeners = new Set<() => void>()

  /** Get cached snapshot by project key (or '__global__' for global) */
  get(cacheKey: string): CapabilitySnapshot | null {
    return this.snapshots.get(cacheKey) ?? null
  }

  /** Store a snapshot in cache */
  set(cacheKey: string, snapshot: CapabilitySnapshot): void {
    this.snapshots.set(cacheKey, snapshot)
  }

  /** Invalidate all cached snapshots and notify listeners */
  invalidate(): void {
    this.snapshots.clear()
    for (const fn of this.listeners) {
      try {
        fn()
      } catch (err) {
        log.warn('Invalidation listener threw', err)
      }
    }
  }

  /**
   * Start watching a directory for changes.
   * No-op if already watching that directory.
   */
  watch(storeDir: string): void {
    if (this.watchers.has(storeDir)) return

    const watcher = chokidar.watch(
      [`${storeDir}/**/*.md`, `${storeDir}/**/*.json`],
      {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: STABILITY_THRESHOLD_MS,
          pollInterval: POLL_INTERVAL_MS,
        },
        ignored: [/node_modules/, /\.git/],
      },
    )

    // Log watcher errors instead of swallowing them
    watcher.on('error', (err) => {
      log.warn(`File watcher error for ${storeDir}`, err)
    })

    const handle = debounce(() => this.invalidate(), DEBOUNCE_MS)
    this.debouncedHandles.push(handle)
    watcher.on('all', handle.call)
    this.watchers.set(storeDir, watcher)
  }

  /**
   * Register a callback for cache invalidation events.
   * Returns an unsubscribe function.
   */
  onInvalidate(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Clean up all watchers and clear caches */
  dispose(): void {
    // Cancel all pending debounced invalidations
    for (const handle of this.debouncedHandles) {
      handle.cancel()
    }
    this.debouncedHandles = []

    // Close all file watchers (fire-and-forget — closing is best-effort)
    for (const w of this.watchers.values()) {
      w.close().catch((err) => {
        log.warn('Error closing file watcher', err)
      })
    }
    this.watchers.clear()
    this.snapshots.clear()
    this.listeners.clear()
  }
}
