// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { IssuePriorityIcon } from '../IssuesView/IssueIcons'
import type { IssuePriority } from '@shared/types'

interface PriorityPickerProps {
  value: IssuePriority | null
  onChange: (priority: IssuePriority | null) => void
  className?: string
}

const PRIORITY_OPTIONS: { value: IssuePriority | null; label: string }[] = [
  { value: null, label: 'All Priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' }
]

export function PriorityPicker({
  value,
  onChange,
  className
}: PriorityPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { mounted, phase } = useModalAnimation(open)
  const [focusIndex, setFocusIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedOption = PRIORITY_OPTIONS.find((o) => o.value === value)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleMouseDown(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  // Reset focus index when opening
  useEffect(() => {
    if (open) {
      setFocusIndex(-1)
    }
  }, [open])

  const handleSelect = useCallback(
    (priority: IssuePriority | null) => {
      onChange(priority)
      setOpen(false)
    },
    [onChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setFocusIndex((prev) => Math.min(prev + 1, PRIORITY_OPTIONS.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocusIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (focusIndex >= 0 && focusIndex < PRIORITY_OPTIONS.length) {
            handleSelect(PRIORITY_OPTIONS[focusIndex].value)
          }
          break
        case 'Escape':
          e.preventDefault()
          setOpen(false)
          break
      }
    },
    [focusIndex, handleSelect]
  )

  // Scroll focused item into view
  useEffect(() => {
    if (focusIndex < 0 || !listRef.current) return
    const items = listRef.current.querySelectorAll('[data-picker-item]')
    items[focusIndex]?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex])

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-[hsl(var(--border))] transition-colors',
          'hover:bg-[hsl(var(--foreground)/0.04)]',
          open && 'ring-1 ring-[hsl(var(--ring))]',
          value ? 'text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]'
        )}
        aria-label="Filter by priority"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {value && <IssuePriorityIcon priority={value} />}
        <span className="truncate max-w-[100px]">{selectedOption?.label ?? 'All Priorities'}</span>
        <ChevronDown
          className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {/* Dropdown */}
      {mounted && (
        <div
          className={cn(
            'absolute left-0 z-50 w-44 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md overflow-hidden top-full mt-1',
            phase === 'enter' && 'dropdown-enter',
            phase === 'exit' && 'dropdown-exit',
          )}
          role="listbox"
          aria-label="Filter by priority"
          onKeyDown={handleKeyDown}
        >
          <div ref={listRef} className="py-1">
            {PRIORITY_OPTIONS.map((option, index) => (
              <button
                key={option.label}
                data-picker-item
                role="option"
                aria-selected={value === option.value}
                onClick={() => handleSelect(option.value)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                  focusIndex === index && 'bg-[hsl(var(--primary)/0.08)]',
                  focusIndex !== index && 'hover:bg-[hsl(var(--foreground)/0.04)]'
                )}
              >
                <Check
                  className={cn(
                    'h-3 w-3 shrink-0',
                    value === option.value ? 'opacity-100' : 'opacity-0'
                  )}
                  aria-hidden="true"
                />
                {option.value && <IssuePriorityIcon priority={option.value} />}
                <span className="truncate">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
