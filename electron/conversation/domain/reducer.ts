// SPDX-License-Identifier: Apache-2.0

import type { ConversationDomainEventEnvelope } from './events'
import type { ConversationDomainEffect } from './effects'
import type { ConversationDomainState } from './state'
import { isTurnScopedRuntimeEventKind } from '../runtime/events'

export interface ConversationDomainDecision {
  readonly state: ConversationDomainState
  readonly effects: ConversationDomainEffect[]
}

function hasToolUseBlock(blocks: ReadonlyArray<{ type: string }>): boolean {
  return blocks.some((block) => block.type === 'tool_use')
}

function isTerminalErrorOutcome(outcome: string): boolean {
  return (
    outcome === 'execution_error' ||
    outcome === 'budget_exceeded' ||
    outcome === 'structured_output_error'
  )
}

function shouldRecoverStreamingFromAwaitingInput(kind: ConversationDomainEventEnvelope['event']['kind']): boolean {
  return (
    kind !== 'turn.result' &&
    kind !== 'engine.diagnostic' &&
    kind !== 'turn.usage' &&
    kind !== 'context.snapshot' &&
    kind !== 'execution_context.signal' &&
    kind !== 'system.task_notification'
  )
}

function requiresTurnRef(kind: ConversationDomainEventEnvelope['event']['kind']): boolean {
  return isTurnScopedRuntimeEventKind(kind)
}

