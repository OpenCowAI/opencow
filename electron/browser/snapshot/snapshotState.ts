// SPDX-License-Identifier: Apache-2.0

/**
 * SnapshotState — Independent state container for the latest snapshot.
 *
 * Holds the refMap and timestamp, provides ref resolution and staleness detection.
 * Does not depend on Executor or Service — fully testable in isolation.
 *
 * Design: Extracted from Executor as an independent class (SRP).
 * Multiple consumers can read state without coupling to execution logic.
 */

import type { RefEntry, SnapshotResult } from './snapshotTypes'
import type { BrowserError } from '../types'
import { createLogger } from '../../platform/logger'

const log = createLogger('SnapshotState')

// ─── Error Shapes ────────────────────────────────────────────────────────

type SnapshotStaleError = BrowserError & { code: 'SNAPSHOT_STALE' }
type RefNotFoundError = BrowserError & { code: 'REF_NOT_FOUND'; ref: string }

// ─── State Container ─────────────────────────────────────────────────────

export class SnapshotState {
  /** Snapshots older than this threshold trigger a staleness warning. */
  static readonly STALENESS_MS = 30_000

  private refMap: ReadonlyMap<string, RefEntry> | null = null
  private _timestamp: number = 0

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Store the result of a successful snapshot.
   */
  update(result: SnapshotResult): void {
    this.refMap = result.refMap
    this._timestamp = Date.now()
  }

  /**
   * Resolve a ref string (e.g. "e1" or "@e1") to its RefEntry.
   *
   * @throws SNAPSHOT_STALE when no snapshot has been taken
   * @throws REF_NOT_FOUND when the ref doesn't exist (includes hint)
   *
   * Logs a warning (but still returns) when snapshot is stale.
   */
  resolveRef(ref: string): RefEntry {
    // 1. Must have a snapshot
    if (this.refMap === null) {
      throw {
        code: 'SNAPSHOT_STALE',
        message: 'No snapshot available. Call browser_snapshot first.',
      } satisfies SnapshotStaleError
    }

    // 2. Normalize — accept both "e1" and "@e1"
    const normalized = ref.startsWith('@') ? ref.slice(1) : ref

    // 3. Look up
    const entry = this.refMap.get(normalized)
    if (!entry) {
      throw {
        code: 'REF_NOT_FOUND',
        ref: normalized,
        message:
          `Ref "${normalized}" not found in current snapshot. ` +
          `Available refs: ${this.refHint()}`,
      } satisfies RefNotFoundError
    }

    // 4. Staleness warning (non-blocking — still returns the entry)
    if (this.isStale) {
      log.warn(
        `Snapshot is stale (${((Date.now() - this._timestamp) / 1000).toFixed(1)}s old). ` +
        'Results may be inaccurate — consider taking a fresh snapshot.',
      )
    }

    return entry
  }

  /**
   * Invalidate the current snapshot (e.g. after navigation).
   */
  invalidate(): void {
    this.refMap = null
    this._timestamp = 0
  }

  // ── Getters ────────────────────────────────────────────────────────

  get isEmpty(): boolean {
    return this.refMap === null
  }

  get isStale(): boolean {
    if (this._timestamp === 0) return true
    return Date.now() - this._timestamp > SnapshotState.STALENESS_MS
  }

  get timestamp(): number {
    return this._timestamp
  }

  // ── Internals ──────────────────────────────────────────────────────

  /**
   * First 10 refs formatted for error hint display.
   * Example: e1=button:'Submit', e2=link:'Home'
   */
  private refHint(): string {
    if (!this.refMap) return '(none)'

    const hints: string[] = []
    for (const [key, entry] of this.refMap) {
      if (hints.length >= 10) break
      hints.push(`${key}=${entry.role}:'${entry.name}'`)
    }
    return hints.join(', ') || '(empty)'
  }
}
