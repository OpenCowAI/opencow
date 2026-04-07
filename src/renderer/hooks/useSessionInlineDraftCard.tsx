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
import { useSessionLifecycleOperations } from '@/hooks/useSessionLifecycleOperations'
import {
  mapIssueOperationToParsedDraft,
  mapScheduleOperationToParsedDraft,
} from '@/lib/lifecycleOperationDraftMapper'
import { resolveLatestSessionDraft } from '@shared/sessionDraftOutputParser'
import type { ManagedSessionMessage } from '@shared/types'

export interface InlineDraftCardResult {
  messageId: string
  node: React.ReactNode
}

function resolveLifecycleAnchorMessageId(messages: ManagedSessionMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant') {
      const hasRenderableText = msg.content.some((block) => block.type === 'text' && block.text.trim().length > 0)
      if (hasRenderableText) return msg.id
    }
  }
  return null
}

export function useSessionInlineDraftCard(
  messages: ManagedSessionMessage[],
  sessionId: string,
  config?: SessionDraftFooterConfig
): InlineDraftCardResult | null {
  const source = config?.source ?? 'fenced-output'
  const lifecycle = useSessionLifecycleOperations(
    config && source === 'lifecycle-operation' ? sessionId : null
  )
  const resolvedSessionDraft = useMemo(
    () => (config ? resolveLatestSessionDraft(messages) : null),
    [messages, config]
  )

  return useMemo(() => {
    if (!config) return null

    const issueDraft = source === 'lifecycle-operation'
      ? (lifecycle.latestPendingIssueOperation
          ? mapIssueOperationToParsedDraft(lifecycle.latestPendingIssueOperation)
          : null)
      : (resolvedSessionDraft?.type === 'issue' ? resolvedSessionDraft.draft : null)
    const scheduleDraft = source === 'lifecycle-operation'
      ? (lifecycle.latestPendingScheduleOperation
          ? mapScheduleOperationToParsedDraft(lifecycle.latestPendingScheduleOperation)
          : null)
      : (resolvedSessionDraft?.type === 'schedule' ? resolvedSessionDraft.draft : null)

    const activeIssueOperationId =
      source === 'lifecycle-operation' ? lifecycle.latestPendingIssueOperation?.operationId ?? null : null
    const activeScheduleOperationId =
      source === 'lifecycle-operation'
        ? lifecycle.latestPendingScheduleOperation?.operationId ?? null
        : null

    const node = issueDraft
      ? (
          <SessionDraftFooter
            sessionId={sessionId}
            activeDraftKey={source === 'lifecycle-operation'
              ? activeIssueOperationId
              : resolvedSessionDraft?.key ?? null}
            activeDraftType="issue"
            latestIssueDraft={issueDraft}
            latestScheduleDraft={null}
            projectId={config.projectId}
            issueCreationMode={config.issueCreationMode}
            defaultParentIssueId={config.defaultParentIssueId}
            lifecycleOperationId={activeIssueOperationId}
            lifecycleSource={source}
          />
        )
      : scheduleDraft
        ? (
            <SessionDraftFooter
              sessionId={sessionId}
              activeDraftKey={source === 'lifecycle-operation'
                ? activeScheduleOperationId
              : resolvedSessionDraft?.key ?? null}
              activeDraftType="schedule"
              latestIssueDraft={null}
              latestScheduleDraft={scheduleDraft}
              projectId={config.projectId}
              issueCreationMode={config.issueCreationMode}
              defaultParentIssueId={config.defaultParentIssueId}
              lifecycleOperationId={activeScheduleOperationId}
              lifecycleSource={source}
            />
          )
        : null

    if (!node) return null

    const messageId = source === 'lifecycle-operation'
      ? (resolveLifecycleAnchorMessageId(messages) ?? resolvedSessionDraft?.messageId ?? null)
      : (resolvedSessionDraft?.messageId ?? null)
    if (!messageId) return null

    return {
      messageId,
      node,
    }
  }, [config, resolvedSessionDraft, sessionId, source, lifecycle.latestPendingIssueOperation, lifecycle.latestPendingScheduleOperation, messages])
}
