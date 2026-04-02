// SPDX-License-Identifier: Apache-2.0

/**
 * SessionContext — read-only dependency aggregate for SDK event handlers.
 *
 * All fields are `readonly`. Mutable state lives inside:
 *   - `StreamState` (streaming message tracking + throttle)
 *   - `SessionTimerScope` (lifecycle-bound timers)
 *   - `ToolProgressRelay` (per-session progress routing)
 *   - `DispatchThrottle` (IPC dispatch coalescing for high-frequency events)
 *
 * Lifecycle callbacks (`isSessionAlive`, `persistSession`, `onStreamStarted`)
 * are closures injected by the orchestrator — SessionContext never imports
 * store or session-map types.
 *
 * Each handler receives `(msg, ctx)` and accesses dependencies through `ctx`.
 * This eliminates closure-captured variables and makes handlers independently testable.
 */

import type { ManagedSession } from './managedSession'
import type { SessionTimerScope } from './sessionTimerScope'
import type { StreamState } from './streamState'
import type { ToolProgressRelay } from '../utils/toolProgressRelay'
import type { DataBusEvent } from '../../src/shared/types'
import { DispatchThrottle } from './dispatchThrottle'
import { StreamingMessageBuffer } from './streamingMessageBuffer'

// TODO: Extract Dispatch to a shared types module (e.g. electron/types.ts)
// so it can be reused across orchestrator, context, and handlers.
type Dispatch = (event: DataBusEvent) => void

export interface SessionContextParams {
  session: ManagedSession
  dispatch: Dispatch
  timers: SessionTimerScope
  stream: StreamState
  relay: ToolProgressRelay
  /** Guard: returns true if this session handle is still active. */
  isSessionAlive: () => boolean
  /** Persist the current session state. Async, fire-and-forget. */
  persistSession: () => Promise<void>
  /** Called on successful SDK stream start (init message). */
  onStreamStarted: () => void
  /**
   * Called when a `result` SDK event is processed and the session enters
   * a terminal state (idle or error).
   *
   * Enables immediate execution-status updates for schedule-backed sessions
   * without waiting for the SDK child process to exit. The SDK keeps its
   * MessageQueue open for multi-turn conversations, so `lifecycleDone` may
   * never resolve for non-interactive sessions — this callback bridges
   * the gap.
   */
  onResultReceived: () => void
}

export class SessionContext {
  readonly sessionId: string
  readonly session: ManagedSession
  readonly dispatch: Dispatch
  readonly timers: SessionTimerScope
  readonly stream: StreamState
  readonly relay: ToolProgressRelay
  readonly throttle: DispatchThrottle
  readonly buffer: StreamingMessageBuffer
  readonly isSessionAlive: () => boolean
  readonly persistSession: () => Promise<void>
  readonly onStreamStarted: () => void
  readonly onResultReceived: () => void

  /**
   * Message IDs queued for dispatch on the next throttle flush.
   *
   * System events (task_started, hook_started, etc.) are non-interactive
   * messages that don't need immediate IPC dispatch. Instead of calling
   * `dispatchLastMessage()` immediately (which creates a separate IPC
   * event and triggers a separate renderer slow-path), they queue their
   * message ID here and call `throttle.scheduleMessage()`.
   *
   * When the throttle fires `onFlushMessage`, queued IDs are dispatched
   * alongside the streaming message in a single burst — the renderer's
   * write-coalescing buffer (`useAppBootstrap._pendingMsgs`) batches
   * them into ONE `batchAppendSessionMessages` call, triggering ONE
   * slow-path merge instead of 3-5.
   *
   * `flushNow()` (from terminal events) also drains this queue,
   * ensuring no messages are lost.
   */
  private _pendingMessageIds: string[] = []

