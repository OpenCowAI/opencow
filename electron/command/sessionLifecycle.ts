// SPDX-License-Identifier: Apache-2.0

import type { UserMessageContent, AIEngineKind } from '../../src/shared/types'
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

export function createSessionLifecycle(_engineKind: AIEngineKind): SessionLifecycle {
  return new QueryLifecycle()
}
