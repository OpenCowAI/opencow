// SPDX-License-Identifier: Apache-2.0

/**
 * InteractionNativeCapability — MCP tools that pause execution for user input.
 *
 * Provides the `ask_user_question` tool as a replacement for the SDK's built-in
 * AskUserQuestion. The key difference: this tool's handler returns a Promise that
 * blocks until the user answers, giving us full control over the Q&A lifecycle.
 *
 * Architecture:
 *   1. Claude calls `ask_user_question` → SDK routes to our MCP handler
 *   2. Handler dispatches DataBus event → UI renders interactive card
 *   3. Handler awaits `registry.waitFor(requestId)` → SDK pauses
 *   4. User answers (card or input) → `registry.resolve()` → handler resumes
 *   5. Handler returns `{ content: [{ type: 'text', text: answer }] }` → SDK continues
 *
 * The tool name uses snake_case (`ask_user_question`) to follow MCP conventions
 * and avoid collision with the disabled `AskUserQuestion` (PascalCase).
 */

import { z } from 'zod/v4'
import { randomUUID } from 'node:crypto'
import type { NativeCapabilityMeta, NativeCapabilityToolContext, CallToolResult } from '../types'
import { BaseNativeCapability, type ToolConfig } from '../baseNativeCapability'
import type { PendingQuestionRegistry } from './pendingQuestionRegistry'
import type { DataBusEvent } from '../../../src/shared/types'
import { isIMPlatformSource } from '../../../src/shared/types'
import { createLogger } from '../../platform/logger'

const log = createLogger('InteractionNativeCapability')

type Dispatch = (event: DataBusEvent) => void

/** Constructor dependencies injected from main.ts */
export interface InteractionNativeCapabilityDeps {
  readonly registry: PendingQuestionRegistry
  readonly dispatch: Dispatch
  readonly enterQuestionState: (sessionId: string) => boolean
  readonly exitQuestionState: (sessionId: string) => void
}

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const questionOptionSchema = z.object({
  label: z.string().describe('Display text for this option (1-5 words)'),
  description: z.string().optional().describe('Explanation of what this option means'),
})

const questionSchema = z.object({
  question: z.string().describe('The question to ask the user'),
  header: z.string().optional().describe('Short label (max 12 chars), e.g. "Auth method"'),
  options: z.array(questionOptionSchema)
    .min(2).max(4).optional()
    .describe('Available choices (2-4 options)'),
  multiSelect: z.boolean().optional()
    .describe('Allow multiple selections. Default: false'),
})

// ── NativeCapability ─────────────────────────────────────────────────────────

export class InteractionNativeCapability extends BaseNativeCapability {
  readonly meta: NativeCapabilityMeta = {
    category: 'interaction',
    description: 'Interactive tools that pause execution and wait for user input',
  }

  private readonly deps: InteractionNativeCapabilityDeps

  constructor(deps: InteractionNativeCapabilityDeps) {
    super()
    this.deps = deps
  }

  protected override nativeToolConfigs(ctx: NativeCapabilityToolContext): ToolConfig[] {
    const { sessionId, originSource } = ctx.sessionContext

    // IM clients (Telegram, Discord, Feishu, WeChat) cannot render interactive
    // cards — suppress all interaction tools so they never appear in Claude's
    // tool list. This follows the same pattern as BrowserNativeCapability
    // suppressing overlapping tools when Chrome DevTools MCP is active.
    if (isIMPlatformSource(originSource)) {
      log.info(`IM origin (${originSource}) — suppressing interaction tools for session ${sessionId}`)
      return []
    }

    const { registry, dispatch, enterQuestionState, exitQuestionState } = this.deps

    return [
      {
        name: 'ask_user_question',
        description:
          'Ask the user questions with selectable options and wait for their response. '
          + 'Shows an interactive card in the UI. Use when you need user input to make decisions. '
          + 'The tool blocks until the user responds.',
        schema: {
          questions: z.array(questionSchema)
            .min(1).max(4)
            .describe('Questions to ask (1-4 questions)'),
        },
        execute: async (args): Promise<CallToolResult> => {
          const requestId = randomUUID()
          const questions = args.questions

          log.info(`ask_user_question called for session ${sessionId}, requestId=${requestId}`)

          // 1. Notify UI to render the interactive card + switch session state
          dispatch({
            type: 'command:session:ask-question',
            payload: { sessionId, requestId, questions },
          } as DataBusEvent)

          // 2. Switch session state to awaiting_question
          //    This enables the input bar and card Confirm button in the UI.
          //    Returns false if the session is not in 'streaming' state (e.g. already
          //    idle/error/stopped) — in that case we must NOT call registry.waitFor()
          //    because no UI card will be rendered and the Promise would hang forever.
          const entered = enterQuestionState(sessionId)
          if (!entered) {
            log.warn(`ask_user_question: failed to enter question state for session ${sessionId} — returning error to SDK`)
            return {
              content: [{ type: 'text' as const, text: 'Session is not in a state that accepts questions. The session may have ended or encountered an error.' }],
              isError: true,
            }
          }

          // 3. Block until user answers — this is the core mechanism!
          //    The Promise doesn't resolve until registry.resolve() or registry.cancelAll() is called.
          const response = await registry.waitFor(requestId, sessionId)

          // 4. Restore streaming state (handler is returning, SDK will continue)
          exitQuestionState(sessionId)

          // 5. Cancelled → return error so Claude knows the user didn't answer
          if (response.cancelled) {
            log.info(`Question ${requestId} was cancelled`)
            return {
              content: [{ type: 'text' as const, text: 'User did not respond (session ended or timed out).' }],
              isError: true,
            }
          }

          // 6. Success → return the user's answer as a normal tool result
          log.info(`Question ${requestId} answered: "${response.answer.substring(0, 100)}..."`)
          return {
            content: [{ type: 'text' as const, text: response.answer }],
          }
        },
      },
    ]
  }
}
