// SPDX-License-Identifier: Apache-2.0

/**
 * IssueListResultCard — rich card for list_issues tool results.
 *
 * Renders a compact issue table instead of raw JSON. Shows a fixed number
 * of rows (default 5) with a "Show all" toggle for larger lists.
 */

import { useState } from 'react'
import { IssueStatusIcon, IssuePriorityIcon } from '../../../IssuesView/IssueIcons'
import { CardShell } from './CardShell'
import type { IssueStatus, IssuePriority } from '@shared/types'

// ─── Data types ─────────────────────────────────────────────────────────────

export interface IssueListData {
  total?: number
  returned?: number
  offset?: number
  hasMore?: boolean
  issues?: IssueSummary[]
}

export interface IssueSummary {
  id?: string
  title?: string
  status?: IssueStatus
  priority?: IssuePriority
  labels?: string[]
}

// ─── Parser ─────────────────────────────────────────────────────────────────

/** Parse raw JSON string into IssueListData. Stable reference for RESULT_CARD_REGISTRY. */
export function parseIssueListData(raw: string): IssueListData {
  return JSON.parse(raw) as IssueListData
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_VISIBLE = 5

// ─── Component ──────────────────────────────────────────────────────────────

interface IssueListResultCardProps {
  data: IssueListData
}

export function IssueListResultCard({ data: d }: IssueListResultCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const issues = d.issues ?? []
  const total = d.total ?? issues.length
  const returned = d.returned ?? issues.length
  const hasMore = d.hasMore ?? false
  const visibleIssues = expanded ? issues : issues.slice(0, DEFAULT_VISIBLE)
  const canExpand = issues.length > DEFAULT_VISIBLE

  if (issues.length === 0) {
    return (
      <CardShell maxWidth="lg">
        <div className="px-3 py-2.5">
          <span className="text-xs text-[hsl(var(--muted-foreground)/0.6)] italic">
            No issues found
          </span>
        </div>
      </CardShell>
    )
  }

  return (
    <CardShell maxWidth="lg">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border)/0.3)]">
        <span className="text-xs font-medium text-[hsl(var(--foreground))]">
          Issues
        </span>
        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.6)] tabular-nums">
          {returned === total
            ? `${total} total`
            : `${returned} of ${total}`}
        </span>
      </div>

      {/* ── Issue rows ───────────────────────────────────────────────── */}
      <div className="divide-y divide-[hsl(var(--border)/0.15)]">
        {visibleIssues.map((issue, i) => (
          <div
            key={issue.id ?? i}
            className="flex items-center gap-2 px-3 py-1.5"
          >
            <IssueStatusIcon
              status={issue.status ?? 'backlog'}
              className="w-3.5 h-3.5 shrink-0"
            />
            <span className="flex-1 min-w-0 text-xs text-[hsl(var(--foreground))] truncate">
              {issue.title ?? 'Untitled'}
            </span>
            {/* First label (at most 1 to keep it compact) */}
            {issue.labels && issue.labels.length > 0 && (
              <span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded-full bg-[hsl(var(--muted)/0.6)] text-[hsl(var(--muted-foreground))]">
                {issue.labels[0]}
              </span>
            )}
            <IssuePriorityIcon
              priority={issue.priority ?? 'medium'}
              className="w-3 h-3 shrink-0"
            />
          </div>
        ))}
      </div>

      {/* ── Footer: expand toggle + pagination hint ──────────────────── */}
      {(canExpand || hasMore) && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-[hsl(var(--border)/0.3)]">
          {canExpand ? (
            <button
              onClick={() => setExpanded((prev) => !prev)}
              className="text-[10px] text-[hsl(var(--primary))] hover:underline"
            >
              {expanded ? 'Show less' : `Show all ${issues.length}`}
            </button>
          ) : (
            <span />
          )}
          {hasMore && (
            <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)]">
              {total - returned} more not shown
            </span>
          )}
        </div>
      )}
    </CardShell>
  )
}
