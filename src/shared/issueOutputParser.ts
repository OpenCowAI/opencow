// SPDX-License-Identifier: Apache-2.0

/**
 * issueOutputParser — Extracts structured issue data from AI conversation.
 *
 * The AI Issue Creator outputs issue data inside a `\`\`\`issue-output` code
 * fence with YAML frontmatter:
 *
 * ```issue-output
 * ---
 * title: "Fix login crash with special characters"
 * status: todo
 * priority: high
 * labels: ["bug", "auth"]
 * ---
 * When users enter special characters (&, <, >, ', ") in the password
 * field on the login page, the application crashes...
 * ```
 *
 * Uses the shared `codeFenceScanner` for fence detection, then applies
 * issue-specific field mapping.
 *
 * @module
 */

import { scanLastFencedBlock, scanLastFencedBlockFromMessages } from './codeFenceScanner'
import type { IssueStatus, IssuePriority, ManagedSessionMessage } from './types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedIssueOutput {
  /** Issue title from frontmatter */
  title: string
  /** Issue description (markdown body after frontmatter) */
  description: string
  /** Issue status */
  status: IssueStatus
  /** Issue priority */
  priority: IssuePriority
  /** Labels array */
  labels: string[]
  /** Optional project ID */
  projectId?: string | null
  /** Optional parent issue ID (for sub-issues) */
  parentIssueId?: string | null
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ISSUE_FENCE_TAG = 'issue-output' as const
const ISSUE_FENCE_TAGS: readonly string[] = [ISSUE_FENCE_TAG]

const VALID_STATUSES: ReadonlySet<string> = new Set<IssueStatus>([
  'backlog', 'todo', 'in_progress', 'done', 'cancelled'
])
const VALID_PRIORITIES: ReadonlySet<string> = new Set<IssuePriority>([
  'urgent', 'high', 'medium', 'low'
])

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseStatus(value: unknown): IssueStatus {
  if (typeof value === 'string' && VALID_STATUSES.has(value)) {
    return value as IssueStatus
  }
  return 'todo' // sensible default for newly created issues
}

function parsePriority(value: unknown): IssuePriority {
  if (typeof value === 'string' && VALID_PRIORITIES.has(value)) {
    return value as IssuePriority
  }
  return 'medium'
}

function parseLabels(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value === 'string') {
    // Handle comma-separated string: "bug, auth" → ["bug", "auth"]
    return value.split(',').map((s) => s.trim()).filter(Boolean)
  }
  return []
}

function parseOptionalString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

// ─── Domain mapping ──────────────────────────────────────────────────────────

function mapToIssueOutput(
  attributes: Record<string, unknown>,
  body: string
): ParsedIssueOutput | null {
  const title = typeof attributes.title === 'string' ? attributes.title.trim() : ''
  if (!title) return null

  return {
    title,
    description: body,
    status: parseStatus(attributes.status),
    priority: parsePriority(attributes.priority),
    labels: parseLabels(attributes.labels),
    projectId: parseOptionalString(attributes.projectId) ?? parseOptionalString(attributes['project-id']),
    parentIssueId: parseOptionalString(attributes.parentIssueId) ?? parseOptionalString(attributes['parent-issue-id'])
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Extract a ParsedIssueOutput from a single text block.
 * Returns null if no valid issue-output fence is found or title is missing.
 *
 * When multiple output blocks exist, returns the **last** one.
 */
export function parseIssueOutput(text: string): ParsedIssueOutput | null {
  const scanned = scanLastFencedBlock(text, ISSUE_FENCE_TAGS)
  if (!scanned) return null
  return mapToIssueOutput(scanned.attributes, scanned.body)
}

/**
 * Scan session messages in reverse order and extract the most recent
 * issue-output from assistant messages.
 */
export function extractLatestIssueOutput(
  messages: ManagedSessionMessage[]
): ParsedIssueOutput | null {
  const scanned = scanLastFencedBlockFromMessages(messages, ISSUE_FENCE_TAGS)
  if (!scanned) return null
  return mapToIssueOutput(scanned.attributes, scanned.body)
}
