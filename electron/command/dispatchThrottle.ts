// SPDX-License-Identifier: Apache-2.0

/**
 * DispatchThrottle — fixed-window trailing-edge coalescing for
 * high-frequency IPC dispatches.
 *
 * Follows the ToolProgressRelay pattern:
 *   - Session state mutations are always synchronous (happen BEFORE
 *     scheduling, in the effectProjector)
 *   - IPC dispatches are coalesced within a fixed throttle window
 *   - The flush callback always reads CURRENT session state, so
 *     intermediate updates are never lost — only intermediate
 *     IPC round-trips are eliminated
 *
 * Semantics:
 *   - First event in a window starts a timer (no immediate dispatch).
 *   - Subsequent events within the same window are absorbed — they
 *     set their dirty flag but do NOT reset the timer.
 *   - When the timer fires, all pending dirty flags are flushed
 *     in a single pass: message first, then session metadata.
 *
 * Two independent dirty channels:
 *   - `message`  — high-frequency streaming message updates
 *                   (tool.progress, hook_progress)
 *   - `session`  — session metadata updates (activity, cost, state)
 *                   triggered by system lifecycle events
 *
 * Terminal events (turn.result, assistant.final, protocol.violation)
 * call `flushNow()` to guarantee:
 *   1. Any pending coalesced data is dispatched (ordering preservation)
 *   2. The terminal event's own direct dispatch executes immediately after
 *
 * Lifecycle: created with SessionContext, disposed with SessionContext.
 * `dispose()` cancels the timer without flushing — the session is over,
 * further dispatching would be pointless (matches ToolProgressRelay.clear()
 * semantics).
 */

import { DISPATCH_THROTTLE_INTERVAL_MS } from '../conversation/constants'

export interface DispatchThrottleConfig {
  /**
   * Flush callback for the `message` channel.
   *
   * Should dispatch the current streaming message to the renderer.
   * Called at most once per throttle window for high-frequency events.
   */
  readonly onFlushMessage: () => void

  /**
   * Flush callback for the `session` channel.
   *
   * Should dispatch the current session metadata snapshot to the renderer.
   * Called at most once per throttle window for clustered system events.
   */
  readonly onFlushSession: () => void

  /**
   * Throttle window in milliseconds.
   * Defaults to DISPATCH_THROTTLE_INTERVAL_MS (50 ms ≈ 20 fps).
   */
  readonly intervalMs?: number
}

export class DispatchThrottle {
  private _messagePending = false
  private _sessionPending = false
  private _timer: ReturnType<typeof setTimeout> | null = null

  private readonly _onFlushMessage: () => void
  private readonly _onFlushSession: () => void
  private readonly _intervalMs: number

  constructor(config: DispatchThrottleConfig) {
    this._onFlushMessage = config.onFlushMessage
    this._onFlushSession = config.onFlushSession
    this._intervalMs = config.intervalMs ?? DISPATCH_THROTTLE_INTERVAL_MS
  }

  /**
   * Mark the `message` channel as dirty.
   *
   * Use for high-frequency events that update an EXISTING message
   * in-place (tool.progress, hook_progress). The flush callback will
   * dispatch the latest version of the streaming message.
   *
   * Do NOT use for events that ADD new messages — those must dispatch
   * immediately via `dispatchLastMessage()` to avoid the renderer
   * missing intermediate messages (command:session:updated does not
   * carry messages for existing sessions).
   */
  scheduleMessage(): void {
    this._messagePending = true
    this._ensureTimer()
  }

  /**
   * Mark the `session` channel as dirty.
   *
   * Use for system lifecycle events whose `dispatchSessionUpdated()`
   * can be coalesced — each call produces a full snapshot via
   * `getInfo()`, so coalescing only eliminates redundant O(n) copies
   * and renderer re-renders.
   */
  scheduleSession(): void {
    this._sessionPending = true
    this._ensureTimer()
  }

  /**
   * Cancel the pending timer and flush all dirty channels immediately.
   *
   * Call before terminal events (turn.result, assistant.final,
   * protocol.violation) to guarantee:
   *   1. Pending coalesced data is dispatched first (ordering)
   *   2. The terminal event's own dispatch follows immediately
   */
  flushNow(): void {
    this._cancelTimer()
    this._flush()
  }

  /**
   * Cancel the pending timer without flushing.
   *
   * Called during session teardown — the session is ending,
   * dispatching stale data would be pointless.
   * Matches ToolProgressRelay.clear() semantics.
   */
  dispose(): void {
    this._cancelTimer()
    this._messagePending = false
    this._sessionPending = false
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Start the throttle timer if not already running.
   *
   * Fixed-window: the first event starts the window; subsequent events
   * within the window are absorbed (no timer reset). The timer fires
   * at the end of the window and flushes all accumulated dirty flags.
   */
  private _ensureTimer(): void {
    if (this._timer !== null) return
    this._timer = setTimeout(() => {
      this._timer = null
      this._flush()
    }, this._intervalMs)
  }

  /**
   * Flush all pending dirty channels.
   *
   * Order: message → session. This ensures the renderer has the
   * latest message content when the session metadata snapshot arrives.
   */
  private _flush(): void {
    if (this._messagePending) {
      this._messagePending = false
      this._onFlushMessage()
    }
    if (this._sessionPending) {
      this._sessionPending = false
      this._onFlushSession()
    }
  }

  private _cancelTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer)
      this._timer = null
    }
  }
}
