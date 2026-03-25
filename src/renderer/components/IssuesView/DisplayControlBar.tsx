// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Check, Layers } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useIssueStore } from '../../stores/issueStore'
import { updateIssueView } from '../../actions/issueActions'
import { useModalAnimation } from '../../hooks/useModalAnimation'
import { cn } from '../../lib/utils'
import { ALL_VIEW } from '@shared/types'
import type { GroupByField, SortConfig } from '@shared/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUP_BY_OPTIONS: { value: GroupByField | null; labelKey: string }[] = [
  { value: null, labelKey: 'groupByOptions.none' },
  { value: 'status', labelKey: 'groupByOptions.status' },
  { value: 'priority', labelKey: 'groupByOptions.priority' },
  { value: 'label', labelKey: 'groupByOptions.label' },
  { value: 'project', labelKey: 'groupByOptions.project' }
]

const SORT_FIELD_OPTIONS: { value: SortConfig['field']; labelKey: string }[] = [
  { value: 'updatedAt', labelKey: 'sortFieldOptions.updated' },
  { value: 'createdAt', labelKey: 'sortFieldOptions.created' },
  { value: 'priority', labelKey: 'sortFieldOptions.priority' },
  { value: 'status', labelKey: 'sortFieldOptions.status' }
]

// ---------------------------------------------------------------------------
// DropdownPicker — generic dropdown for selection
// ---------------------------------------------------------------------------

interface DropdownPickerProps<T extends string | null> {
  options: { value: T; labelKey: string }[]
  value: T
  onChange: (value: T) => void
  label: string
  icon: React.ReactNode
}

