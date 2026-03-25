// SPDX-License-Identifier: Apache-2.0

/**
 * IssueResultCard — rich card for single-issue tool results.
 *
 * Renders a polished, Linear-style card for create_issue, update_issue,
 * and get_issue results. Rendered via RESULT_CARD_REGISTRY in
 * ToolResultBlockView when the tool_result JSON is successfully parsed.
 *
 * Reuses IssueStatusIcon / IssuePriorityIcon and ISSUE_*_THEME for visual
 * consistency with IssueRow and the rest of the Issues UI.
 */

import { useState } from 'react'
import { IssueStatusIcon, IssuePriorityIcon } from '../../../IssuesView/IssueIcons'
import { ISSUE_STATUS_THEME, ISSUE_PRIORITY_THEME } from '../../../../constants/issueStatus'
import { formatRelativeTime } from '@/lib/formatTime'
import { CardShell } from './CardShell'
import type { IssueStatus, IssuePriority } from '@shared/types'

// ─── Data types ─────────────────────────────────────────────────────────────

/** Data shape for a single issue (all fields optional for defensive rendering). */
export interface IssueData {
  id?: string
  title?: string
  description?: string
  status?: IssueStatus
  priority?: IssuePriority
  labels?: string[]
  projectId?: string | null
  parentIssueId?: string | null
  sessionId?: string | null
  imageCount?: number
  createdAt?: string
  updatedAt?: string
  children?: ChildIssueData[]
}

export interface ChildIssueData {
  id?: string
  title?: string
  status?: IssueStatus
  priority?: IssuePriority
}

// ─── Parser ─────────────────────────────────────────────────────────────────

/** Parse raw JSON string into IssueData. Stable reference for RESULT_CARD_REGISTRY. */
export function parseIssueData(raw: string): IssueData {
  return JSON.parse(raw) as IssueData
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_CHILDREN_VISIBLE = 5

// ─── Component ──────────────────────────────────────────────────────────────

interface IssueResultCardProps {
  data: IssueData
}

export function IssueResultCard({ data: d }: IssueResultCardProps): React.JSX.Element {
  const [childrenExpanded, setChildrenExpanded] = useState(false)

  const status = d.status ?? 'backlog'
  const priority = d.priority ?? 'medium'
  const statusTheme = ISSUE_STATUS_THEME[status] ?? ISSUE_STATUS_THEME.backlog
  const priorityTheme = ISSUE_PRIORITY_THEME[priority] ?? ISSUE_PRIORITY_THEME.medium
  const labels = d.labels ?? []
  const children = d.children ?? []
  const hasDescription = !!d.description
  const hasChildren = children.length > 0

  return (
    <CardShell maxWidth="md">
      {/* ── Status + Priority row ────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <div className="flex items-center gap-1.5">
          <IssueStatusIcon status={status} className="w-3.5 h-3.5" />
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {statusTheme.label}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <IssuePriorityIcon priority={priority} className="w-3 h-3" />
          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
            {priorityTheme.label}
          </span>
        </div>
      </div>

      {/* ── Title ────────────────────────────────────────────────────── */}
      <div className="px-3 pb-1.5">
        <h4 className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
          {d.title ?? 'Untitled'}
        </h4>
      </div>

      {/* ── Labels ───────────────────────────────────────────────────── */}
      {labels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 px-3 pb-2">
          {labels.map((label) => (
            <span
              key={label}
              className="px-1.5 py-0.5 text-[10px] rounded-full bg-[hsl(var(--muted)/0.6)] text-[hsl(var(--muted-foreground))]"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* ── Description (get_issue only) ─────────────────────────────── */}
      {hasDescription && (
        <div className="relative border-t border-[hsl(var(--border)/0.3)]">
          <div className="px-3 py-2 max-h-20 overflow-hidden text-xs text-[hsl(var(--muted-foreground))] leading-relaxed whitespace-pre-wrap">
            {d.description}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-6 pointer-events-none bg-gradient-to-t from-[hsl(var(--card))] to-transparent" />
        </div>
      )}

      {/* ── Children (get_issue only) ────────────────────────────────── */}
      {hasChildren && (
        <div className="border-t border-[hsl(var(--border)/0.3)] px-3 py-1.5">
          <div className="text-[10px] text-[hsl(var(--muted-foreground)/0.6)] mb-1">
            {children.length} sub-issue{children.length !== 1 ? 's' : ''}
          </div>
          {(childrenExpanded ? children : children.slice(0, MAX_CHILDREN_VISIBLE)).map((child, i) => (
            <div key={child.id ?? i} className="flex items-center gap-1.5 py-0.5">
              <IssueStatusIcon
                status={child.status ?? 'backlog'}
                className="w-3 h-3 shrink-0"
              />
              <span className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">
                {child.title ?? 'Untitled'}
              </span>
            </div>
          ))}
          {children.length > MAX_CHILDREN_VISIBLE && !childrenExpanded && (
            <button
              onClick={() => setChildrenExpanded(true)}
              className="text-[10px] text-[hsl(var(--primary))] hover:underline mt-0.5"
            >
              +{children.length - MAX_CHILDREN_VISIBLE} more
            </button>
          )}
        </div>
      )}

      {/* ── Footer: time + ID ────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-[hsl(var(--border)/0.3)]">
        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)]">
          {d.createdAt ? formatRelativeTime(d.createdAt) : ''}
        </span>
        <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground)/0.4)] select-all">
          {d.id ?? ''}
        </span>
      </div>
    </CardShell>
  )
}
