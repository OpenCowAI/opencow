// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Filter, Search, X, ChevronRight, CircleDot, BarChart3, Tag } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useIssueStore } from '../../stores/issueStore'
import { setEphemeralFilters } from '../../actions/issueActions'
import { useModalAnimation } from '../../hooks/useModalAnimation'
import { cn } from '../../lib/utils'
import { ISSUE_STATUS_THEME, ISSUE_PRIORITY_THEME } from '../../constants/issueStatus'
import { IssueStatusIcon, IssuePriorityIcon } from './IssueIcons'
import { ALL_VIEW } from '@shared/types'
import type { IssueStatus, IssuePriority, EphemeralFilters } from '@shared/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_STATUSES: IssueStatus[] = ['backlog', 'todo', 'in_progress', 'done', 'cancelled']
const ALL_PRIORITIES: IssuePriority[] = ['urgent', 'high', 'medium', 'low']

type FilterDimension = 'status' | 'priority' | 'label'

interface DimensionConfig {
  key: FilterDimension
  labelKey: string
  icon: LucideIcon
}

const ALL_DIMENSION_CONFIGS: DimensionConfig[] = [
  { key: 'status', labelKey: 'groupByOptions.status', icon: CircleDot },
  { key: 'priority', labelKey: 'groupByOptions.priority', icon: BarChart3 },
  { key: 'label', labelKey: 'groupByOptions.label', icon: Tag },
]

// ---------------------------------------------------------------------------
// Checkbox — shared inline check indicator
// ---------------------------------------------------------------------------

function Checkbox({ checked }: { checked: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0',
        checked
          ? 'bg-[hsl(var(--primary))] border-[hsl(var(--primary))]'
          : 'border-[hsl(var(--border))]'
      )}
    >
      {checked && (
        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// FilterChip — removable filter chip
// ---------------------------------------------------------------------------

interface FilterChipProps {
  label: string
  icon?: React.ReactNode
  onRemove: () => void
}

function FilterChip({ label, icon, onRemove }: FilterChipProps): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground))]">
      {icon}
      <span>{label}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="ml-0.5 p-0.5 rounded-full hover:bg-[hsl(var(--foreground)/0.08)] transition-colors"
        aria-label={`Remove ${label} filter`}
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  )
}

// ---------------------------------------------------------------------------
// DimensionList — left panel listing filterable dimensions
// Only shows dimensions that have >1 available value (otherwise no refinement
// is possible within the current view's constraints).
// ---------------------------------------------------------------------------

interface DimensionListProps {
  /** Only the dimensions that can be meaningfully filtered in the current view. */
  availableDimensions: DimensionConfig[]
  hoveredDimension: FilterDimension | null
  onHoverDimension: (dim: FilterDimension) => void
  onLeaveDimension: () => void
}

