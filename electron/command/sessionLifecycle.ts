// SPDX-License-Identifier: Apache-2.0

import type { UserMessageContent, AIEngineKind } from '../../src/shared/types'
import type { EngineRuntimeEventEnvelope } from '../conversation/runtime/events'
import type { ClaudeSessionLaunchOptions, CodexSessionLaunchOptions } from './sessionLaunchOptions'
import { QueryLifecycle } from './queryLifecycle'
import { CodexQueryLifecycle } from './codexQueryLifecycle'

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
  launchOptions: ClaudeSessionLaunchOptions | CodexSessionLaunchOptions
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
