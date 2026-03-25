// SPDX-License-Identifier: Apache-2.0

/**
 * SessionRuntime — single-record aggregate for all per-session tracking state.
 *
 * Previously, SessionOrchestrator scattered per-session state across 8 Maps/Sets.
 * This type collapses them into a single Map<string, SessionRuntime>, making it
 * impossible to forget cleaning up one field when removing a session.
 *
 * The completion sub-state (`onComplete`, `completionFired`, `pendingCompletion`)
 * is co-located because its lifetime is bounded by the session lifecycle.
 */

import type { ManagedSession } from './managedSession'
import type { SessionLifecycle } from './sessionLifecycle'
import type { ConversationEventPipeline } from '../conversation/pipeline'
import type { ApiProvider, StartSessionPolicy, SessionStopReason } from '../../src/shared/types'

// ── Completion tracking ──────────────────────────────────────────────────────

export interface SessionCompletionResult {
  stopReason: SessionStopReason | null
  error?: string
}

export type SessionCompletionCallback = (result: SessionCompletionResult) => Promise<void> | void

// ── Main aggregate ───────────────────────────────────────────────────────────

export interface SessionRuntime {
  session: ManagedSession
  lifecycle: SessionLifecycle
  lifecycleDone: Promise<void>

  /** V3 conversation event pipeline for this session. */
  pipeline: ConversationEventPipeline | null

  /** Session-scoped capability policy snapshot taken at spawn time. */
  policy: StartSessionPolicy | null

  /** Provider mode frozen at lifecycle spawn — used to detect mid-session provider drift. */
  providerMode: ApiProvider | null

  /** Consecutive transient spawn-error count — reset on successful stream start. */
  spawnErrorCount: number

  // ── Completion tracking (replaces 3 Maps/Sets) ─────────────────────────

  /** One-shot callback fired when lifecycle ends (for result tracking). */
  onComplete?: SessionCompletionCallback

  /** True once completion has been fired — idempotency guard. */
  completionFired: boolean

  /**
   * Cached result when completion fires before callback is registered.
   * Guards the (rare) race where lifecycleDone resolves before
   * onSessionComplete registers the callback.
   */
  pendingCompletion?: SessionCompletionResult
}
