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
 * Three independent dirty channels:
 *   - `message`  — high-frequency streaming text updates
 *                   (assistant.partial, hook_progress)
 *   - `progress` — tool.progress output (lower priority, 200 ms window)
 *   - `session`  — session metadata updates (activity, cost, state)
 *                   triggered by system lifecycle events
 *
 * `progress` uses a separate, longer timer (200 ms ≈ 5 fps) because
 * tool output is a scrollable log that doesn't need 20 fps visual
 * updates.  This reduces IPC round-trips for progress-only changes
 * by 75% compared to the message channel (50 ms).
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

import { DISPATCH_THROTTLE_INTERVAL_MS, PROGRESS_THROTTLE_INTERVAL_MS } from '../conversation/constants'

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
   * Throttle window for message channel in milliseconds.
   * Defaults to DISPATCH_THROTTLE_INTERVAL_MS (50 ms ≈ 20 fps).
   */
  readonly intervalMs?: number

  /**
   * Throttle window for progress channel in milliseconds.
   * Defaults to PROGRESS_THROTTLE_INTERVAL_MS (200 ms ≈ 5 fps).
   *
   * Tool.progress output is a scrollable log — 5 fps visual updates
   * are perceptually smooth while reducing IPC round-trips by 75%.
   */
  readonly progressIntervalMs?: number
}

export class DispatchThrottle {
  private _messagePending = false
  private _sessionPending = false
  private _progressPending = false
  private _timer: ReturnType<typeof setTimeout> | null = null
  private _progressTimer: ReturnType<typeof setTimeout> | null = null

  private readonly _onFlushMessage: () => void
  private readonly _onFlushSession: () => void
  private readonly _intervalMs: number
  private readonly _progressIntervalMs: number

  constructor(config: DispatchThrottleConfig) {
    this._onFlushMessage = config.onFlushMessage
    this._onFlushSession = config.onFlushSession
    this._intervalMs = config.intervalMs ?? DISPATCH_THROTTLE_INTERVAL_MS
    this._progressIntervalMs = config.progressIntervalMs ?? PROGRESS_THROTTLE_INTERVAL_MS
  }

  /**
   * Mark the `message` channel as dirty.
   *
   * Use for high-frequency events that update an EXISTING message
   * in-place (assistant.partial, hook_progress). The flush callback will
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
   * Mark the `progress` channel as dirty.
   *
   * Use for tool.progress events — tool output is a scrollable log
   * that doesn't need 20 fps updates.  Uses a separate 200 ms timer
   * that reuses the `onFlushMessage` callback when it fires.
   *
   * If the main message timer is already pending (text streaming in
   * progress), the progress update piggybacks on the 50 ms message
   * flush — no separate IPC dispatch needed.
   */
  scheduleProgress(): void {
    // If a message flush is already pending (text streaming active),
    // piggyback: progress will be included in the message snapshot.
    if (this._messagePending) return
    this._progressPending = true
    this._ensureProgressTimer()
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
    this._cancelProgressTimer()
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
    this._cancelProgressTimer()
    this._messagePending = false
    this._sessionPending = false
    this._progressPending = false
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Start the main throttle timer if not already running.
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
   * Start the progress throttle timer if not already running.
   *
   * Separate from the main timer — fires at 200 ms intervals.
   * When it fires, it dispatches via `onFlushMessage` (same callback)
   * to send the current message snapshot including accumulated progress.
   */
  private _ensureProgressTimer(): void {
    if (this._progressTimer !== null) return
    this._progressTimer = setTimeout(() => {
      this._progressTimer = null
      if (this._progressPending) {
        this._progressPending = false
        this._onFlushMessage()
      }
    }, this._progressIntervalMs)
  }

  /**
   * Flush all pending dirty channels.
   *
   * Order: message → session. This ensures the renderer has the
   * latest message content when the session metadata snapshot arrives.
   *
   * Also clears the progress flag — if a message flush happens,
   * it includes the latest progress snapshot, so the separate
   * progress timer is no longer needed for this window.
   */
  private _flush(): void {
    if (this._messagePending || this._progressPending) {
      this._messagePending = false
      this._progressPending = false
      // Cancel the separate progress timer — this flush covers it
      this._cancelProgressTimer()
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

  private _cancelProgressTimer(): void {
    if (this._progressTimer !== null) {
      clearTimeout(this._progressTimer)
      this._progressTimer = null
    }
  }
}
