// SPDX-License-Identifier: Apache-2.0

import type {
  ThreadEvent,
  ThreadItem,
  Usage,
} from '@openai/codex-sdk'
import { normalizeContentBlocks } from '../../command/contentBlocks'
import { CodexTurnProjector, type CodexThreadItemStage } from './codex/codexTurnProjector'
import { classifyCodexErrorMessage } from './codex/codexEventFilters'
import type { ConversationContentBlock } from '../domain/content'
import type { EngineRuntimeEvent, RuntimeModelUsage, RuntimeTurnUsage } from './events'
import { toConversationContentBlocks } from './contentBlockMapper'

interface CodexRuntimeAdaptResult {
  readonly events: EngineRuntimeEvent[]
  readonly hasTerminalResult: boolean
}

function toModelUsage(usage: Usage): Record<string, RuntimeModelUsage> {
  return {
    codex: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    },
  }
}

function toTurnUsage(usage: Usage): RuntimeTurnUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cached_input_tokens,
    cacheCreationInputTokens: 0,
  }
}

export class CodexRuntimeEventAdapter {
  private readonly projector = new CodexTurnProjector()
  private latestAssistantText: string | null = null
  private emittedResult = false
  private emittedFinalAssistant = false

  adapt(event: ThreadEvent): CodexRuntimeAdaptResult {
    if (this.emittedResult) {
      return { events: [], hasTerminalResult: true }
    }

    switch (event.type) {
      case 'thread.started':
        return {
          events: [
            {
              kind: 'session.initialized',
              payload: { sessionRef: event.thread_id },
            },
          ],
          hasTerminalResult: false,
        }

      case 'turn.started':
        return {
          events: [
            {
              kind: 'turn.started',
              payload: {},
            },
          ],
          hasTerminalResult: false,
        }

      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        return this.adaptItemEvent(event.item, event.type === 'item.started' ? 'started' : event.type === 'item.updated' ? 'updated' : 'completed')

      case 'turn.completed': {
        const events: EngineRuntimeEvent[] = []
        events.push(...this.buildFinalAssistantEvent())
        events.push({
          kind: 'turn.usage',
          payload: toTurnUsage(event.usage),
        })
        // Context window tracking — Codex: inputTokens = context window occupancy.
        // This estimated snapshot serves as a fallback when the authoritative
        // token_count event from codexQueryLifecycle arrives late.
        // Authoritative snapshots suppress estimated ones in ManagedSession.
        if (event.usage.input_tokens > 0) {
          events.push({
            kind: 'context.snapshot',
            payload: {
              usedTokens: event.usage.input_tokens,
              limitTokens: null,
              remainingTokens: null,
              remainingPct: null,
              source: 'codex.turn_usage',
              confidence: 'estimated',
            },
          })
        }
        if (!this.emittedResult) {
          events.push({
            kind: 'turn.result',
            payload: {
              outcome: 'success',
              modelUsage: toModelUsage(event.usage),
            },
          })
          this.emittedResult = true
        }
        return { events, hasTerminalResult: this.emittedResult }
      }

      case 'turn.failed': {
        const events: EngineRuntimeEvent[] = []
        events.push(...this.buildFinalAssistantEvent())
        if (!this.emittedResult) {
          events.push({
            kind: 'turn.result',
            payload: {
              outcome: 'execution_error',
              errors: [event.error.message],
            },
          })
          this.emittedResult = true
        }
        return { events, hasTerminalResult: true }
      }

      case 'error': {
        const diagnostic = classifyCodexErrorMessage(event.message)
        if (diagnostic && !diagnostic.terminal) {
          return {
            events: [
              {
                kind: 'engine.diagnostic',
                payload: diagnostic,
              },
            ],
            hasTerminalResult: this.emittedResult,
          }
        }

        const events: EngineRuntimeEvent[] = []
        events.push(...this.buildFinalAssistantEvent())
        if (!this.emittedResult) {
          events.push({
            kind: 'turn.result',
            payload: {
              outcome: 'execution_error',
              errors: [event.message],
            },
          })
          this.emittedResult = true
        }
        return { events, hasTerminalResult: true }
      }
    }
  }

  emitUnexpectedTurnEnd(message: string): EngineRuntimeEvent[] {
    if (this.emittedResult) return []
    this.emittedResult = true
    return [
      ...this.buildFinalAssistantEvent(),
      {
        kind: 'turn.result',
        payload: {
          outcome: 'execution_error',
          errors: [message],
        },
      },
    ]
  }

  didEmitResult(): boolean {
    return this.emittedResult
  }

  private adaptItemEvent(item: ThreadItem, stage: CodexThreadItemStage): CodexRuntimeAdaptResult {
    if (item.type === 'agent_message') {
      this.latestAssistantText = item.text
    }

    const projection = this.projector.upsert(item, stage)
    const isHighFrequencyCommandUpdate =
      item.type === 'command_execution' && (stage === 'started' || stage === 'updated')

    const events: EngineRuntimeEvent[] = []

    if (!isHighFrequencyCommandUpdate && projection.changed && projection.blocks.length > 0) {
      events.push({
        kind: 'assistant.partial',
        payload: {
          blocks: this.toConversationBlocks(projection.blocks),
        },
      })
    }

    if (stage === 'completed' && item.type === 'error') {
      const errorMessage = item.message ?? 'Codex item error'
      const diagnostic = classifyCodexErrorMessage(errorMessage)
      if (diagnostic && !diagnostic.terminal) {
        events.push({
          kind: 'engine.diagnostic',
          payload: diagnostic,
        })
      } else if (!this.emittedResult) {
        events.push({
          kind: 'turn.result',
          payload: {
            outcome: 'execution_error',
            errors: [errorMessage],
          },
        })
        this.emittedResult = true
      }
    }

    return {
      events,
      hasTerminalResult: this.emittedResult,
    }
  }

  private buildFinalAssistantEvent(): EngineRuntimeEvent[] {
    if (this.emittedFinalAssistant) return []
    this.emittedFinalAssistant = true

    const blocks = this.toConversationBlocks(this.projector.snapshot())
    if (blocks.length > 0) {
      return [{ kind: 'assistant.final', payload: { blocks } }]
    }

    if (this.latestAssistantText) {
      const fallback: ConversationContentBlock = { type: 'text', text: this.latestAssistantText }
      return [{ kind: 'assistant.final', payload: { blocks: [fallback] } }]
    }

    return []
  }

  private toConversationBlocks(sdkBlocks: ReturnType<CodexTurnProjector['snapshot']>): ConversationContentBlock[] {
    return toConversationContentBlocks(normalizeContentBlocks(sdkBlocks))
  }
}