function DimensionList({
  availableDimensions,
  hoveredDimension,
  onHoverDimension,
  onLeaveDimension,
}: DimensionListProps): React.JSX.Element {
  const { t: tc } = useTranslation('common')
  return (
    <div className="w-40 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md overflow-hidden">
      <div className="py-1">
        {availableDimensions.map(({ key, labelKey, icon: Icon }) => (
          <div
            key={key}
            onMouseEnter={() => onHoverDimension(key)}
            onMouseLeave={onLeaveDimension}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-xs cursor-default select-none transition-colors',
              hoveredDimension === key
                ? 'bg-[hsl(var(--foreground)/0.06)]'
                : 'hover:bg-[hsl(var(--foreground)/0.04)]'
            )}
          >
            <Icon className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
            <span className="flex-1">{tc(labelKey)}</span>
            <ChevronRight className="w-3 h-3 text-[hsl(var(--muted-foreground))]" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ValueSubMenu — right panel showing scoped checkbox values for a dimension.
// Available options are constrained to what the current view allows, so
// selecting any option always produces meaningful (non-empty) results.
// ---------------------------------------------------------------------------

interface ValueSubMenuProps {
  dimension: FilterDimension
  currentFilters: EphemeralFilters
  /** Options scoped to the current view's persistent filter constraints. */
  availableStatuses: IssueStatus[]
  availablePriorities: IssuePriority[]
  availableLabels: string[]
  onToggleValue: (dimension: FilterDimension, value: string) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function ValueSubMenu({
  dimension,
  currentFilters,
  availableStatuses,
  availablePriorities,
  availableLabels,
  onToggleValue,
  onMouseEnter,
  onMouseLeave,
}: ValueSubMenuProps): React.JSX.Element {
  const { t: tc } = useTranslation('common')
  const panelClass =
    'w-48 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md overflow-hidden'
  const rowClass =
    'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-[hsl(var(--foreground)/0.04)]'

  if (dimension === 'status') {
    const selected = new Set(currentFilters.statuses ?? [])
    return (
      <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className={panelClass}>
        <div className="py-1">
          {availableStatuses.map((status) => (
            <button key={status} onClick={() => onToggleValue('status', status)} className={rowClass}>
              <Checkbox checked={selected.has(status)} />
              <IssueStatusIcon status={status} className="w-3.5 h-3.5" />
              <span>{tc(`issueStatus.${status === 'in_progress' ? 'inProgress' : status}`)}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (dimension === 'priority') {
    const selected = new Set(currentFilters.priorities ?? [])
    return (
      <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className={panelClass}>
        <div className="py-1">
          {availablePriorities.map((priority) => (
            <button key={priority} onClick={() => onToggleValue('priority', priority)} className={rowClass}>
              <Checkbox checked={selected.has(priority)} />
              <IssuePriorityIcon priority={priority} />
              <span>{tc(`priority.${priority}`)}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // Label dimension
  const selected = new Set(currentFilters.labels ?? [])
  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} className={panelClass}>
      <div className="py-1 max-h-48 overflow-y-auto">
        {availableLabels.map((label) => (
          <button key={label} onClick={() => onToggleValue('label', label)} className={rowClass}>
            <Checkbox checked={selected.has(label)} />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EphemeralFilterBar
// ---------------------------------------------------------------------------

export function EphemeralFilterBar(): React.JSX.Element {
  const { t } = useTranslation('issues')
  const { t: tc } = useTranslation('common')
  const ephemeralFilters = useAppStore((s) => s.ephemeralFilters)
  const activeViewId = useAppStore((s) => s.activeViewId)
  const issueViews = useIssueStore((s) => s.issueViews)
  const customLabels = useIssueStore((s) => s.customLabels)

  const [searchInput, setSearchInput] = useState(ephemeralFilters.search ?? '')
  const [menuOpen, setMenuOpen] = useState(false)
  const { mounted: menuMounted, phase: menuPhase } = useModalAnimation(menuOpen)
  const [hoveredDimension, setHoveredDimension] = useState<FilterDimension | null>(null)
  const cascadeRef = useRef<HTMLDivElement>(null)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---------------------------------------------------------------------------
  // Derive available filter options from the current view's persistent filters.
  //
  // The Ephemeral filter operates WITHIN the current view's constraints.
  // resolveToQuery() intersects view.filters ∩ ephemeral.filters, so offering
  // a value outside the view's scope would always yield 0 results — confusing.
  //
  // Rule: if the view pins a dimension → scope options to those values.
  //       if the view leaves a dimension open → offer all possible values.
  // ---------------------------------------------------------------------------

  const activeViewFilters = useMemo(() => {
    if (activeViewId === ALL_VIEW.id) return ALL_VIEW.filters
    return issueViews.find((v) => v.id === activeViewId)?.filters ?? {}
  }, [activeViewId, issueViews])

  const availableStatuses = useMemo<IssueStatus[]>(
    () => activeViewFilters.statuses?.length ? activeViewFilters.statuses : ALL_STATUSES,
    [activeViewFilters.statuses]
  )

  const availablePriorities = useMemo<IssuePriority[]>(
    () => activeViewFilters.priorities?.length ? activeViewFilters.priorities : ALL_PRIORITIES,
    [activeViewFilters.priorities]
  )

  const availableLabels = useMemo<string[]>(
    () => activeViewFilters.labels?.length ? activeViewFilters.labels : customLabels,
    [activeViewFilters.labels, customLabels]
  )

  // Only show a dimension if it has >1 available value — otherwise the user
  // can't meaningfully refine (view has already pinned it to a single value).
  const availableDimensions = useMemo<DimensionConfig[]>(
    () =>
      ALL_DIMENSION_CONFIGS.filter(({ key }) => {
        if (key === 'status') return availableStatuses.length > 1
        if (key === 'priority') return availablePriorities.length > 1
        if (key === 'label') return availableLabels.length > 1
        return true
      }),
    [availableStatuses, availablePriorities, availableLabels]
  )

  // Debounced search — 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      const current = ephemeralFilters.search ?? ''
      if (searchInput !== current) {
        setEphemeralFilters({ ...ephemeralFilters, search: searchInput || undefined })
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync search input when ephemeral filters are cleared (e.g. on view switch)
  useEffect(() => {
    if (!ephemeralFilters.search && searchInput) {
      setSearchInput('')
    }
  }, [ephemeralFilters.search]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close cascade menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    function handleMouseDown(e: MouseEvent): void {
      if (cascadeRef.current && !cascadeRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setHoveredDimension(null)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [menuOpen])

  // Close cascade menu on Escape
  useEffect(() => {
    if (!menuOpen) return
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        setHoveredDimension(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [menuOpen])

  // Cleanup hover timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    }
  }, [])

  // -- Hover bridge handlers ------------------------------------------------

  const handleDimensionHover = useCallback((dim: FilterDimension) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    setHoveredDimension(dim)
  }, [])

  const handleDimensionLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredDimension(null)
    }, 120)
  }, [])

  const handleSubMenuEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
  }, [])

  const handleSubMenuLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredDimension(null)
    }, 120)
  }, [])

  // -- Toggle filter value ---------------------------------------------------

  const handleToggleValue = useCallback(
    (dimension: FilterDimension, value: string) => {
      const updated = { ...ephemeralFilters }

      if (dimension === 'status') {
        const statuses = new Set(updated.statuses ?? [])
        const status = value as IssueStatus
        if (statuses.has(status)) {
          statuses.delete(status)
        } else {
          statuses.add(status)
        }
        updated.statuses = statuses.size > 0 ? Array.from(statuses) : undefined
      } else if (dimension === 'priority') {
        const priorities = new Set(updated.priorities ?? [])
        const priority = value as IssuePriority
        if (priorities.has(priority)) {
          priorities.delete(priority)
        } else {
          priorities.add(priority)
        }
        updated.priorities = priorities.size > 0 ? Array.from(priorities) : undefined
      } else if (dimension === 'label') {
        const labels = new Set(updated.labels ?? [])
        if (labels.has(value)) {
          labels.delete(value)
        } else {
          labels.add(value)
        }
        updated.labels = labels.size > 0 ? Array.from(labels) : undefined
      }

      setEphemeralFilters(updated)
    },
    [ephemeralFilters, setEphemeralFilters]
  )

  // -- Remove individual filter chips ----------------------------------------

  const removeStatus = useCallback(
    (status: IssueStatus) => {
      const statuses = (ephemeralFilters.statuses ?? []).filter((s) => s !== status)
      setEphemeralFilters({
        ...ephemeralFilters,
        statuses: statuses.length > 0 ? statuses : undefined
      })
    },
    [ephemeralFilters, setEphemeralFilters]
  )

  const removePriority = useCallback(
    (priority: IssuePriority) => {
      const priorities = (ephemeralFilters.priorities ?? []).filter((p) => p !== priority)
      setEphemeralFilters({
        ...ephemeralFilters,
        priorities: priorities.length > 0 ? priorities : undefined
      })
    },
    [ephemeralFilters, setEphemeralFilters]
  )

  const removeLabel = useCallback(
    (label: string) => {
      const labels = (ephemeralFilters.labels ?? []).filter((l) => l !== label)
      setEphemeralFilters({
        ...ephemeralFilters,
        labels: labels.length > 0 ? labels : undefined
      })
    },
    [ephemeralFilters, setEphemeralFilters]
  )

  const hasActiveFilters =
    (ephemeralFilters.statuses?.length ?? 0) > 0 ||
    (ephemeralFilters.priorities?.length ?? 0) > 0 ||
    (ephemeralFilters.labels?.length ?? 0) > 0

  const clearAllFilters = useCallback(() => {
    setEphemeralFilters({ search: ephemeralFilters.search })
  }, [ephemeralFilters.search, setEphemeralFilters])

  // Hide the Filter button entirely when no dimension can be refined
  const canFilter = availableDimensions.length > 0

  return (
    <div className="flex-none space-y-1.5">
      {/* Top row: Filter button + Search */}
      <div className="flex items-center gap-2">
        {/* Cascade filter menu */}
        {canFilter && (
          <div ref={cascadeRef} className="relative">
            <button
              onClick={() => {
                setMenuOpen((prev) => {
                  if (prev) setHoveredDimension(null)
                  return !prev
                })
              }}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-xs rounded-lg transition-colors',
                'border border-[hsl(var(--border)/0.5)]',
                'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
                menuOpen && 'bg-[hsl(var(--foreground)/0.04)] text-[hsl(var(--foreground))]'
              )}
              aria-label={tc('addFilter')}
              aria-expanded={menuOpen}
              aria-haspopup="true"
            >
              <Filter className="w-3 h-3" />
              <span>{tc('filter')}</span>
            </button>

            {/* Cascade panels */}
            {menuMounted && (
              <div className={cn(
                'absolute left-0 top-full mt-1 z-50 flex items-start gap-1',
                menuPhase === 'enter' && 'dropdown-enter',
                menuPhase === 'exit' && 'dropdown-exit',
              )}>
                {/* Left: dimension list (scoped to current view) */}
                <DimensionList
                  availableDimensions={availableDimensions}
                  hoveredDimension={hoveredDimension}
                  onHoverDimension={handleDimensionHover}
                  onLeaveDimension={handleDimensionLeave}
                />

                {/* Right: value sub-menu (options scoped to current view) */}
                {hoveredDimension && (
                  <ValueSubMenu
                    dimension={hoveredDimension}
                    currentFilters={ephemeralFilters}
                    availableStatuses={availableStatuses}
                    availablePriorities={availablePriorities}
                    availableLabels={availableLabels}
                    onToggleValue={handleToggleValue}
                    onMouseEnter={handleSubMenuEnter}
                    onMouseLeave={handleSubMenuLeave}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Search input */}
        <div className="group relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('searchIssues')}
            className={cn(
              'w-full pl-8 py-1.5 text-xs rounded-lg border border-[hsl(var(--border)/0.5)] bg-transparent placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring)/0.7)]',
              searchInput ? 'pr-7' : 'pr-3'
            )}
            aria-label={t('searchIssuesAria')}
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded-sm text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 hover:!text-[hsl(var(--foreground))] hover:!opacity-100 transition-opacity"
              aria-label={tc('clearSearch')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Filter chips row — only shown when there are active filters */}
      {hasActiveFilters && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Status chips */}
          {ephemeralFilters.statuses?.map((status) => (
            <FilterChip
              key={`status-${status}`}
              label={tc(`issueStatus.${status === 'in_progress' ? 'inProgress' : status}`)}
              icon={<IssueStatusIcon status={status} className="w-3 h-3" />}
              onRemove={() => removeStatus(status)}
            />
          ))}

          {/* Priority chips */}
          {ephemeralFilters.priorities?.map((priority) => (
            <FilterChip
              key={`priority-${priority}`}
              label={tc(`priority.${priority}`)}
              icon={<IssuePriorityIcon priority={priority} />}
              onRemove={() => removePriority(priority)}
            />
          ))}

          {/* Label chips */}
          {ephemeralFilters.labels?.map((label) => (
            <FilterChip
              key={`label-${label}`}
              label={label}
              onRemove={() => removeLabel(label)}
            />
          ))}

          {/* Clear all button */}
          <button
            onClick={clearAllFilters}
            className="px-2 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            aria-label={tc('clearAll')}
          >
            {tc('clearAll')}
          </button>
        </div>
      )}
    </div>
  )
}
