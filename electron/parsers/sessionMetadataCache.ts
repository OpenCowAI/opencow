// SPDX-License-Identifier: Apache-2.0

/**
 * File-stat based in-memory cache for parsed file content.
 *
 * Eliminates redundant file I/O during session scanning by caching
 * parsed results keyed on (filePath, mtime, size). If neither mtime
 * nor size has changed, the file is guaranteed to be identical and
 * the cached value is returned without opening the file.
 *
 * Design decisions:
 * - Generic over the cached value type T (used for SessionMetadata)
 * - Parse function is injected via get() (inversion of control) → testable
 * - Stale entries for deleted files are pruned via prune()
 * - In-memory only — no persistence needed since scans run every few seconds
 */

/** Freshness key: if both match, the file is unchanged. */
interface CacheKey {
  readonly mtimeMs: number
  readonly size: number
}

interface CacheEntry<T> {
  readonly key: CacheKey
  readonly value: T
}

export class FileStatCache<T> {
  private cache = new Map<string, CacheEntry<T>>()

  /**
   * Get the cached value for a file, or parse it if stale/missing.
   *
   * @param filePath - Absolute path to the file
   * @param mtimeMs  - File modification time (from a prior stat() call)
   * @param size     - File size in bytes (from a prior stat() call)
   * @param parse    - Async function invoked only on cache miss
   * @returns The parsed (or cached) value
   */
  async get(
    filePath: string,
    mtimeMs: number,
    size: number,
    parse: () => Promise<T>
  ): Promise<T> {
    const existing = this.cache.get(filePath)

    if (existing && existing.key.mtimeMs === mtimeMs && existing.key.size === size) {
      return existing.value
    }

    const value = await parse()
    this.cache.set(filePath, { key: { mtimeMs, size }, value })
    return value
  }

  /**
   * Remove entries whose file paths are no longer in the active set.
   * Call after each scan with the set of currently-discovered file paths.
   */
  prune(activeFiles: Set<string>): void {
    for (const key of this.cache.keys()) {
      if (!activeFiles.has(key)) {
        this.cache.delete(key)
      }
    }
  }

  /** Number of cached entries (for diagnostics). */
  get size(): number {
    return this.cache.size
  }

  /** Clear all entries. */
  clear(): void {
    this.cache.clear()
  }
}
