// SPDX-License-Identifier: Apache-2.0

/**
 * useIssueCreatorSession — Thin wrapper around `useCreatorSession` for
 * conversational AI issue creation.
 *
 * Domain-specific concerns:
 *   - `{source: 'issue-creator'}` origin
 *   - System prompt with project labels and parent-issue context
 *   - `issue-output` code-fence extraction via `extractLatestIssueOutput`
 *
 * All session lifecycle is delegated to the generic `useCreatorSession` hook.
 *
 * @module
 */

import { useMemo } from 'react'
import { useCreatorSession, type CreatorSessionHandle } from '@/hooks/useCreatorSession'
import type { UseMessageQueueReturn } from '@/hooks/useMessageQueue'
import type {
  SessionSnapshot,
  ManagedSessionState,
  SessionOrigin,
  UserMessageContent
} from '@shared/types'
import {
  extractLatestIssueOutput,
  type ParsedIssueOutput
} from '@shared/issueOutputParser'
import { ISSUE_CREATOR_PROMPT_TEMPLATE } from '@shared/issueCreatorSystemPrompt'
import { resolveLanguageDirective } from '@shared/creatorLanguage'

// ── Config ──────────────────────────────────────────────────────────

export interface IssueCreatorSessionConfig {
  projectId?: string | null
  parentIssueId?: string | null
  availableLabels?: string[]
}

// ── Handle ──────────────────────────────────────────────────────────

export interface IssueCreatorSessionHandle {
  session: SessionSnapshot | null
  isStarting: boolean
  isProcessing: boolean
  isPaused: boolean
  state: ManagedSessionState | null
  parsedIssue: ParsedIssueOutput | null
  sendOrQueue: (message: UserMessageContent) => Promise<boolean>
  stop: () => void
  messageQueue: UseMessageQueueReturn
  cleanup: () => Promise<void>
}

// ── System prompt builder ───────────────────────────────────────────

const ISSUE_CREATOR_ORIGIN: SessionOrigin = { source: 'issue-creator' }

function buildSystemPrompt(locale: string, config: IssueCreatorSessionConfig): string {
  const languageDirective = resolveLanguageDirective(locale)
  const contextParts: string[] = []

  if (config.availableLabels && config.availableLabels.length > 0) {
    contextParts.push(
      `## Available Labels in Current Project\n\n` +
        `Prefer reusing these existing labels when appropriate: ${config.availableLabels.join(', ')}`
    )
  }
  if (config.parentIssueId) {
    contextParts.push(
      `## Creating Sub-Issue\n\n` +
        `This issue will be created as a child of parent issue ID: ${config.parentIssueId}. ` +
        `Keep the scope focused as a sub-task of the parent issue.`
    )
  }

  return ISSUE_CREATOR_PROMPT_TEMPLATE
    .replace('{{LANGUAGE_DIRECTIVE}}', languageDirective)
    .replace('{{CONTEXT}}', contextParts.length > 0 ? contextParts.join('\n\n') : '')
}

// ── Hook ────────────────────────────────────────────────────────────

export function useIssueCreatorSession(
  config: IssueCreatorSessionConfig = {}
): IssueCreatorSessionHandle {
  const creatorConfig = useMemo(
    () => ({
      identity: { origin: ISSUE_CREATOR_ORIGIN },
      prompt: { build: (locale: string) => buildSystemPrompt(locale, config) },
      output: { extract: extractLatestIssueOutput },
      project: { id: config.projectId }
    }),
    [config]
  )

  const handle: CreatorSessionHandle<ParsedIssueOutput> = useCreatorSession(creatorConfig)

  return useMemo(
    () => ({
      session: handle.session,
      isStarting: handle.isStarting,
      isProcessing: handle.isProcessing,
      isPaused: handle.isPaused,
      state: handle.state,
      parsedIssue: handle.parsedOutput,
      sendOrQueue: handle.sendOrQueue,
      stop: handle.stop,
      messageQueue: handle.messageQueue,
      cleanup: handle.cleanup
    }),
    [handle]
  )
}
