// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

// ---------------------------------------------------------------------------
// IssueGroup — collapsible group header with count badge
// ---------------------------------------------------------------------------

interface IssueGroupProps {
  /** Display label for this group, e.g. "In Progress", "Urgent", "bug" */
  label: string
  /** Optional icon to display before the label */
  icon?: React.ReactNode
  /** Number of issues in this group */
  count: number
  /** Optional accent color class, e.g. "text-yellow-500" */
  accentColor?: string
  /** Group contents (issue rows) */
  children: React.ReactNode
  /** Start collapsed? Default: false */
  defaultCollapsed?: boolean
}

export function IssueGroup({
  label,
  icon,
  count,
  accentColor,
  children,
  defaultCollapsed = false
}: IssueGroupProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <div className="mt-1">
      {/* Group header */}
      <button
        onClick={() => setCollapsed((prev) => !prev)}
        className={cn(
          'w-full flex items-center gap-2 px-4 py-2 text-xs rounded-lg transition-colors',
          'hover:bg-[hsl(var(--muted)/0.3)]',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]'
        )}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3 text-[hsl(var(--muted-foreground))]" />
        ) : (
          <ChevronDown className="w-3 h-3 text-[hsl(var(--muted-foreground))]" />
        )}
        {icon && <span className={cn('flex items-center', accentColor)}>{icon}</span>}
        <span className={cn('font-medium text-[hsl(var(--foreground))]', accentColor)}>
          {label}
        </span>
        <span className="text-[hsl(var(--muted-foreground))] tabular-nums">
          {count}
        </span>
      </button>

      {/* Group content */}
      {!collapsed && <div>{children}</div>}
    </div>
  )
}
