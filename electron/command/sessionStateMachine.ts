// SPDX-License-Identifier: Apache-2.0

import type { SessionStopReason } from '../../src/shared/types'

/**
 * All possible lifecycle events that trigger a state transition on ManagedSession.
 *
 * These events replace ad-hoc calls to setState/setError/setStopReason/clearError
 * scattered across sessionOrchestrator and effectProjector. By funneling all
 * state mutations through `ManagedSession.transition(event)`, illegal transitions
 * become impossible and the state machine is centralized in a single method.
 */
export type SessionLifecycleEvent =
  | { type: 'engine_initialized' }
  | { type: 'turn_completed'; stopReason: SessionStopReason }
  | { type: 'turn_error'; message: string }
  | { type: 'stream_ended_clean' }
  | { type: 'lifecycle_exited_silently' }
  | { type: 'user_stopped' }
  | { type: 'resume_session' }
  | { type: 'push_to_active' }
  | { type: 'question_asked' }
  | { type: 'question_answered' }
  | { type: 'recover_from_awaiting_input' }
  | { type: 'awaiting_input' }
  | { type: 'spawn_error_transient' }
  | { type: 'spawn_error_permanent'; message: string }
  | { type: 'process_corrupted'; message: string }
  | { type: 'protocol_violation'; message: string }
  | { type: 'shutdown' }
