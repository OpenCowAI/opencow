// SPDX-License-Identifier: Apache-2.0

/**
 * ToolProgressRelay — bridges EvoseNativeCapability (SSE chunks) and
 * SessionOrchestrator (messageId/toolUseId binding).
 *
 * Design principles:
 *  - onChunk  — called immediately for every chunk (no delay), keeping
 *               block.progress data accurate in real time
 *  - onFlush  — leading-edge throttle, fires at most once per throttleMs
 *               window, preventing high-frequency chunk bursts from
 *               overwhelming the renderer (~60 fps ceiling)
 *  - Timer lifecycle is managed centrally by the relay: both unregister
 *    and clear properly cancel any pending timer
 *  - Every relay entry is keyed by a single invocation key (toolUseId/invocationId)
 *
 * Lifecycle:
 *  - SessionOrchestrator calls register() when it detects a complete
 *    Evose tool_use block
 *  - EvoseNativeCapability tool handler pushes SSE chunks via emit()
 *  - Tool handler calls unregister() on completion (normal cleanup path,
 *    triggers a final flush)
 *  - Session idle/error/stop calls clear() (abnormal fallback path —
 *    no flush, pending data is discarded)
 */

import { DISPATCH_THROTTLE_INTERVAL_MS } from '../conversation/constants'
import { createLogger } from '../platform/logger'

const log = createLogger('ToolProgressRelay')

/**
 * Structured handlers passed to `register()`.
 *
 * - onChunk    — called synchronously for every SSE chunk (no throttling)
 * - onFlush    — IPC dispatch callback, throttled to at most once per
 *                `throttleMs` window
 * - onDone     — called ONCE when the tool finishes (from `unregister`,
 *                NOT from the throttle timer). Use this for final cleanup
 *                that should happen exactly once after all chunks have been
 *                processed — e.g. clearing `activeToolUseId` so the
 *                progress card transitions from "streaming" to "done" mode.
 * - throttleMs — throttle window in milliseconds (default DISPATCH_THROTTLE_INTERVAL_MS)
 */
export interface RelayHandlers {
  onChunk: (data: unknown) => void
  onFlush: () => void
  onDone?: () => void
  throttleMs?: number
}

interface RelayEntry {
  readonly onChunk: (data: unknown) => void
  readonly onFlush: () => void
  readonly onDone?: () => void
  readonly throttleMs: number
}

export class ToolProgressRelay {
  private readonly entries = new Map<string, RelayEntry>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * Register chunk + flush + done handlers for a tool.
   *
   * - onChunk:  called immediately for every arriving chunk (no throttle)
   * - onFlush:  IPC dispatch callback, throttled with a `throttleMs` window
   * - onDone:   fired once when the tool finishes (only from unregister,
   *             never from the throttle timer). Use it for final cleanup,
   *             e.g. clearing activeToolUseId to switch the card from
   *             streaming to done mode.
   *
   * If key already exists, old entry is replaced. Replacement cancels pending
   * timers but does not call onDone/onFlush (same semantics as historical behavior).
   */
  register(key: string, handlers: RelayHandlers): void {
    const normalized = this.normalizeKey(key)
    if (!normalized) return

    if (this.entries.has(normalized)) {
      this.dropEntry(normalized)
    }

    this.entries.set(normalized, {
      onChunk:    handlers.onChunk,
      onFlush:    handlers.onFlush,
      onDone:     handlers.onDone,
      throttleMs: handlers.throttleMs ?? DISPATCH_THROTTLE_INTERVAL_MS,
    })
  }

  /**
   * Unregister after the tool finishes (normal cleanup path).
   *
   * Lifecycle order:
   *   1. Cancel the pending timer
   *   2. onDone?.() — final cleanup (clears activeToolUseId, etc.).
   *                   Called BEFORE onFlush so the final flush includes
   *                   the "done" state (e.g. progress card transitions
   *                   from streaming to done mode in a single dispatch).
   *   3. onFlush()  — final progress flush: dispatches the complete
   *                   state snapshot (including onDone cleanup) to the renderer.
   */
  unregister(key: string): void {
    const normalized = this.normalizeKey(key)
    if (!normalized) return
    const entry = this.entries.get(normalized)
    this.dropEntry(normalized)
    entry?.onDone?.()   // cleanup first: clear executing state
    entry?.onFlush()    // then final flush: snapshot includes the "done" state
  }

  /**
   * Bulk cleanup when the session turn ends or the session is torn down.
   *
   * Calls onDone() for every registered entry before clearing, ensuring
   * side effects like clearing `activeToolUseId` are executed. Without this,
   * tools that rely on onDone (e.g. Evose tools) would leave stale
   * activeToolUseId values, causing stuck spinner states in the UI.
   *
   * No onFlush is called — the session turn is over, so dispatching
   * intermediate progress snapshots would be pointless.
   */
  clear(): void {
    for (const [key, entry] of this.entries.entries()) {
      this.cancelTimer(key)
      try {
        entry.onDone?.()
      } catch (err) {
        // Never let one entry's failure prevent cleanup of remaining entries.
        log.warn(`onDone() threw for relay key "${key}" during clear():`, err)
      }
    }
    this.entries.clear()
  }

  /**
   * Push a data event:
   *  1. Immediately call onChunk (synchronously updates block state,
   *     keeping data up-to-date at all times)
   *  2. Schedule onFlush via leading-edge throttle:
   *     — the first event in each throttle window starts the timer;
   *       subsequent events within the window do not reset it
   *     — when the window closes, flush dispatches the current
   *       block state snapshot (which already includes every event
   *       received during the window)
   */
  emit(key: string, data: unknown): void {
    const normalized = this.normalizeKey(key)
    if (!normalized) return

    const entry = this.entries.get(normalized)
    if (!entry) {
      // Warn when emit is called before register() — indicates a lifecycle bug.
      // Previously this was a silent return, making relay registration failures
      // impossible to diagnose (e.g. sessionOrchestrator not calling register()
      // because streamingMessageId was null when complete assistant msg arrived).
      log.warn(`emit() called for unregistered relay key "${normalized}" — chunk discarded. Check that register() was called before the tool handler runs.`)
      return
    }

    entry.onChunk(data)

    // Leading-edge throttle: only start a new round when no timer is pending
    // for the current window
    if (!this.timers.has(normalized)) {
      const timer = setTimeout(() => {
        this.timers.delete(normalized)
        // Confirm the entry still exists (unregister may have been called
        // before the timeout fired)
        this.entries.get(normalized)?.onFlush()
      }, entry.throttleMs)
      this.timers.set(normalized, timer)
    }
  }

  // --- Private ---------------------------------------------------------------

  private normalizeKey(key: string): string | null {
    if (typeof key !== 'string') return null
    const trimmed = key.trim()
    return trimmed || null
  }

  private dropEntry(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.cancelTimer(key)
    this.entries.delete(key)
  }

  private cancelTimer(key: string): void {
    const t = this.timers.get(key)
    if (t !== undefined) {
      clearTimeout(t)
      this.timers.delete(key)
    }
  }
}
