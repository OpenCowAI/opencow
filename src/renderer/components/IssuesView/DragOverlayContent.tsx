// SPDX-License-Identifier: Apache-2.0

import { IssueStatusIcon, IssuePriorityIcon } from './IssueIcons'
import type { IssueSummary } from '@shared/types'

/**
 * Custom drag overlay — a condensed, elevated card shown while dragging.
 * Deliberately simpler than IssueRow to avoid visual clutter during drag.
 */
export function DragOverlayContent({ issue }: { issue: IssueSummary }): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg max-w-xs
        bg-[hsl(var(--card))] border border-[hsl(var(--border))]
        shadow-lg shadow-black/20
        motion-safe:scale-[1.03]
        cursor-grabbing select-none"
      role="status"
      aria-label={`Dragging issue: ${issue.title}`}
    >
      <IssueStatusIcon status={issue.status} className="w-4 h-4 shrink-0" />
      <span className="text-sm font-medium truncate text-[hsl(var(--foreground))]">
        {issue.title}
      </span>
      <IssuePriorityIcon priority={issue.priority} className="w-3.5 h-3.5 shrink-0" />
    </div>
  )
}
