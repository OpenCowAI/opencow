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
import type { SessionExecutionContextSignal } from './sessionLifecycle'
import type { ConversationEventPipeline } from '../conversation/pipeline'
import type { NativeToolDescriptor } from '../nativeCapabilities/types'
import type { StartSessionPolicy, SessionStopReason } from '../../src/shared/types'
import type { ProviderProfileId } from '../../src/shared/providerProfile'

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

  /** Provider profile frozen at lifecycle spawn — used to detect mid-session provider drift. */
  providerProfileId: ProviderProfileId | null

  /** Consecutive transient spawn-error count — reset on successful stream start. */
  spawnErrorCount: number

  /**
   * Session-scoped execution-context signal sink.
   *
   * Owned by SessionOrchestrator.runSession() and wired into the per-session
   * ExecutionContextCoordinator. Exposed on runtime so external signal sources
   * (e.g. hookSource events) can feed cwd updates into the same
   * monotonic update pipeline.
   */
  executionContextSignalHandler?: (signal: SessionExecutionContextSignal) => void

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

  /**
   * Per-session custom tool descriptors (engine-agnostic).
   *
   * Stored on runtime (not ManagedSession) because tool descriptors contain
   * JS function references that can't be serialized/persisted.
   * Injected by SessionOrchestrator at session launch time.
   */
  customTools?: { name: string; tools: NativeToolDescriptor[] }
}
