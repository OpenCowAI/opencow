// SPDX-License-Identifier: Apache-2.0

import type { UserMessageContent, AIEngineKind } from '../../src/shared/types'
import type { EngineRuntimeEventEnvelope } from '../conversation/runtime/events'
import { QueryLifecycle } from './queryLifecycle'
import { CodexQueryLifecycle } from './codexQueryLifecycle'

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
  start(
    initialPrompt: UserMessageContent,
    options: Record<string, unknown>
  ): AsyncIterable<EngineRuntimeEventEnvelope>
  pushMessage(content: UserMessageContent): void
  stop(): Promise<void>
}

export function createSessionLifecycle(engineKind: AIEngineKind): SessionLifecycle {
  return engineKind === 'codex' ? new CodexQueryLifecycle() : new QueryLifecycle()
}
