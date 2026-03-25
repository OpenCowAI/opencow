// SPDX-License-Identifier: Apache-2.0

/**
 * Session lifecycle-bound timer manager.
 *
 * All `setTimeout` calls within a session's event loop MUST go through
 * this manager. When the session ends (dispose), all pending timers are
 * automatically cancelled — preventing orphaned callbacks that reference
 * stale session state.
 *
 * Replaces the raw `setTimeout` calls in `runSession()`:
 *   - L727: `pendingAwaitingInput` timer (500ms deferred state broadcast)
 *   - L860: `compact_boundary` phase-2 timer (1500ms UI transition)
 */
export class SessionTimerScope {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * Set or replace a named timer.
   * If a timer with the same key already exists, it is cancelled first.
   */
  set(key: string, callback: () => void, delayMs: number): void {
    this.cancel(key)
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        callback()
      }, delayMs),
    )
  }

  /** Cancel a named timer (no-op if not found). */
  cancel(key: string): void {
    const t = this.timers.get(key)
    if (t !== undefined) {
      clearTimeout(t)
      this.timers.delete(key)
    }
  }

  /** Check if a named timer is currently pending. */
  has(key: string): boolean {
    return this.timers.has(key)
  }

  /** Number of pending timers. */
  get size(): number {
    return this.timers.size
  }

  /** Cancel all pending timers. Called on session end. */
  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }
}
