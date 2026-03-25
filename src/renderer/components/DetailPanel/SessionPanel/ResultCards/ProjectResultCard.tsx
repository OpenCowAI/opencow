// SPDX-License-Identifier: Apache-2.0

/**
 * ProjectResultCard — rich card for get_project tool results.
 *
 * Displays project details with a compact issue-status distribution bar,
 * replacing the raw JSON output with a polished, at-a-glance summary.
 */

import { FolderOpen } from 'lucide-react'
import { IssueStatusIcon } from '../../../IssuesView/IssueIcons'
import { ISSUE_STATUS_THEME, ISSUE_STATUS_RING_ORDER } from '../../../../constants/issueStatus'
import { CardShell } from './CardShell'
import type { IssueStatus } from '@shared/types'

// ─── Data types ─────────────────────────────────────────────────────────────

export interface ProjectData {
  id?: string
  name?: string
  canonicalPath?: string
  pinOrder?: number | null
  isArchived?: boolean
  createdAt?: string
  updatedAt?: string
  issueStats?: {
    total?: number
    byStatus?: Record<string, number>
  }
}

// ─── Parser ─────────────────────────────────────────────────────────────────

/** Parse raw JSON string into ProjectData. Stable reference for RESULT_CARD_REGISTRY. */
export function parseProjectData(raw: string): ProjectData {
  return JSON.parse(raw) as ProjectData
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Truncate a long path by keeping start and end, replacing middle with "...".
 * e.g. "/Users/alice/workspace/projects/opencow" → "/Users/.../opencow"
 */
function truncatePath(path: string, maxLen = 40): string {
  if (path.length <= maxLen) return path
  const parts = path.split('/')
  if (parts.length <= 3) return path
  const first = parts.slice(0, 2).join('/')
  const last = parts[parts.length - 1]
  return `${first}/.../${last}`
}

// ─── Component ──────────────────────────────────────────────────────────────

interface ProjectResultCardProps {
  data: ProjectData
}

export function ProjectResultCard({ data: d }: ProjectResultCardProps): React.JSX.Element {
  const stats = d.issueStats
  const total = stats?.total ?? 0
  const byStatus = (stats?.byStatus ?? {}) as Record<IssueStatus, number>

  // Build segments for the distribution bar, following ISSUE_STATUS_RING_ORDER
  const segments = ISSUE_STATUS_RING_ORDER
    .map((status) => ({
      status,
      count: byStatus[status] ?? 0,
    }))
    .filter((s) => s.count > 0)

  return (
    <CardShell maxWidth="sm">
      {/* ── Project name + icon ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <FolderOpen className="w-4 h-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
        <h4 className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
          {d.name ?? 'Unnamed Project'}
        </h4>
        {d.isArchived && (
          <span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded-full bg-[hsl(var(--muted)/0.6)] text-[hsl(var(--muted-foreground)/0.7)]">
            archived
          </span>
        )}
      </div>

      {/* ── Path ─────────────────────────────────────────────────────── */}
      {d.canonicalPath && (
        <div className="px-3 pb-2">
          <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground)/0.5)] break-all">
            {truncatePath(d.canonicalPath)}
          </span>
        </div>
      )}

      {/* ── Issue stats ──────────────────────────────────────────────── */}
      {total > 0 && (
        <div className="border-t border-[hsl(var(--border)/0.3)] px-3 py-2">
          <div className="text-[10px] text-[hsl(var(--muted-foreground)/0.6)] mb-1.5">
            {total} issue{total !== 1 ? 's' : ''}
          </div>

          {/* Distribution bar — uses dotColor from theme (static Tailwind classes,
              JIT-safe unlike the previous text→bg string replacement) */}
          <div className="flex h-1.5 rounded-full overflow-hidden bg-[hsl(var(--muted)/0.3)] mb-2">
            {segments.map((seg) => (
              <div
                key={seg.status}
                className={`${ISSUE_STATUS_THEME[seg.status].dotColor} transition-all`}
                style={{ width: `${(seg.count / total) * 100}%` }}
                title={`${ISSUE_STATUS_THEME[seg.status].label}: ${seg.count}`}
              />
            ))}
          </div>

          {/* Status counts */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {segments.map((seg) => (
              <div key={seg.status} className="flex items-center gap-1">
                <IssueStatusIcon status={seg.status} className="w-3 h-3" />
                <span className="text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]">
                  {seg.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Footer: ID ───────────────────────────────────────────────── */}
      <div className="px-3 py-1.5 border-t border-[hsl(var(--border)/0.3)]">
        <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground)/0.4)] select-all">
          {d.id ?? ''}
        </span>
      </div>
    </CardShell>
  )
}
