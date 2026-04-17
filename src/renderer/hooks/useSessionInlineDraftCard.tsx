// SPDX-License-Identifier: Apache-2.0

/**
 * useSessionInlineDraftCard — Resolve and build inline draft confirmation card.
 *
 * Keeps session draft parsing + card construction out of SessionMessageList so
 * the virtualized list stays focused on rendering/scroll concerns.
 *
 * @module
 */

import { useMemo } from 'react'
import { SessionDraftFooter } from '@/components/DetailPanel/SessionPanel/SessionDraftFooter'
import type { SessionDraftFooterConfig } from '@/components/DetailPanel/SessionPanel/sessionDraftFooterTypes'
import { resolveLatestSessionDraft } from '@shared/sessionDraftOutputParser'
import type { ManagedSessionMessage } from '@shared/types'

export interface InlineDraftCardResult {
  messageId: string
  node: React.ReactNode
}

export function useSessionInlineDraftCard(
  messages: ManagedSessionMessage[],
  sessionId: string,
  config?: SessionDraftFooterConfig
): InlineDraftCardResult | null {
  const strategy = config?.strategy
  const resolvedSessionDraft = useMemo(
    () => (config && strategy === 'inline-fenced-draft' ? resolveLatestSessionDraft(messages) : null),
    [messages, config, strategy]
  )

  return useMemo(() => {
    if (!config) return null
    if (config.strategy === 'lifecycle-tool-result-only') {
      // Lifecycle-operation confirmations are rendered by tool_result cards.
      // Avoid rendering legacy SessionDraftFooter simultaneously.
      return null
    }
    const footerConfig = config

    const issueDraft = resolvedSessionDraft?.type === 'issue' ? resolvedSessionDraft.draft : null
    const scheduleDraft = resolvedSessionDraft?.type === 'schedule' ? resolvedSessionDraft.draft : null

    const node = issueDraft
      ? (
          <SessionDraftFooter
            sessionId={sessionId}
            activeDraftKey={resolvedSessionDraft?.key ?? null}
            activeDraftType="issue"
            latestIssueDraft={issueDraft}
            latestScheduleDraft={null}
            projectId={footerConfig.projectId}
            issueCreationMode={footerConfig.issueCreationMode}
            defaultParentIssueId={footerConfig.defaultParentIssueId}
            lifecycleOperationId={null}
            lifecycleSource="fenced-output"
          />
        )
      : scheduleDraft
        ? (
            <SessionDraftFooter
              sessionId={sessionId}
              activeDraftKey={resolvedSessionDraft?.key ?? null}
              activeDraftType="schedule"
              latestIssueDraft={null}
              latestScheduleDraft={scheduleDraft}
              projectId={footerConfig.projectId}
              issueCreationMode={footerConfig.issueCreationMode}
              defaultParentIssueId={footerConfig.defaultParentIssueId}
              lifecycleOperationId={null}
              lifecycleSource="fenced-output"
            />
          )
        : null

    if (!node) return null

    const messageId = resolvedSessionDraft?.messageId ?? null
    if (!messageId) return null

    return {
      messageId,
      node,
    }
  }, [config, resolvedSessionDraft, sessionId])
}
