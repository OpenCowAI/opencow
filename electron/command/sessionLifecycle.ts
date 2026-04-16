// SPDX-License-Identifier: Apache-2.0

import type { ManagedSessionMessage, UserMessageContent } from '../../src/shared/types'
import type { EngineRuntimeEventEnvelope } from '../conversation/runtime/events'
import type { SessionLaunchOptions } from './sessionLaunchOptions'
import { QueryLifecycle } from './queryLifecycle'

export interface SessionLifecycleCallbacks {
  onExecutionContextSignal?: (signal: SessionExecutionContextSignal) => void
}

export type SessionExecutionContextSignalSource =
  | 'startup'
  | 'runtime'
  | 'hook'
  | 'external'

export interface SessionExecutionContextSignal {
  cwd: string
  source: SessionExecutionContextSignalSource
  occurredAtMs?: number
}

export interface SessionLifecycleStartInput {
  initialPrompt: UserMessageContent
  launchOptions: SessionLaunchOptions
  callbacks?: SessionLifecycleCallbacks
  /**
   * ε.3d.2 — per-turn options resolver.
   *
   * Called once before EACH turn's SDK `session.query()` call. Returns
   * a narrow overlay applied ONLY to that single turn. In v1 the
   * overlay is limited to `env`, which is deep-merged on top of the
   * Session's base env by SessionRuntime — covering the primary use
   * case: refreshing provider credentials / model / base URL between
   * turns so mid-session Settings changes take effect on the next
   * message without lifecycle kill + respawn. The drift-detection
   * branch in sessionOrchestrator becomes redundant as a result.
   *
   * The overlay type is intentionally narrow: nothing that would
   * require recomposing session-level state (system prompt, tool
   * pool, MCP servers) belongs here. Session-level state stays
   * session-level.
   */
  resolveTurnOptions?: () => Promise<TurnOptionsOverlay>

  /**
   * Source-of-truth snapshot of the session's full message history.
   *
   * Called ONCE per turn (not at start) — before each SDK `session.query()`
   * call the lifecycle uses the returned array (minus the trailing entry,
   * which is the current user prompt being submitted) as
   * `options.initialMessages`.
   *
   * **Why this is required.** SDK's `SessionRuntime` (runtime.ts:62-116)
   * holds only `baseOptions`/`closed` — it has no per-session message
   * accumulator. Each `session.query()` builds its own `mutableMessages`
   * from `options.initialMessages` (sdkRuntime.ts:345), which resets to
   * the session-creation-time value every turn. Without host-side replay,
   * turn N+1 sees only the new user prompt with no prior context and the
   * model answers as if the session just started (see
   * `plans/per-turn-history-replay.md` for the full analysis).
   *
   * **Why a getter, not a snapshot.** The host owns `ManagedSession` and
   * mutates its `messages` array as assistant/tool events stream in; the
   * lifecycle must read a FRESH snapshot on each turn. A one-time
   * snapshot at start() would miss everything generated after start().
   */
  getSessionMessages: () => readonly ManagedSessionMessage[]
}

/** ε.3d.2 — narrow per-turn option overlay. */
export interface TurnOptionsOverlay {
  /** Fresh environment variables (deep-merged on top of Session env). */
  env?: Record<string, string>
}

/**
 * Engine-agnostic lifecycle contract used by SessionOrchestrator.
 *
 * A lifecycle owns exactly one long-lived conversation stream and supports:
 * - start() once
 * - pushMessage() many times while active
 * - stop() idempotently
 */
export interface SessionLifecycle {
  readonly stopped: boolean
  start(input: SessionLifecycleStartInput): AsyncIterable<EngineRuntimeEventEnvelope>
  pushMessage(content: UserMessageContent): void
  stop(): Promise<void>
}

export function createSessionLifecycle(): SessionLifecycle {
  return new QueryLifecycle()
}
