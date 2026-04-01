// SPDX-License-Identifier: Apache-2.0

import type { SessionStopReason } from '../../../src/shared/types'
import type { SessionContext } from '../../command/sessionContext'
import type { SessionLifecycleEvent } from '../../command/sessionStateMachine'
import { createLogger } from '../../platform/logger'
import { dispatchSessionTerminal } from '../../command/sessionTerminalDispatcher'

const log = createLogger('SessionTerminalization')

type TerminalTransition = Extract<
  SessionLifecycleEvent,
  { type: 'turn_completed' | 'turn_error' | 'protocol_violation' }
>

export interface TerminalizationInput {
  readonly reason: 'turn_result' | 'protocol_violation' | 'runtime_error' | 'user_stopped' | 'safety_net'
  readonly transition: TerminalTransition
  readonly terminalEvent: 'idle' | 'error' | 'stopped'
  readonly stopReason?: SessionStopReason
  readonly resultText?: string
  readonly errorMessage?: string
  readonly shouldPersist: boolean
  readonly shouldNotifyResultReceived: boolean
  readonly flushPendingDispatches?: boolean
  readonly clearRelay?: boolean
  readonly clearAssistantActiveToolUseIds?: boolean
}

export interface TerminalizationResult {
  readonly streamMessageId: string | null
}

function clearAssistantActiveToolUseIds(ctx: SessionContext): string[] {
  const touchedIds: string[] = []
  for (const message of ctx.session.getMessages()) {
    if (message.role !== 'assistant') continue
    if (message.activeToolUseId == null) continue
    ctx.session.setActiveToolUseId(message.id, null)
    touchedIds.push(message.id)
  }
  return touchedIds
}

function finalizeStreamingSnapshot(ctx: SessionContext): string | null {
  // Finalize buffer before stream — ensures no stale buffered writes survive terminalization.
  ctx.buffer.finalize()
  const streamId = ctx.stream.finalizeStreaming()
  if (!streamId) return null
  ctx.session.finalizeStreamingMessage(streamId)
  // Always dispatch finalized assistant snapshot (isStreaming=false) before terminal event.
  ctx.dispatchMessageById(streamId)
  return streamId
}

export function terminalizeSession(params: {
  ctx: SessionContext
  input: TerminalizationInput
}): TerminalizationResult {
  const { ctx, input } = params

  if (input.flushPendingDispatches !== false) {
    // Drain throttled message/session dispatches first so terminal snapshot wins.
    ctx.throttle.flushNow()
  }

  const streamMessageId = finalizeStreamingSnapshot(ctx)

  const clearedToolUseMessageIds =
    input.clearAssistantActiveToolUseIds !== false
      ? clearAssistantActiveToolUseIds(ctx)
      : []

  // Terminal message synchronization:
  // activeToolUseId cleanup may touch multiple assistant messages, but only the
  // streaming message is dispatched by finalizeStreamingSnapshot(). Ensure every
  // additionally touched message is sent before terminal events so renderer state
  // cannot retain stale tool-executing indicators.
  for (const messageId of clearedToolUseMessageIds) {
    if (messageId === streamMessageId) continue
    ctx.dispatchMessageById(messageId)
  }

  if (input.clearRelay !== false) {
    ctx.relay.clear()
  }

  ctx.session.transition(input.transition)

  dispatchSessionTerminal({
    sessionId: ctx.sessionId,
    session: ctx.session,
    dispatch: ctx.dispatch,
    terminalEvent: input.terminalEvent,
    stopReason: input.stopReason,
    result: input.resultText,
    error: input.errorMessage,
  })

  if (input.shouldNotifyResultReceived) {
    ctx.onResultReceived()
  }

  if (input.shouldPersist) {
    ctx.persistSession().catch((err) => {
      log.error(
        `Failed to persist terminalized session ${ctx.sessionId} (reason=${input.reason})`,
        err,
      )
    })
  }

  return { streamMessageId }
}
