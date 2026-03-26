// SPDX-License-Identifier: Apache-2.0

/**
 * useBotCreatorSession — Session hook for the AI Bot Creator.
 *
 * Thin wrapper around the generic `useCreatorSession` hook, parameterized
 * with bot-specific identity, prompt building, and output extraction.
 *
 * @module
 */

import { useMemo } from 'react'
import { useCreatorSession, type CreatorSessionConfig } from '@/hooks/useCreatorSession'
import type { UseMessageQueueReturn } from '@/hooks/useMessageQueue'
import type {
  SessionSnapshot,
  ManagedSessionState,
  SessionOrigin,
  UserMessageContent
} from '@shared/types'
import {
  extractLatestBotOutput,
  type ParsedBotOutput
} from '@shared/botOutputParser'
import { BOT_CREATOR_PROMPT_TEMPLATE } from '@shared/botCreatorSystemPrompt'
import { resolveLanguageDirective } from '@shared/creatorLanguage'

// ═══════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════

export interface BotCreatorSessionConfig {
  /** Current project ID — injected into system prompt for context awareness. */
  projectId?: string | null
}

// ═══════════════════════════════════════════════════════════════════
// Handle
// ═══════════════════════════════════════════════════════════════════

export interface BotCreatorSessionHandle {
  session: SessionSnapshot | null
  isStarting: boolean
  isProcessing: boolean
  isPaused: boolean
  state: ManagedSessionState | null
  parsedBot: ParsedBotOutput | null
  parsedOutput: ParsedBotOutput | null
  sendOrQueue: (message: UserMessageContent) => Promise<boolean>
  stop: () => void
  messageQueue: UseMessageQueueReturn
  cleanup: () => Promise<void>
}

// ═══════════════════════════════════════════════════════════════════
// Constants & helpers
// ═══════════════════════════════════════════════════════════════════

const BOT_CREATOR_ORIGIN: SessionOrigin = { source: 'bot-creator' }

function buildSystemPrompt(locale: string): string {
  const languageDirective = resolveLanguageDirective(locale)
  return BOT_CREATOR_PROMPT_TEMPLATE.replace('{{LANGUAGE_DIRECTIVE}}', languageDirective)
}

// ═══════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════

export function useBotCreatorSession(
  config: BotCreatorSessionConfig = {}
): BotCreatorSessionHandle {
  const creatorConfig = useMemo<CreatorSessionConfig<ParsedBotOutput>>(
    () => ({
      identity: { origin: BOT_CREATOR_ORIGIN },
      prompt: { build: buildSystemPrompt },
      output: { extract: extractLatestBotOutput },
      project: { id: config.projectId }
    }),
    [config.projectId]
  )

  const creator = useCreatorSession<ParsedBotOutput>(creatorConfig)

  return useMemo<BotCreatorSessionHandle>(
    () => ({ ...creator, parsedBot: creator.parsedOutput, parsedOutput: creator.parsedOutput }),
    [creator]
  )
}
