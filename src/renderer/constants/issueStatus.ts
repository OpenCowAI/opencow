// SPDX-License-Identifier: Apache-2.0

import type { IssueStatus, IssuePriority } from '@shared/types'

// ---------------------------------------------------------------------------
// Issue Status Theme
// ---------------------------------------------------------------------------

export interface IssueStatusTheme {
  /** Display label, e.g. "In Progress", "Done" */
  label: string
  /** Tailwind text-* class for icons (IssueStatusIcon, etc.) */
  color: string
  /** Tailwind stroke-* class for SVG ring segments */
  ringColor: string
  /** Tailwind bg-* class for status dot indicators (search results, etc.) */
  dotColor: string
}

/**
 * Single source of truth for Issue status visual properties.
 *
 * Referenced by:
 *   - IssueIcons.tsx  → color
 *   - SegmentedRing integration in IssueRow → ringColor + label
 *   - Any future component that needs status-aware styling
 */
export const ISSUE_STATUS_THEME: Record<IssueStatus, IssueStatusTheme> = {
  backlog: {
    label: 'Backlog',
    color: 'text-[hsl(var(--muted-foreground))]',
    // Slightly faded vs todo — provides visual distinction in rings
    ringColor: 'stroke-[hsl(var(--muted-foreground)/0.45)]',
    dotColor: 'bg-[hsl(var(--muted-foreground)/0.45)]',
  },
  todo: {
    label: 'Todo',
    color: 'text-[hsl(var(--muted-foreground))]',
    ringColor: 'stroke-[hsl(var(--muted-foreground))]',
    dotColor: 'bg-[hsl(var(--muted-foreground))]',
  },
  in_progress: {
    label: 'In Progress',
    color: 'text-yellow-500',
    ringColor: 'stroke-yellow-500',
    dotColor: 'bg-yellow-500',
  },
  done: {
    label: 'Done',
    color: 'text-green-500',
    ringColor: 'stroke-green-500',
    dotColor: 'bg-green-500',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'text-red-400',
    ringColor: 'stroke-red-400',
    dotColor: 'bg-red-400',
  }
}

/**
 * Canonical render order for ring segments.
 * done first (green, most prominent at 12 o'clock) → in_progress → todo → backlog → cancelled.
 */
export const ISSUE_STATUS_RING_ORDER: IssueStatus[] = [
  'done',
  'in_progress',
  'todo',
  'backlog',
  'cancelled'
]

// ---------------------------------------------------------------------------
// Issue Priority Theme
// ---------------------------------------------------------------------------

export interface IssuePriorityTheme {
  label: string
  color: string
}

export const ISSUE_PRIORITY_THEME: Record<IssuePriority, IssuePriorityTheme> = {
  urgent: { label: 'Urgent', color: 'text-red-500' },
  high: { label: 'High', color: 'text-orange-500' },
  medium: { label: 'Medium', color: 'text-yellow-500' },
  low: { label: 'Low', color: 'text-[hsl(var(--muted-foreground))]' }
}
