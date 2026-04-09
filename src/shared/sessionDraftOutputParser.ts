// SPDX-License-Identifier: Apache-2.0

/**
 * sessionDraftOutputParser — Resolve the latest valid draft type across tags.
 *
 * This helper determines which draft should be considered "active" in a
 * session when both `issue-output` and `schedule-output` may appear.
 *
 * Resolution strategy:
 *   1. Newer assistant message wins (scan messages in reverse order)
 *   2. Within the same message, later fence wins
 *   3. Invalid fences are ignored (must parse to a valid draft payload)
 *
 * @module
 */

import { scanLastFencedBlock } from './codeFenceScanner'
import { parseIssueOutput } from './issueOutputParser'
import { parseScheduleOutput } from './scheduleOutputParser'
import type { ManagedSessionMessage } from './types'
import type { ParsedIssueOutput } from './issueOutputParser'
import type { ParsedScheduleOutput } from './scheduleOutputParser'

export type SessionDraftType = 'issue' | 'schedule' | null

const DRAFT_TAGS: readonly string[] = ['issue-output', 'schedule-output']

export interface ResolvedIssueSessionDraft {
  type: 'issue'
  key: string
  messageId: string
  draft: ParsedIssueOutput
}

export interface ResolvedScheduleSessionDraft {
  type: 'schedule'
  key: string
  messageId: string
  draft: ParsedScheduleOutput
}

export type ResolvedSessionDraft =
  | ResolvedIssueSessionDraft
  | ResolvedScheduleSessionDraft
  | null

function messageText(msg: Extract<ManagedSessionMessage, { role: 'assistant' }>): string {
  return msg.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function buildIssueDraftKey(draft: ParsedIssueOutput): string {
  return [
    draft.title,
    draft.status,
    draft.priority,
    draft.labels.join('\u001f'),
    draft.projectId ?? '',
    draft.parentIssueId ?? '',
    draft.description,
  ].join('\u0000')
}

function buildScheduleDraftKey(draft: ParsedScheduleOutput): string {
  return [
    draft.name,
    draft.frequency,
    draft.priority,
    draft.projectId ?? '',
    draft.timeOfDay ?? '',
    String(draft.intervalMinutes ?? ''),
    (draft.daysOfWeek ?? []).join(','),
    draft.cronExpression ?? '',
    draft.executeAt ?? '',
    draft.description,
    draft.prompt,
    draft.systemPrompt ?? '',
  ].join('\u0000')
}

/**
 * Resolve the latest valid draft type from assistant messages.
 *
 * Returns:
 *   - `issue`    when latest valid draft is issue-output
 *   - `schedule` when latest valid draft is schedule-output
 *   - `null`     when no valid draft exists
 */
export function resolveLatestSessionDraftType(
  messages: ManagedSessionMessage[]
): SessionDraftType {
  const resolved = resolveLatestSessionDraft(messages)
  return resolved?.type ?? null
}

/**
 * Resolve latest valid session draft and include a stable identity key.
 *
 * The key is used by UI layers to reset confirmation state when the active
 * draft changes, avoiding cross-draft state pollution.
 */
export function resolveLatestSessionDraft(
  messages: ManagedSessionMessage[]
): ResolvedSessionDraft {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue

    const text = messageText(msg)
    if (!text.trim()) continue

    const issue = parseIssueOutput(text)
    const schedule = parseScheduleOutput(text)

    if (!issue && !schedule) continue
    if (issue && !schedule) {
      return {
        type: 'issue',
        key: buildIssueDraftKey(issue),
        messageId: msg.id,
        draft: issue,
      }
    }
    if (!issue && schedule) {
      return {
        type: 'schedule',
        key: buildScheduleDraftKey(schedule),
        messageId: msg.id,
        draft: schedule,
      }
    }

    // Both draft types are valid in this message — choose by fence order.
    // At this point both `issue` and `schedule` are non-null by control flow.
    const issueDraft = issue as ParsedIssueOutput
    const scheduleDraft = schedule as ParsedScheduleOutput
    const scanned = scanLastFencedBlock(text, DRAFT_TAGS)
    if (scanned?.tag === 'issue-output') {
      return {
        type: 'issue',
        key: buildIssueDraftKey(issueDraft),
        messageId: msg.id,
        draft: issueDraft,
      }
    }
    if (scanned?.tag === 'schedule-output') {
      return {
        type: 'schedule',
        key: buildScheduleDraftKey(scheduleDraft),
        messageId: msg.id,
        draft: scheduleDraft,
      }
    }

    // Defensive fallback (should be unreachable when both parse successfully).
    return {
      type: 'schedule',
      key: buildScheduleDraftKey(scheduleDraft),
      messageId: msg.id,
      draft: scheduleDraft,
    }
  }

  return null
}
