// SPDX-License-Identifier: Apache-2.0

import type { UserMessageContent, AIEngineKind } from '../../src/shared/types'
import type { EngineRuntimeEventEnvelope } from '../conversation/runtime/events'
import { QueryLifecycle } from './queryLifecycle'
import { CodexQueryLifecycle } from './codexQueryLifecycle'

export interface SessionLifecycleCallbacks {
  onExecutionContextSignal?: (signal: SessionExecutionContextSignal) => void
  /**
   * Runtime-reported working directory changes (e.g. Codex turn_context.cwd).
   * Optional because some engines do not expose cwd runtime signals.
   */
  onCwdDetected?: (cwd: string) => void
}

export type SessionExecutionContextSignalSource =
  | 'startup'
  | 'codex.turn_context'
  | 'codex.session_meta'
  | 'claude.hook'
  | 'unknown'

export interface SessionExecutionContextSignal {
  cwd: string
  source: SessionExecutionContextSignalSource
  occurredAtMs?: number
}

export interface SessionLifecycleStartInput {
  initialPrompt: UserMessageContent
  launchOptions: Record<string, unknown>
  callbacks?: SessionLifecycleCallbacks
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

export function createSessionLifecycle(engineKind: AIEngineKind): SessionLifecycle {
  return engineKind === 'codex' ? new CodexQueryLifecycle() : new QueryLifecycle()
}