function DropdownPicker<T extends string | null>({
  options,
  value,
  onChange,
  label,
  icon
}: DropdownPickerProps<T>): React.JSX.Element {
  const { t: tc } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const { mounted, phase } = useModalAnimation(open)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open) return
    function handleMouseDown(e: MouseEvent): void {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        panelRef.current && !panelRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  const selectedOption = options.find((o) => o.value === value)
  const selectedLabel = selectedOption ? tc(selectedOption.labelKey) : tc('groupByOptions.none')

  const handleOpen = useCallback(() => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen((prev) => !prev)
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className={cn(
          'flex items-center gap-1 px-2 py-1 text-[11px] rounded-md transition-colors',
          'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
          open && 'bg-[hsl(var(--foreground)/0.04)]'
        )}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {icon}
        <span>{selectedLabel}</span>
      </button>

      {mounted && (
        <div
          ref={panelRef}
          style={{ top: pos.top, left: pos.left }}
          className={cn(
            'fixed z-[999] w-36 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md overflow-hidden',
            phase === 'enter' && 'dropdown-enter',
            phase === 'exit' && 'dropdown-exit',
          )}
          role="listbox"
          aria-label={label}
        >
          <div className="py-1">
            {options.map((option) => (
              <button
                key={String(option.value)}
                role="option"
                aria-selected={value === option.value}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                  value === option.value
                    ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground))] font-medium'
                    : 'hover:bg-[hsl(var(--foreground)/0.04)]'
                )}
              >
                {tc(option.labelKey)}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// SortPicker — unified sort field + direction in a single dropdown
// ---------------------------------------------------------------------------

interface SortPickerProps {
  field: SortConfig['field']
  order: SortConfig['order']
  onChange: (field: SortConfig['field'], order: SortConfig['order']) => void
}

function SortPicker({ field, order, onChange }: SortPickerProps): React.JSX.Element {
  const { t: tc } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const { mounted, phase } = useModalAnimation(open)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open) return
    function handleMouseDown(e: MouseEvent): void {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        panelRef.current && !panelRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  const selectedOption = SORT_FIELD_OPTIONS.find((o) => o.value === field)
  const selectedLabel = selectedOption ? tc(selectedOption.labelKey) : tc('sortFieldOptions.updated')
  const DirectionIcon = order === 'asc' ? ArrowUp : ArrowDown

  const handleFieldClick = useCallback(
    (clickedField: SortConfig['field']) => {
      if (clickedField === field) {
        // Same field → toggle direction
        onChange(field, order === 'asc' ? 'desc' : 'asc')
      } else {
        // New field → default desc
        onChange(clickedField, 'desc')
      }
      setOpen(false)
    },
    [field, order, onChange]
  )

  const handleOpen = useCallback(() => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen((prev) => !prev)
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className={cn(
          'flex items-center gap-1 px-2 py-1 text-[11px] rounded-md transition-colors',
          'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
          open && 'bg-[hsl(var(--foreground)/0.04)]'
        )}
        aria-label={tc('sortBy')}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <DirectionIcon className="w-3 h-3" />
        <span>{selectedLabel}</span>
      </button>

      {mounted && (
        <div
          ref={panelRef}
          style={{ top: pos.top, left: pos.left }}
          className={cn(
            'fixed z-[999] w-40 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md overflow-hidden',
            phase === 'enter' && 'dropdown-enter',
            phase === 'exit' && 'dropdown-exit',
          )}
          role="listbox"
          aria-label={tc('sortBy')}
        >
          <div className="py-1">
            {SORT_FIELD_OPTIONS.map((option) => {
              const isSelected = field === option.value
              return (
                <button
                  key={option.value}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleFieldClick(option.value)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                    isSelected
                      ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground))] font-medium'
                      : 'hover:bg-[hsl(var(--foreground)/0.04)]'
                  )}
                >
                  {/* Direction arrow for selected item, spacer for others */}
                  {isSelected ? (
                    <DirectionIcon className="w-3 h-3 shrink-0" />
                  ) : (
                    <span className="w-3 h-3 shrink-0" />
                  )}
                  <span className="flex-1">{tc(option.labelKey)}</span>
                  {isSelected && <Check className="w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))]" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// DisplayControlBar
// ---------------------------------------------------------------------------

export function DisplayControlBar(): React.JSX.Element {
  const { t: tc } = useTranslation('common')
  const issueViews = useIssueStore((s) => s.issueViews)
  const activeViewId = useAppStore((s) => s.activeViewId)
  const allViewDisplay = useAppStore((s) => s.allViewDisplay)
  const setAllViewDisplay = useAppStore((s) => s.setAllViewDisplay)
  const loadIssues = useIssueStore((s) => s.loadIssues)

  const isAllView = activeViewId === ALL_VIEW.id

  const activeView = isAllView
    ? ALL_VIEW
    : issueViews.find((v) => v.id === activeViewId) ?? ALL_VIEW

  // All view uses in-memory allViewDisplay; custom views use persisted display
  const currentDisplay = isAllView ? allViewDisplay : activeView.display
  const currentGroupBy = currentDisplay.groupBy
  const currentSort = currentDisplay.sort

  const updateDisplay = useCallback(
    (display: { groupBy: GroupByField | null; sort: SortConfig }) => {
      if (isAllView) {
        setAllViewDisplay(display)
        // Sort changes need a re-fetch; groupBy is client-side only
        if (display.sort !== currentSort) {
          loadIssues()
        }
      } else {
        updateIssueView(activeViewId, { display })
      }
    },
    [isAllView, activeViewId, currentSort, setAllViewDisplay, loadIssues]
  )

  const handleGroupByChange = useCallback(
    (groupBy: GroupByField | null) => {
      updateDisplay({ groupBy, sort: currentSort })
    },
    [currentSort, updateDisplay]
  )

  const handleSortChange = useCallback(
    (field: SortConfig['field'], order: SortConfig['order']) => {
      updateDisplay({ groupBy: currentGroupBy, sort: { field, order } })
    },
    [currentGroupBy, updateDisplay]
  )

  return (
    <>
      {/* Group By */}
      <DropdownPicker
        options={GROUP_BY_OPTIONS}
        value={currentGroupBy}
        onChange={handleGroupByChange}
        label={tc('groupBy')}
        icon={<Layers className="w-3 h-3" />}
      />

      {/* Separator */}
      <span className="w-px h-3 bg-[hsl(var(--border)/0.4)]" />

      {/* Sort — unified field + direction */}
      <SortPicker
        field={currentSort.field}
        order={currentSort.order}
        onChange={handleSortChange}
      />
    </>
  )
}
