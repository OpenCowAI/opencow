// SPDX-License-Identifier: Apache-2.0

/**
 * Single search result item for the command palette.
 *
 * Renders type-specific metadata (status badges, shortcuts, etc.)
 * using the SearchableItem discriminated union.
 */

import { memo } from 'react'
import { cn } from '@/lib/utils'
import type { SearchResult } from '@/lib/globalSearch'
import { HighlightedText } from './HighlightedText'
import { ISSUE_STATUS_THEME, ISSUE_PRIORITY_THEME } from '@/constants/issueStatus'
import { SCHEDULE_STATUS_THEME } from '@/constants/scheduleStatus'

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface SearchResultItemProps {
  result: SearchResult
  isSelected: boolean
  index: number
  onSelect: (result: SearchResult) => void
}

export const SearchResultItem = memo(function SearchResultItem({
  result,
  isSelected,
  index,
  onSelect,
}: SearchResultItemProps): React.JSX.Element {
  const { item } = result

  return (
    <button
      id={`cmd-k-item-${index}`}
      className={cn(
        'w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors text-left',
        isSelected
          ? 'bg-[hsl(var(--primary)/0.08)]'
          : 'hover:bg-[hsl(var(--foreground)/0.04)]',
      )}
      onClick={() => onSelect(result)}
      role="option"
      aria-selected={isSelected}
      data-index={index}
    >
      <div className="min-w-0 flex-1">
        {/* Primary line: title + highlights */}
        <div className="flex items-center gap-2">
          <HighlightedText
            text={item.primary}
            highlights={result.primaryHighlights}
            className="truncate"
          />
          {/* Type-specific inline badges */}
          <TypeBadge item={item} />
        </div>

        {/* Secondary line: subtitle + metadata */}
        <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
          <SecondaryInfo result={result} />
        </div>
      </div>

      {/* Right-side shortcut hint (actions only) */}
      {item.type === 'action' && item.shortcut && (
        <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.5)] px-1.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
          {item.shortcut}
        </kbd>
      )}
    </button>
  )
})

/* ------------------------------------------------------------------ */
/*  Type-specific badge (right of title)                               */
/* ------------------------------------------------------------------ */

function TypeBadge({ item }: { item: SearchResult['item'] }): React.JSX.Element | null {
  switch (item.type) {
    case 'issue': {
      const priorityTheme = ISSUE_PRIORITY_THEME[item.priority]
      return (
        <span className={cn(
          'shrink-0 text-[10px] font-medium uppercase tracking-wide',
          priorityTheme.color,
        )}>
          {priorityTheme.label}
        </span>
      )
    }
    case 'schedule': {
      const statusTheme = SCHEDULE_STATUS_THEME[item.scheduleStatus]
      return (
        <span className={cn('shrink-0 text-[10px] font-medium uppercase tracking-wide', statusTheme.color)}>
          {statusTheme.label}
        </span>
      )
    }
    default:
      return null
  }
}

/* ------------------------------------------------------------------ */
/*  Secondary info line                                                */
/* ------------------------------------------------------------------ */

function SecondaryInfo({ result }: { result: SearchResult }): React.JSX.Element | null {
  const { item } = result

  switch (item.type) {
    case 'issue': {
      const statusTheme = ISSUE_STATUS_THEME[item.status]
      return (
        <>
          <span className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', statusTheme.dotColor)} />
          <span>{statusTheme.label}</span>
          {item.labels.length > 0 && (
            <>
              <span className="text-[hsl(var(--border))]">·</span>
              <span className="truncate">{item.labels.slice(0, 2).join(', ')}</span>
            </>
          )}
        </>
      )
    }

    case 'session': {
      return (
        <>
          {item.secondary && (
            <HighlightedText
              text={item.secondary}
              highlights={result.secondaryHighlights}
              className="truncate"
            />
          )}
          {item.gitBranch && (
            <>
              <span className="text-[hsl(var(--border))]">·</span>
              <span className="truncate">{item.gitBranch}</span>
            </>
          )}
        </>
      )
    }

    case 'schedule': {
      return (
        <>
          {item.frequencySummary && <span>{item.frequencySummary}</span>}
          {item.nextRunAt && (
            <>
              <span className="text-[hsl(var(--border))]">·</span>
              <span>Next: {formatRelativeTime(item.nextRunAt)}</span>
            </>
          )}
        </>
      )
    }

    case 'project': {
      return item.secondary ? (
        <HighlightedText
          text={item.secondary}
          highlights={result.secondaryHighlights}
          className="truncate"
        />
      ) : null
    }

    case 'action': {
      return item.secondary ? <span>{item.secondary}</span> : null
    }

    default:
      return null
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatRelativeTime(ts: number): string {
  const diff = ts - Date.now()
  if (diff < 0) return 'overdue'
  const mins = Math.round(diff / 60_000)
  if (mins <= 0) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}
