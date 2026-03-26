// SPDX-License-Identifier: Apache-2.0

/**
 * useScheduleCreatorSession — Session hook for the AI Schedule Creator.
 *
 * Thin wrapper around the generic `useCreatorSession` hook, parameterized
 * with schedule-specific identity, prompt building, and output extraction.
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
  extractLatestScheduleOutput,
  type ParsedScheduleOutput
} from '@shared/scheduleOutputParser'
import { SCHEDULE_CREATOR_PROMPT_TEMPLATE } from '@shared/scheduleCreatorSystemPrompt'
import { resolveLanguageDirective } from '@shared/creatorLanguage'

// ═══════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════

export interface ScheduleCreatorSessionConfig {
  /** Current project ID — injected into system prompt for context awareness. */
  projectId?: string | null
}

// ═══════════════════════════════════════════════════════════════════
// Handle
// ═══════════════════════════════════════════════════════════════════

export interface ScheduleCreatorSessionHandle {
  session: SessionSnapshot | null
  isStarting: boolean
  isProcessing: boolean
  isPaused: boolean
  state: ManagedSessionState | null
  parsedSchedule: ParsedScheduleOutput | null
  parsedOutput: ParsedScheduleOutput | null
  sendOrQueue: (message: UserMessageContent) => Promise<boolean>
  stop: () => void
  messageQueue: UseMessageQueueReturn
  cleanup: () => Promise<void>
}

// ═══════════════════════════════════════════════════════════════════
// Constants & helpers
// ═══════════════════════════════════════════════════════════════════

const SCHEDULE_CREATOR_ORIGIN: SessionOrigin = { source: 'schedule-creator' }

function buildSystemPrompt(locale: string): string {
  const languageDirective = resolveLanguageDirective(locale)
  return SCHEDULE_CREATOR_PROMPT_TEMPLATE
    .replace('{{LANGUAGE_DIRECTIVE}}', languageDirective)
    .replace('{{CONTEXT}}', '')
}

// ═══════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════

export function useScheduleCreatorSession(
  config: ScheduleCreatorSessionConfig = {}
): ScheduleCreatorSessionHandle {
  const creatorConfig = useMemo<CreatorSessionConfig<ParsedScheduleOutput>>(
    () => ({
      identity: { origin: SCHEDULE_CREATOR_ORIGIN },
      prompt: { build: buildSystemPrompt },
      output: { extract: extractLatestScheduleOutput },
      project: { id: config.projectId }
    }),
    [config.projectId]
  )

  const creator = useCreatorSession<ParsedScheduleOutput>(creatorConfig)

  return useMemo<ScheduleCreatorSessionHandle>(
    () => ({ ...creator, parsedSchedule: creator.parsedOutput, parsedOutput: creator.parsedOutput }),
    [creator]
  )
}
