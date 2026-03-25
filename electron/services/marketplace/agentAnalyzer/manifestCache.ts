// SPDX-License-Identifier: Apache-2.0

/**
 * In-memory LRU cache for validated Agent analysis manifests.
 *
 * Keyed by `slug@version:commitSha` so repeated installs of the same
 * repo revision skip the Agent session entirely.
 *
 * - Default TTL: 7 days
 * - Default max entries: 100
 * - LRU eviction via Map insertion-order (same pattern as MarketplaceService)
 * - Expired entries purged lazily on `get()`
 * - No persistence — cache lives only for the current session.
 */

import { createLogger } from '../../../platform/logger'
import type { ManifestCacheKey, ValidatedManifest } from './types'

const log = createLogger('ManifestCache')

/** Default time-to-live: 7 days in milliseconds. */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 604_800_000

/** Default maximum number of cached entries. */
const DEFAULT_MAX_ENTRIES = 100

// ─── Internal Types ─────────────────────────────────────────────────────

interface CacheEntry {
  manifest: ValidatedManifest
  expiresAt: number
}

interface ManifestCacheOptions {
  /** Time-to-live in milliseconds. Defaults to 7 days. */
  ttlMs?: number
  /** Maximum number of entries before LRU eviction. Defaults to 100. */
  maxEntries?: number
}

// ─── Cache Implementation ───────────────────────────────────────────────

export class ManifestCache {
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly entries = new Map<string, CacheEntry>()

  constructor(options?: ManifestCacheOptions) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES
  }

  /**
   * Retrieve a cached manifest by key.
   *
   * Returns `null` if the key is missing or the entry has expired.
   * Expired entries are purged lazily on access.
   */
  get(key: ManifestCacheKey): ValidatedManifest | null {
    const serialized = this.serializeKey(key)
    const entry = this.entries.get(serialized)
    if (!entry) return null

    // Lazy expiration
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(serialized)
      log.debug('Cache entry expired', { key: serialized })
      return null
    }

    // Move to end for LRU ordering (Map preserves insertion order)
    this.entries.delete(serialized)
    this.entries.set(serialized, entry)
    return entry.manifest
  }

  /** Store a validated manifest in the cache. */
  set(key: ManifestCacheKey, manifest: ValidatedManifest): void {
    const serialized = this.serializeKey(key)

    // Remove existing entry first so it moves to the end
    this.entries.delete(serialized)

    // Evict if at capacity
    if (this.entries.size >= this.maxEntries) {
      this.evict()
    }

    this.entries.set(serialized, {
      manifest,
      expiresAt: Date.now() + this.ttlMs,
    })
    log.debug('Cached manifest', {
      key: serialized,
      capabilities: manifest.capabilities.length,
    })
  }

  /** Remove a specific entry from the cache. */
  invalidate(key: ManifestCacheKey): void {
    const serialized = this.serializeKey(key)
    const deleted = this.entries.delete(serialized)
    if (deleted) {
      log.debug('Invalidated cache entry', { key: serialized })
    }
  }

  /** Remove all entries from the cache. */
  clear(): void {
    const count = this.entries.size
    this.entries.clear()
    if (count > 0) {
      log.debug('Cache cleared', { entriesRemoved: count })
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  /**
   * Serialize a cache key to a deterministic string.
   *
   * Format: `slug@version:commitSha` (or `slug@version:HEAD` when no SHA).
   */
  private serializeKey(key: ManifestCacheKey): string {
    return `${key.slug}@${key.version}:${key.commitSha ?? 'HEAD'}`
  }

  /** Remove expired entries, then evict oldest (LRU) until under limit. */
  private evict(): void {
    const now = Date.now()

    // Pass 1: purge all expired
    for (const [k, entry] of this.entries) {
      if (now > entry.expiresAt) this.entries.delete(k)
    }

    // Pass 2: if still over limit, evict oldest (first in Map = least recently used)
    if (this.entries.size >= this.maxEntries) {
      const toRemove = this.entries.size - this.maxEntries + 1
      const iter = this.entries.keys()
      for (let i = 0; i < toRemove; i++) {
        const k = iter.next().value
        if (k !== undefined) this.entries.delete(k)
      }
    }
  }
}
