// SPDX-License-Identifier: Apache-2.0

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useExitAnimation } from '@/hooks/useModalAnimation'
import { filterSlashItems, groupSlashItems } from '@shared/slashItems'
import { SlashItemRow } from './SlashItemRow'
import type { SlashItem } from '@shared/slashItems'

// ─── Props ──────────────────────────────────────────────────────────────────

interface SlashCommandPopoverProps {
  items: SlashItem[]
  loading?: boolean
  onSelect: (item: SlashItem) => void
  onClose: () => void
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Popover that displays grouped slash commands with local search and
 * full keyboard navigation. Shown via the AlignLeft icon in the input bar.
 */
export const SlashCommandPopover = memo(function SlashCommandPopover({
  items,
  loading,
  onSelect,
  onClose,
}: SlashCommandPopoverProps): React.JSX.Element {
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const { phase, requestClose } = useExitAnimation(onClose)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  // Derive groups from items + local search query
  const filteredGroups = useMemo(() => {
    const filtered = filterSlashItems(items, query)
    return groupSlashItems(filtered, !!query)
  }, [items, query])

  // Flat list of all visible items (for keyboard navigation indexing)
  const flatItems = useMemo(
    () => filteredGroups.flatMap((g) => g.items),
    [filteredGroups],
  )

  // Clamp activeIndex when filtered list changes
  useEffect(() => {
    setActiveIndex((prev) => (prev >= flatItems.length ? Math.max(0, flatItems.length - 1) : prev))
  }, [flatItems.length])

  // Auto-focus search input on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [])

  // Keyboard navigation + Escape (tiered: clear search first, then close)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (query) {
          setQuery('')
          setActiveIndex(0)
        } else {
          requestClose()
        }
        return
      }

      const isUp = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')
      const isDown = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')

      if (isUp) {
        e.preventDefault()
        setActiveIndex((prev) => Math.max(0, prev - 1))
        return
      }

      if (isDown) {
        e.preventDefault()
        setActiveIndex((prev) => Math.min(flatItems.length - 1, prev + 1))
        return
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const selected = flatItems[activeIndex]
        if (selected) handleItemClick(selected)
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [query, flatItems, activeIndex, requestClose])

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        requestClose()
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [requestClose])

  const handleItemClick = useCallback(
    (item: SlashItem) => {
      onSelect(item)
      requestClose()
    },
    [onSelect, requestClose],
  )

  // ── Shared container classes ────────────────────────────────────────────

  const containerCn = cn(
    'border border-[hsl(var(--border))] rounded-lg bg-[hsl(var(--popover))] shadow-lg overflow-hidden w-64',
    phase === 'enter' && 'dropdown-enter',
    phase === 'exit' && 'dropdown-exit',
  )

  if (loading) {
    return (
      <div
        ref={popoverRef}
        {...surfaceProps({ elevation: 'floating', color: 'popover' })}
        role="listbox"
        aria-label="Slash commands"
        className={containerCn}
      >
        <div className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-[hsl(var(--muted-foreground))]">
          <Loader2 className="w-3 h-3 motion-safe:animate-spin" aria-hidden="true" />
          Loading commands...
        </div>
      </div>
    )
  }

  // Track flat index for activeIndex mapping across groups
  let flatIndex = 0

  return (
    <div
      ref={popoverRef}
      {...surfaceProps({ elevation: 'floating', color: 'popover' })}
      role="listbox"
      aria-label="Slash commands"
      className={containerCn}
    >
      {/* ── Search input ── */}
      <div className="px-2 pt-2 pb-1.5">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--muted)/0.3)] focus-within:border-[hsl(var(--ring)/0.5)] transition-colors">
          <Search className="w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            placeholder="Search commands..."
            className="flex-1 bg-transparent text-xs text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground)/0.6)] outline-none"
            aria-label="Search slash commands"
          />
        </div>
      </div>

      {/* ── Results ── */}
      <div className="max-h-72 overflow-y-auto">
        {filteredGroups.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-[hsl(var(--muted-foreground))]">
            No commands found
          </div>
        ) : (
          filteredGroups.map((group) => (
            <div key={group.category}>
              <div className="px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted)/0.5)] select-none">
                {group.label}
              </div>
              {group.items.map((item) => {
                const currentIndex = flatIndex++
                return (
                  <SlashItemRow
                    key={item.id}
                    item={item}
                    isActive={currentIndex === activeIndex}
                    onSelect={handleItemClick}
                  />
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
})