  constructor(params: SessionContextParams) {
    this.sessionId = params.session.id
    this.session = params.session
    this.dispatch = params.dispatch
    this.timers = params.timers
    this.stream = params.stream
    this.relay = params.relay
    this.buffer = new StreamingMessageBuffer()
    this.isSessionAlive = params.isSessionAlive
    this.persistSession = params.persistSession
    this.onStreamStarted = params.onStreamStarted
    this.onResultReceived = params.onResultReceived

    this.throttle = new DispatchThrottle({
      onFlushMessage: () => {
        // Dispatch queued system event messages first — ensures the
        // renderer sees them in the same batch as the streaming message.
        const flushedQueued = this._flushPendingMessageIds()

        // Fast path: read snapshot from the streaming buffer — O(1).
        // The buffer holds a direct reference to the message in ManagedSession.messages[],
        // eliminating the O(M) find() that dispatchMessageById would perform.
        const snapshot = this.buffer.getSnapshot()
        if (snapshot) {
          this.dispatch({
            type: 'command:session:message',
            payload: {
              sessionId: this.sessionId,
              origin: this.session.origin,
              message: snapshot,
            },
          })
        } else if (this.stream.streamingMessageId) {
          // Fallback: buffer not active but stream is (edge case, e.g. relay).
          this.dispatchMessageById(this.stream.streamingMessageId)
        } else {
          // IMPORTANT:
          // When queued messages were already flushed above, calling
          // dispatchLastMessage() can duplicate the same final assistant message
          // in the same tick (common for tool_use finalization path).
          // Skip fallback in that case.
          if (!flushedQueued) {
            this.dispatchLastMessage()
          }
        }
      },
      onFlushSession: () => this.dispatchSessionUpdated(),
    })
  }

  /**
   * Queue a message for dispatch on the next throttle flush.
   *
   * Use for non-interactive messages (system events) that benefit from
   * being coalesced with the streaming message dispatch.
   */
  queueMessageDispatch(messageId: string): void {
    this._pendingMessageIds.push(messageId)
    this.throttle.scheduleMessage()
  }

  /**
   * Drain the pending message queue, dispatching each by ID.
   *
   * Safe against stale IDs: if a queued message was removed between
   * queueing and flushing (e.g., session reset), `dispatchMessageById`
   * silently skips it (`getMessageById` returns null).
   */
  private _flushPendingMessageIds(): boolean {
    if (this._pendingMessageIds.length === 0) return false
    const ids = this._pendingMessageIds
    this._pendingMessageIds = []
    for (const id of ids) {
      this.dispatchMessageById(id)
    }
    return true
  }

  /**
   * Dispatch the last message to the renderer.
   * O(1) — uses `getLastMessage()` instead of full `getInfo()` copy.
   */
  dispatchLastMessage(): void {
    const msg = this.session.getLastMessage()
    if (msg) {
      this.dispatch({
        type: 'command:session:message',
        payload: {
          sessionId: this.sessionId,
          origin: this.session.origin,
          message: msg,
        },
      })
    }
  }

  /**
   * Dispatch a specific message by ID.
   * O(n) in worst case (find by ID), but avoids full getInfo() copy.
   */
  dispatchMessageById(messageId: string): void {
    const msg = this.session.getMessageById(messageId)
    if (msg) {
      this.dispatch({
        type: 'command:session:message',
        payload: {
          sessionId: this.sessionId,
          origin: this.session.origin,
          message: msg,
        },
      })
    }
  }

  /**
   * Dispatch a relay progress update for a specific message.
   *
   * Semantically identical to `dispatchMessageById` but marks the event as
   * `isRelayProgress: true`. This flag enables differentiated routing:
   *   - Renderer: processes normally (Evose progress card)
   *   - Telegram: routes to `handleEvoseProgress` (lightweight placeholder update)
   *
   * Used by `registerEvoseRelay` as the throttled onFlush callback.
   */
  dispatchRelayProgress(messageId: string): void {
    const msg = this.session.getMessageById(messageId)
    if (!msg) return
    this.dispatch({
      type: 'command:session:message',
      payload: {
        sessionId: this.sessionId,
        origin: this.session.origin,
        message: msg,
        isRelayProgress: true,
      },
    })
  }

  /** Dispatch a session:updated event with full session info snapshot. */
  dispatchSessionUpdated(): void {
    this.dispatch({
      type: 'command:session:updated',
      payload: this.session.snapshot(),
    })
  }

  /** Session end: cancel all timers, clear relay, throttle, buffer, and pending queue. */
  dispose(): void {
    this.throttle.dispose()
    this.timers.dispose()
    this.relay.clear()
    this.buffer.clear()
    this._pendingMessageIds = []
  }
}
