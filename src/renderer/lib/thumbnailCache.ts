// SPDX-License-Identifier: Apache-2.0

/**
 * thumbnailCache — Lightweight external store for browser view thumbnails.
 *
 * Stores resized JPEG data URLs keyed by viewId. Lives outside Zustand
 * to avoid bloating state snapshots with image data (~10-20KB per entry).
 *
 * React components consume this via `useSyncExternalStore`:
 *
 *   const thumbnail = useThumbnail(viewId)
 *
 * The cache emits change notifications so subscribed components re-render
 * when a thumbnail is updated or removed.
 */

import { useSyncExternalStore } from 'react'

// ─── Internal state ──────────────────────────────────────────────────────

const cache = new Map<string, string>()
let version = 0
const listeners = new Set<() => void>()

function emitChange(): void {
  version++
  listeners.forEach((l) => l())
}

// ─── Public API ──────────────────────────────────────────────────────────

export const thumbnailCache = {
  set(viewId: string, dataUrl: string): void {
    cache.set(viewId, dataUrl)
    emitChange()
  },

  get(viewId: string): string | null {
    return cache.get(viewId) ?? null
  },

  delete(viewId: string): void {
    if (cache.has(viewId)) {
      cache.delete(viewId)
      emitChange()
    }
  },

  /** Subscribe to change events (for useSyncExternalStore). */
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /** Snapshot getter (for useSyncExternalStore). */
  getSnapshot(): number {
    return version
  },
}

// ─── React Hook ──────────────────────────────────────────────────────────

/**
 * Subscribe to the thumbnail for a specific viewId.
 * Returns the data URL string or null if no thumbnail is cached.
 *
 * Re-renders only when the cache version changes (any thumbnail updated).
 * For the typical PiP use case (1-3 views), this is negligible.
 */
export function useThumbnail(viewId: string | null): string | null {
  useSyncExternalStore(thumbnailCache.subscribe, thumbnailCache.getSnapshot)
  return viewId ? thumbnailCache.get(viewId) : null
}
