// SPDX-License-Identifier: Apache-2.0

import type { SessionStopReason, ContentBlock } from '../../../src/shared/types'
import { createLogger } from '../../platform/logger'
import type { SessionContext } from '../../command/sessionContext'
import type { ConversationDomainEffect } from '../domain/effects'
import { toManagedContentBlocks } from './contentBlockMapper'
import { resolveContextLimitOverride } from './contextUsage'
import { registerEvoseRelayForProjection } from './evoseRelay'
import { terminalizeSession } from './terminalization'

const log = createLogger('ConversationEffectProjector')

export interface ProjectionApplyResult {
  readonly shouldAbortLifecycle: boolean
}

function deriveActivity(blocks: ContentBlock[]): string | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (block.type === 'thinking') return 'thinking'
    if (block.type === 'tool_use') return block.name
  }
  return null
}

function resultOutcomeToStopReason(outcome: string): SessionStopReason {
  switch (outcome) {
    case 'success':
      return 'completed'
    case 'max_turns':
      return 'max_turns'
    case 'execution_error':
      return 'execution_error'
    case 'budget_exceeded':
      return 'budget_exceeded'
    case 'structured_output_error':
      return 'structured_output_error'
    default:
      return 'execution_error'
  }
}

function resultOutcomeToErrorMessage(outcome: string, errors: string[] | undefined): string {
  switch (outcome) {
    case 'execution_error':
      return errors?.join('; ') || 'Execution error'
    case 'budget_exceeded':
      return 'Budget limit exceeded'
    case 'structured_output_error':
      return 'Structured output validation failed'
    default:
      return errors?.join('; ') || 'Session failed'
  }
}

function logEngineDiagnostic(params: {
  sessionId: string
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  terminal: boolean
  source?: string
}): void {
  const line = `[engine_diagnostic] session=${params.sessionId} severity=${params.severity} code=${params.code} terminal=${params.terminal} source=${params.source ?? 'unknown'} message=${params.message}`
  if (params.severity === 'error') {
    log.error(line)
    return
  }
  if (params.severity === 'warning') {
    log.warn(line)
    return
  }
  log.info(line)
}

function applyTurnResultEffect(effect: Extract<ConversationDomainEffect, { type: 'apply_turn_result' }>, ctx: SessionContext): void {
  const { session } = ctx

  if (effect.payload.costUsd != null) {
    session.setCostUsd(effect.payload.costUsd)
  }

  if (effect.payload.modelUsage) {
    let totalInput = 0
    let totalOutput = 0
    for (const usage of Object.values(effect.payload.modelUsage)) {
      totalInput += usage.inputTokens
      totalOutput += usage.outputTokens
    }
    session.setFinalTokenUsage(totalInput, totalOutput)

    const contextLimitOverride = resolveContextLimitOverride({
      modelUsage: effect.payload.modelUsage,
      sessionModel: session.getModel(),
    })
    if (contextLimitOverride != null) {
      session.setContextLimitFromModelUsage(contextLimitOverride)
    }

    // Diagnostic: warn when turn.result provides modelUsage but no per-turn
    // context data was ever recorded (turn.usage was never received).
    // This helps identify SDK format changes that break the context tracking pipeline.
    // NOTE: We intentionally do NOT fall back to aggregate modelUsage.inputTokens
    // as context window usage — it is the cumulative sum across all turns and does
    // not include cache tokens, making it semantically incorrect for context display.
    if (session.getContextUsedTokens() <= 0 && totalInput > 0) {
      log.warn(
        `Session ${ctx.sessionId}: turn.result has modelUsage (totalInput=${totalInput}) ` +
        `but no per-turn context data was recorded. Context ring will not display. ` +
        `This may indicate the engine SDK no longer reports usage in assistant messages.`
      )
    }
  }

  const stopReason = resultOutcomeToStopReason(effect.payload.outcome)

  if (stopReason === 'completed' || stopReason === 'max_turns') {
    terminalizeSession({
      ctx,
      input: {
        reason: 'turn_result',
        transition: { type: 'turn_completed', stopReason },
        terminalEvent: 'idle',
        stopReason,
        resultText: effect.payload.result,
        shouldPersist: true,
        shouldNotifyResultReceived: true,
        flushPendingDispatches: false,
      },
    })
  } else {
    const message = resultOutcomeToErrorMessage(effect.payload.outcome, effect.payload.errors)
    terminalizeSession({
      ctx,
      input: {
        reason: 'turn_result',
        transition: { type: 'turn_error', message },
        terminalEvent: 'error',
        errorMessage: message,
        shouldPersist: true,
        shouldNotifyResultReceived: true,
        flushPendingDispatches: false,
      },
    })
  }
}

