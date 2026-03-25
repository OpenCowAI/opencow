// SPDX-License-Identifier: Apache-2.0

/**
 * Filter bar for the Cmd+K command palette.
 *
 * Horizontal pill buttons with count badges — follows the MarketView
 * FilterPill pattern with neutral (non-provider-themed) styling.
 * Positioned between the search input and results list.
 */

import { memo } from 'react'
import { cn } from '@/lib/utils'
import {
  SEARCH_SOURCES,
  type SearchFilterType,
  type SearchFilterCounts,
} from '@/lib/globalSearch'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Sources shown as filter pills (excludes synthetic "action" type). */
const ENTITY_SOURCES = SEARCH_SOURCES.filter((s) => s.type !== 'action')

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface SearchFilterBarProps {
  activeFilter: SearchFilterType
  onFilterChange: (filter: SearchFilterType) => void
  counts: SearchFilterCounts
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const SearchFilterBar = memo(function SearchFilterBar({
  activeFilter,
  onFilterChange,
  counts,
}: SearchFilterBarProps): React.JSX.Element {
  // Sum non-action counts for the "All" pill
  const totalCount = ENTITY_SOURCES.reduce((sum, s) => sum + counts[s.type], 0)

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[hsl(var(--border))]">
      <FilterPill
        label="All"
        count={totalCount}
        active={activeFilter === 'all'}
        onClick={() => onFilterChange('all')}
      />
      {ENTITY_SOURCES.map((source) => (
        <FilterPill
          key={source.type}
          label={source.label}
          count={counts[source.type]}
          active={activeFilter === source.type}
          onClick={() => onFilterChange(source.type)}
        />
      ))}
    </div>
  )
})

/* ------------------------------------------------------------------ */
/*  FilterPill (internal)                                              */
/* ------------------------------------------------------------------ */

interface FilterPillProps {
  label: string
  count: number
  active: boolean
  onClick: () => void
}

function FilterPill({
  label,
  count,
  active,
  onClick,
}: FilterPillProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium',
        'border transition-all duration-150 outline-none',
        'focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
        active
          ? 'bg-[hsl(var(--foreground)/0.06)] text-[hsl(var(--foreground))] border-[hsl(var(--border)/0.5)]'
          : 'bg-transparent text-[hsl(var(--muted-foreground)/0.5)] border-transparent hover:text-[hsl(var(--muted-foreground)/0.8)] hover:bg-[hsl(var(--foreground)/0.03)]',
      )}
    >
      {label}
      {count > 0 && (
        <span
          className={cn(
            'text-[10px] tabular-nums leading-none px-1.5 py-0.5 rounded-md',
            active
              ? 'bg-[hsl(var(--foreground)/0.08)] text-[hsl(var(--foreground)/0.7)]'
              : 'bg-[hsl(var(--foreground)/0.04)] text-[hsl(var(--muted-foreground)/0.4)]',
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}
