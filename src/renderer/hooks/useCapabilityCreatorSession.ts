// SPDX-License-Identifier: Apache-2.0

/**
 * useCapabilityCreatorSession — Capability-specific wrapper around `useCreatorSession`.
 *
 * Parameterized by `category` (skill | agent | command | rule), this hook:
 *   - Delegates session lifecycle to `useCreatorSession<ParsedCapabilityOutput>`
 *   - Provides capability-specific output extraction and system prompt
 *   - Configures auto-continuation to recover missing template sections
 *   - Exposes `CapabilityCreatorSessionHandle` (unchanged public API)
 *
 * @module
 */

import { useMemo } from 'react'
import { useCreatorSession } from '@/hooks/useCreatorSession'
import type { CreatorSessionConfig } from '@/hooks/useCreatorSession'
import type { UseMessageQueueReturn } from '@/hooks/useMessageQueue'
import type {
  AICreatableCategory,
  SessionSnapshot,
  ManagedSessionState,
  UserMessageContent
} from '@shared/types'
import { buildCreatorOrigin } from '@shared/types'
import {
  extractLatestCapabilityOutput,
  type ParsedCapabilityOutput
} from '@shared/capabilityOutputParser'
import { getCreatorSystemPrompt } from '@shared/creatorSystemPrompts'
import { FENCE_TYPES, getTemplate } from '@shared/capabilityTemplates'

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface CapabilityCreatorSessionHandle {
  /** The category this creator targets. */
  category: AICreatableCategory
  /** Current managed session (null before creation). */
  session: SessionSnapshot | null
  /** Whether a new session is being created. */
  isStarting: boolean
  /** Whether the agent is actively processing (creating or streaming). */
  isProcessing: boolean
  /** Whether the session is paused (idle / stopped / error). */
  isPaused: boolean
  /** Current session state shortcut. */
  state: ManagedSessionState | null
  /** Parsed capability output extracted from the conversation. */
  parsedOutput: ParsedCapabilityOutput | null

  /**
   * Send or queue a message. Handles:
   * - Starting a new session (if no active session)
   * - Sending to an active session
   * - Resuming a paused session
   * - Queuing when the agent is busy
   */
  sendOrQueue: (message: UserMessageContent) => Promise<boolean>
  /** Stop the current session. */
  stop: () => void
  /** Message queue handle for queue UI display. */
  messageQueue: UseMessageQueueReturn
  /** Clean up the session (stop + delete). Call on unmount. */
  cleanup: () => Promise<void>
}

// ═══════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════

export function useCapabilityCreatorSession(
  category: AICreatableCategory
): CapabilityCreatorSessionHandle {
  const config = useMemo((): CreatorSessionConfig<ParsedCapabilityOutput> => {
    const fenceTag = FENCE_TYPES[category]
    const template = getTemplate(category)
    const sectionList = template.sections
      .map(s => `- ## ${s.heading}${s.required ? ' (required)' : ' (optional)'}`)
      .join('\n')

    return {
      identity: { origin: buildCreatorOrigin(category) },
      prompt: { build: (locale) => getCreatorSystemPrompt(category, locale) },
      output: {
        extract: (messages) => extractLatestCapabilityOutput(messages, category)
      },
      autoContinuation: {
        shouldContinue: (output) =>
          !!output.isPartial && (output.missingSections?.length ?? 0) > 0,
        buildRecoveryPrompt: (output) => {
          const missing = output.missingSections!.join(', ')
          return (
            `The previous output is missing these required sections: ${missing}.\n\n` +
            `The complete structure must be:\n${sectionList}\n\n` +
            `Please output a new complete \`\`\`${fenceTag} fence with ALL sections ` +
            `filled in. Keep each section concise and substantive.`
          )
        }
      }
    }
  }, [category])

  const handle = useCreatorSession<ParsedCapabilityOutput>(config)

  return {
    category,
    ...handle
  }
}