export function applyConversationDomainEffects(params: {
  effects: ConversationDomainEffect[]
  ctx: SessionContext
}): ProjectionApplyResult {
  const { effects, ctx } = params
  let shouldAbortLifecycle = false

  for (const effect of effects) {
    switch (effect.type) {
      case 'cancel_awaiting_input_timer': {
        ctx.timers.cancel('awaiting_input')
        break
      }

      case 'recover_streaming_from_awaiting_input': {
        if (ctx.session.getState() === 'awaiting_input') {
          ctx.session.transition({ type: 'recover_from_awaiting_input' })
        }
        break
      }

      case 'apply_session_initialized': {
        if (effect.payload.sessionRef) {
          ctx.session.setEngineSessionRef(effect.payload.sessionRef)
        }
        if (effect.payload.model) {
          ctx.session.setModel(effect.payload.model)
        }
        ctx.session.transition({ type: 'engine_initialized' })
        ctx.onStreamStarted()
        ctx.dispatchSessionUpdated()
        break
      }

      case 'apply_assistant_partial': {
        const blocks = toManagedContentBlocks(effect.payload.blocks)
        if (blocks.length === 0) break

        let streamingMessageId: string | null
        if (!ctx.stream.isStreaming) {
          // First partial: create the message in ManagedSession, then
          // grab a direct reference for the buffer — O(1) from here on.
          const messageId = ctx.session.addMessage('assistant', blocks, true)
          streamingMessageId = messageId
          ctx.stream.beginStreaming(messageId)
          const ref = ctx.session.getLastMessageRef()
          if (ref) ctx.buffer.begin(ref)
        } else {
          streamingMessageId = ctx.stream.streamingMessageId
          // Subsequent partials: O(1) direct mutation via buffer.
          // Replaces the O(M) session.updateMessageBlocks() find().
          ctx.buffer.updateBlocks(blocks)
        }

        // Find last tool_use — reverse for-loop avoids temporary array allocation
        // that [...blocks].reverse().find() would create.
        let lastToolUseId: string | null = null
        for (let i = blocks.length - 1; i >= 0; i--) {
          const block = blocks[i]
          if (block.type === 'tool_use') {
            lastToolUseId = block.id
            break
          }
        }
        if (lastToolUseId) {
          ctx.buffer.setActiveToolUseId(lastToolUseId)  // O(1) vs O(M)
        }

        const activity = deriveActivity(blocks)
        if (activity !== null) {
          ctx.session.setActivity(activity)
        }

        // Codex emits MCP tool_call items as partial updates while the tool is
        // running. Register Evose relay at partial time so SSE chunks can be
        // consumed immediately, instead of waiting for assistant.final (which
        // may arrive only after tool completion).
        if (streamingMessageId) {
          registerEvoseRelayForProjection(blocks, streamingMessageId, ctx)
        }

        // IPC dispatch: throttled — assistant streaming tokens arrive at high frequency,
        // coalescing to ~20 fps prevents renderer saturation.
        // Uses the same DispatchThrottle as tool.progress and hook_progress,
        // with trailing-edge flush guaranteeing the last partial is always delivered.
        ctx.throttle.scheduleMessage()
        break
      }

      case 'apply_assistant_final': {
        // Flush pending throttled dispatches before finalizing the message.
        // Ensures the last tool.progress snapshot reaches the renderer before
        // the final message replaces streaming content.
        ctx.throttle.flushNow()

        // Finalize buffer before stream — buffer.getSnapshot() was used by
        // the flushNow() above for the last IPC dispatch.
        ctx.buffer.finalize()

        const finalBlocks = toManagedContentBlocks(effect.payload.blocks)
        const streamId = ctx.stream.finalizeStreaming()

        let targetMessageId: string | null = null // eslint-disable-line no-useless-assignment
        if (streamId) {
          ctx.session.finalizeStreamingMessage(streamId)
          if (finalBlocks.length > 0) {
            ctx.session.updateMessageBlocks(streamId, finalBlocks, false)
          }
          targetMessageId = streamId
        } else {
          targetMessageId = ctx.session.addMessage('assistant', finalBlocks, false)
        }

        if (!targetMessageId) break

        registerEvoseRelayForProjection(finalBlocks, targetMessageId, ctx)

        if (!effect.payload.hasToolUse) {
          ctx.session.transition({ type: 'awaiting_input' })
          ctx.timers.set('awaiting_input', () => {
            if (ctx.session.getState() === 'awaiting_input') {
              ctx.dispatchSessionUpdated()
            }
          }, 500)
          // No tool execution follows — dispatch immediately so the renderer
          // sees the finalized response without throttle delay.
          ctx.dispatchMessageById(targetMessageId)
        } else {
          ctx.dispatchSessionUpdated()
          // Tool execution follows shortly (<5 ms for fast tools like Read/Glob).
          // Queue the finalized message instead of dispatching immediately so it
          // coalesces with the upcoming next-turn assistant.partial in the same
          // DispatchThrottle window (~50 ms).  The renderer's write-coalescing
          // buffer (33 ms) then processes both in a single batchAppendSessionMessages
          // call → ONE slow-path cascade instead of two.
          //
          // Visual correctness: AssistantMessage self-subscribes to the streaming
          // overlay which already contains the complete content, so the 50 ms
          // dispatch delay is invisible to users.
          ctx.queueMessageDispatch(targetMessageId)
        }
        break
      }

      case 'apply_turn_usage': {
        // Pure token accounting — context window tracking is handled separately
        // by context.snapshot events emitted from engine adapters.
        ctx.session.recordTurnUsage(effect.payload.inputTokens, effect.payload.outputTokens)
        ctx.throttle.scheduleSession()     // throttled: coalesce O(n) getInfo()
        break
      }

      case 'apply_context_snapshot': {
        const changed = ctx.session.applyContextSnapshot({
          usedTokens: effect.payload.usedTokens,
          limitTokens: effect.payload.limitTokens,
          source: effect.payload.source,
          confidence: effect.payload.confidence,
          updatedAtMs: effect.payload.updatedAtMs ?? Date.now(),
        })
        if (changed) {
          ctx.throttle.scheduleSession()   // throttled: coalesce O(n) getInfo()
        }
        break
      }

      case 'apply_tool_progress': {
        if (!ctx.buffer.isActive) break
        // State mutation via buffer: O(1) amortized (cached tool block reference)
        // vs the old O(M) + O(N) path through session.appendToolProgress().
        ctx.buffer.appendToolProgress(effect.payload.toolUseId, effect.payload.chunk)
        ctx.buffer.setActiveToolUseId(effect.payload.toolUseId)
        // IPC dispatch: progress-specific throttle (200 ms ≈ 5 fps).
        // Tool output is a scrollable log — 5 fps visual updates are smooth
        // while reducing IPC round-trips by 75% vs the 50 ms message channel.
        // If text streaming is active, progress piggybacks on the 50 ms flush.
        ctx.throttle.scheduleProgress()
        break
      }

      case 'apply_engine_diagnostic': {
        logEngineDiagnostic({
          sessionId: ctx.sessionId,
          severity: effect.payload.severity,
          code: effect.payload.code,
          message: effect.payload.message,
          terminal: effect.payload.terminal,
          source: effect.payload.source,
        })
        break
      }

      case 'apply_turn_result': {
        // Flush any pending throttled dispatches before terminal processing.
        // Ensures the renderer receives the last tool.progress / session state
        // before the turn result finalizes the session.
        ctx.throttle.flushNow()
        applyTurnResultEffect(effect, ctx)
        break
      }

      case 'apply_system_compact_boundary': {
        const compactMsgId = ctx.session.addSystemEvent({
          type: 'compact_boundary',
          trigger: effect.payload.trigger,
          preTokens: effect.payload.preTokens,
          phase: 'compacting',
        })

        // Compact drastically reduces context window usage — clear stale state.
        // The next assistant message's context.snapshot will restore accurate tracking.
        ctx.session.clearContextState()

        ctx.session.setActivity('Optimizing memory\u2026')

        // No state transition — compact is engine-internal, the session
        // remains streaming so the UI stays stable (no input-bar flicker).

        // Queued: see apply_system_task_started rationale.
        ctx.queueMessageDispatch(compactMsgId)
        ctx.throttle.scheduleSession()

        ctx.timers.set('compact_boundary', () => {
          if (!ctx.isSessionAlive()) return

          ctx.session.updateSystemEventById(compactMsgId, (event) => {
            if (event.type === 'compact_boundary') {
              event.phase = 'done'
            }
          })
          ctx.session.setActivity(null)
          // Timer callback fires ~1.5s later — no throttle benefit,
          // dispatch immediately for prompt UI update.
          ctx.dispatchMessageById(compactMsgId)
          ctx.dispatchSessionUpdated()
        }, 1500)
        break
      }

      case 'apply_system_task_started': {
        const msgId = ctx.session.addSystemEvent({
          type: 'task_started',
          taskId: effect.payload.taskId,
          toolUseId: effect.payload.toolUseId,
          description: effect.payload.description,
          taskType: effect.payload.taskType,
        })
        ctx.session.setActivity(`Task: ${effect.payload.description.slice(0, 40)}`)
        // Queued: system events are not user-visible instant feedback.
        // queueMessageDispatch() defers dispatch to the next throttle
        // window, where all queued system events + the streaming message
        // are dispatched in a single burst.  The renderer's write-coalescing
        // buffer batches them into ONE batchAppendSessionMessages call —
        // triggering ONE slow-path merge instead of 3-5.
        // Terminal events (apply_assistant_final, apply_turn_result) call
        // flushNow() which drains this queue before the terminal dispatch.
        ctx.queueMessageDispatch(msgId)
        ctx.throttle.scheduleSession()
        break
      }

      case 'apply_system_task_notification': {
        const msgId = ctx.session.addSystemEvent({
          type: 'task_notification',
          taskId: effect.payload.taskId,
          toolUseId: effect.payload.toolUseId,
          status: effect.payload.status,
          summary: effect.payload.summary,
          outputFile: effect.payload.outputFile,
          usage: effect.payload.usage
            ? {
                totalTokens: effect.payload.usage.totalTokens,
                toolUses: effect.payload.usage.toolUses,
                durationMs: effect.payload.usage.durationMs,
              }
            : undefined,
        })
        ctx.session.setActivity(null)
        // Queued: see apply_system_task_started rationale.
        ctx.queueMessageDispatch(msgId)
        ctx.throttle.scheduleSession()
        break
      }

      case 'apply_system_hook_started': {
        const msgId = ctx.session.addSystemEvent({
          type: 'hook',
          hookId: effect.payload.hookId,
          hookName: effect.payload.hookName,
          hookTrigger: effect.payload.hookTrigger,
        })
        ctx.session.setActivity(`Hook: ${effect.payload.hookName}`)
        // Queued: see apply_system_task_started rationale.
        ctx.queueMessageDispatch(msgId)
        ctx.throttle.scheduleSession()
        break
      }

      case 'apply_system_hook_progress': {
        ctx.session.updateSystemEvent(`hook:${effect.payload.hookId}`, (event) => {
          if (event.type === 'hook') {
            event.output = effect.payload.output
          }
        })
        // Throttled: hook output can produce rapid lines, same as tool.progress.
        // Updates an existing hook message in-place — safe to coalesce.
        ctx.throttle.scheduleMessage()
        break
      }

      case 'apply_system_hook_response': {
        ctx.session.updateSystemEvent(`hook:${effect.payload.hookId}`, (event) => {
          if (event.type === 'hook') {
            event.outcome = effect.payload.outcome
            event.exitCode = effect.payload.exitCode
            event.output = effect.payload.output
          }
        })
        ctx.session.setActivity(null)
        // Queued: final hook state dispatched with next throttle flush.
        // flushNow() from terminal events ensures this reaches the renderer
        // before the session finalizes.
        const hookMsgId = ctx.session.getSystemEventMessageId(`hook:${effect.payload.hookId}`)
        if (hookMsgId) ctx.queueMessageDispatch(hookMsgId)
        ctx.throttle.scheduleSession()
        break
      }

      case 'apply_protocol_violation': {
        // Flush pending throttled dispatches before error handling.
        ctx.throttle.flushNow()

        const reason =
          effect.payload.rawType && effect.payload.rawSubtype != null
            ? `${effect.payload.reason} (${effect.payload.rawType}:${effect.payload.rawSubtype})`
            : effect.payload.reason

        terminalizeSession({
          ctx,
          input: {
            reason: 'protocol_violation',
            transition: {
              type: 'protocol_violation',
              message: `Engine protocol violation: ${reason}`,
            },
            terminalEvent: 'error',
            errorMessage: `Engine protocol violation: ${reason}`,
            shouldPersist: true,
            shouldNotifyResultReceived: false,
            flushPendingDispatches: false,
          },
        })

        shouldAbortLifecycle = true
        break
      }
    }
  }

  return { shouldAbortLifecycle }
}