export function reduceConversationDomainEvent(params: {
  state: ConversationDomainState
  eventEnvelope: ConversationDomainEventEnvelope
}): ConversationDomainDecision {
  const { state, eventEnvelope } = params
  const event = eventEnvelope.event
  const eventTurnSeq = eventEnvelope.turnRef?.turnSeq ?? null
  let allowLateUsageForClosedTurn = false

  const nextState: ConversationDomainState = { ...state }
  const effects: ConversationDomainEffect[] = [
    {
      type: 'cancel_awaiting_input_timer',
      payload: {},
    },
  ]

  if (event.kind === 'turn.started') {
    if (eventTurnSeq == null) {
      nextState.phase = 'error'
      effects.push({
        type: 'apply_protocol_violation',
        payload: {
          reason: 'turn.started missing turnRef.turnSeq',
        },
      })
      return { state: nextState, effects }
    }
    nextState.phase = 'streaming'
    nextState.turnClosed = false
    nextState.activeTurnSeq = eventTurnSeq
    nextState.closedTurnSeq = null
    return { state: nextState, effects }
  }

  if (event.kind === 'session.initialized') {
    nextState.phase = 'streaming'
    nextState.turnClosed = false
    effects.push({
      type: 'apply_session_initialized',
      payload: event.payload,
    })
    return { state: nextState, effects }
  }

  if (nextState.turnClosed) {
    const isLateUsageForClosedTurn =
      event.kind === 'turn.usage' &&
      eventTurnSeq != null &&
      nextState.closedTurnSeq != null &&
      eventTurnSeq === nextState.closedTurnSeq

    if (isLateUsageForClosedTurn) {
      // Allow idempotent late usage settlements for the just-closed turn.
      allowLateUsageForClosedTurn = true
    } else if (event.kind === 'context.snapshot') {
      effects.push({
        type: 'apply_context_snapshot',
        payload: event.payload,
      })
      return { state: nextState, effects }
    } else if (event.kind === 'engine.diagnostic') {
      effects.push({
        type: 'apply_engine_diagnostic',
        payload: event.payload,
      })
      return { state: nextState, effects }
    } else if (event.kind === 'system.task_notification') {
      // Background sub-agent tasks complete asynchronously — the SDK legitimately
      // sends task_notification after turn.result (two-phase completion).
      // Safe: effectProjector only calls addSystemEvent(), no state mutation.
      effects.push({
        type: 'apply_system_task_notification',
        payload: event.payload,
      })
      return { state: nextState, effects }
    } else {
      nextState.phase = 'error'
      effects.push({
        type: 'apply_protocol_violation',
        payload: {
          reason: `Event received after terminal result: ${event.kind}`,
        },
      })
      return { state: nextState, effects }
    }
  }

  if (requiresTurnRef(event.kind)) {
    if (eventTurnSeq == null) {
      nextState.phase = 'error'
      effects.push({
        type: 'apply_protocol_violation',
        payload: {
          reason: `${event.kind} missing turnRef.turnSeq`,
        },
      })
      return { state: nextState, effects }
    }

    if (allowLateUsageForClosedTurn) {
      // Keep closed state stable; usage is applied as a late settlement.
    } else if (nextState.activeTurnSeq == null) {
      // Claude runtime has no explicit turn.started event; open implicitly.
      nextState.activeTurnSeq = eventTurnSeq
    } else if (nextState.activeTurnSeq !== eventTurnSeq) {
      nextState.phase = 'error'
      effects.push({
        type: 'apply_protocol_violation',
        payload: {
          reason: `${event.kind} turnRef mismatch: active=${nextState.activeTurnSeq} incoming=${eventTurnSeq}`,
        },
      })
      return { state: nextState, effects }
    }
  }

  if (nextState.phase === 'awaiting_input' && shouldRecoverStreamingFromAwaitingInput(event.kind)) {
    effects.push({
      type: 'recover_streaming_from_awaiting_input',
      payload: {},
    })
    nextState.phase = 'streaming'
  }

  switch (event.kind) {
    case 'assistant.partial': {
      effects.push({
        type: 'apply_assistant_partial',
        payload: {
          blocks: event.payload.blocks,
        },
      })
      return { state: nextState, effects }
    }

    case 'assistant.final': {
      const hasToolUse = hasToolUseBlock(event.payload.blocks)
      nextState.phase = hasToolUse ? 'streaming' : 'awaiting_input'
      effects.push({
        type: 'apply_assistant_final',
        payload: {
          blocks: event.payload.blocks,
          hasToolUse,
        },
      })
      return { state: nextState, effects }
    }

    case 'user.tool_result': {
      // Tool result is an engine-driven user-role message. It does NOT
      // leave the streaming phase (assistant.final with hasToolUse already
      // kept us in `streaming`); it only feeds the persisted history so
      // per-turn resume can replay the model's view of the world.
      effects.push({
        type: 'apply_user_tool_result',
        payload: event.payload,
      })
      return { state: nextState, effects }
    }

    case 'turn.usage': {
      effects.push({
        type: 'apply_turn_usage',
        payload: event.payload,
      })
      return { state: nextState, effects }
    }

    case 'context.snapshot': {
      effects.push({
        type: 'apply_context_snapshot',
        payload: event.payload,
      })
      return { state: nextState, effects }
    }

    case 'execution_context.signal': {
      effects.push({
        type: 'apply_execution_context_signal',
        payload: {
          ...event.payload,
          occurredAtMs: eventEnvelope.occurredAtMs,
        },
      })
      return { state: nextState, effects }
    }

    case 'tool.progress': {
      effects.push({
        type: 'apply_tool_progress',
        payload: event.payload,
      })
      return { state: nextState, effects }
    }

    case 'engine.diagnostic': {
      effects.push({
        type: 'apply_engine_diagnostic',
        payload: event.payload,
      })
      return { state: nextState, effects }
    }

    case 'turn.result': {
      nextState.phase = isTerminalErrorOutcome(event.payload.outcome) ? 'error' : 'idle'
      nextState.turnClosed = true
      nextState.closedTurnSeq = eventTurnSeq
      nextState.activeTurnSeq = null
      effects.push({
        type: 'apply_turn_result',
        payload: event.payload,
      })
      return { state: nextState, effects }
    }

    case 'system.compact_boundary': {
      // Compact is an engine-internal operation — keep phase unchanged
      // (streaming stays streaming). Previously manual compact set
      // phase = 'awaiting_input' which caused UI flicker: the input bar
      // briefly enabled then re-disabled when the next SDK event
      // recovered to streaming via recover_streaming_from_awaiting_input.
      effects.push({
        type: 'apply_system_compact_boundary',
        payload: event.payload,
      })
      return { state: nextState, effects }
    }

    case 'system.task_started': {
      effects.push({
        type: 'apply_system_task_started',
        payload: event.payload,
      })
      return { state: nextState, effects }
    }

    case 'system.task_notification': {
      effects.push({
        type: 'apply_system_task_notification',
        payload: event.payload,
      })
      return { state: nextState, effects }
    }

    case 'system.hook_started': {
      effects.push({
        type: 'apply_system_hook_started',
        payload: event.payload,
      })
      return { state: nextState, effects }
    }

    case 'system.hook_progress': {
      effects.push({
        type: 'apply_system_hook_progress',
        payload: event.payload,
      })
      return { state: nextState, effects }
    }

    case 'system.hook_response': {
      effects.push({
        type: 'apply_system_hook_response',
        payload: event.payload,
      })
      return { state: nextState, effects }
    }

    case 'protocol.violation': {
      nextState.phase = 'error'
      nextState.turnClosed = true
      nextState.activeTurnSeq = null
      effects.push({
        type: 'apply_protocol_violation',
        payload: event.payload,
      })
      return { state: nextState, effects }
    }
  }
}
