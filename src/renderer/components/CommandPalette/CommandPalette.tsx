// SPDX-License-Identifier: Apache-2.0

/**
 * Command Palette — Cmd+K global search.
 *
 * Split into two components:
 *   - CommandPalette: outer shell, manages open/close + global shortcut.
 *   - CommandPaletteInner: mounted only when visible, runs useGlobalSearch.
 *
 * This ensures the search hook (store subscriptions, frecency reads,
 * searchableItems memo) is only active while the palette is open.
 */

import { useEffect, useRef, useCallback, useMemo } from 'react'
import { useAppStore } from '@/stores/appStore'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'
import { useGlobalSearch } from '@/hooks/useGlobalSearch'
import { SearchResultItem } from './SearchResultItem'
import { SearchFilterBar } from './SearchFilterBar'

/* ================================================================== */
/*  Outer shell — always mounted, handles shortcut + animation         */
/* ================================================================== */

export function CommandPalette(): React.JSX.Element | null {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const { mounted, phase } = useModalAnimation(open)
  // Hide native WebContentsView while command palette is open
  useBlockBrowserView('command-palette', open)

  // Stable callbacks for the inner component
  const handleClose = useCallback(() => setOpen(false), [setOpen])

  // ── Global Cmd+K shortcut ──────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(!open)
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, setOpen])

  if (!mounted) return null

  return (
    <CommandPaletteInner
      phase={phase}
      onClose={handleClose}
    />
  )
}

/* ================================================================== */
/*  Inner — mounted only when palette is visible                       */
/* ================================================================== */

interface CommandPaletteInnerProps {
  phase: 'enter' | 'exit' | null
  onClose: () => void
}

function CommandPaletteInner({ phase, onClose }: CommandPaletteInnerProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const {
    query,
    setQuery,
    groups,
    flatItems,
    hasResults,
    selectedIndex,
    activeFilter,
    activeFilterLabel,
    setActiveFilter,
    filterCounts,
    handleKeyDown,
    selectResult,
    reset,
  } = useGlobalSearch()

  // ── Focus management ────────────────────────────────
  // On mount: capture previous focus and auto-focus input.
  // On unmount: restore focus via cleanup ref (handled by outer component).
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement
    requestAnimationFrame(() => inputRef.current?.focus())

    return () => {
      previousFocusRef.current?.focus()
    }
  }, [])

  // ── Scroll selected item into view ──────────────────
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // ── Close + reset handler ─────────────────────────
  // Component layer owns the full close lifecycle:
  // 1. Reset search state (query, selection)
  // 2. Close the palette (setCommandPaletteOpen → false)
  const handleCloseAndReset = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  // ── Select handler ────────────────────────────────
  const handleSelect = useCallback((result: Parameters<typeof selectResult>[0]) => {
    selectResult(result)
    reset()
    onClose()
  }, [selectResult, reset, onClose])

  // ── Pre-compute flat index map (no mutable counter in render) ──
  const indexMap = useMemo(() => {
    const map = new Map<string, number>()
    let i = 0
    for (const group of groups) {
      for (const result of group.items) {
        map.set(`${result.item.type}-${result.item.entityId}`, i++)
      }
    }
    return map
  }, [groups])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] overscroll-contain no-drag">
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-black/50 surface-backdrop-isolate',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit' && 'modal-overlay-exit',
        )}
        onClick={handleCloseAndReset}
        aria-hidden="true"
      />

      {/* Shell */}
      <div
        className={cn(
          'relative z-10 w-full max-w-3xl',
          phase === 'enter' && 'modal-content-enter',
          phase === 'exit' && 'modal-content-exit',
        )}
      >
        {/* Glass surface */}
        <div
          {...surfaceProps({ elevation: 'modal', color: 'popover' })}
          className="absolute inset-0 rounded-2xl bg-[hsl(var(--popover))] shadow-2xl border border-[hsl(var(--border))] pointer-events-none"
          aria-hidden="true"
        />

        {/* Content */}
        <div
          className="relative rounded-2xl overflow-hidden"
          role="dialog"
          aria-label="Command palette"
          aria-modal="true"
        >
          {/* Search input */}
          <div className="group flex items-center border-b border-[hsl(var(--border))] px-3">
            <Search
              className="h-4 w-4 text-[hsl(var(--muted-foreground))] shrink-0"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search issues, sessions, schedules…"
              className="flex-1 h-11 px-3 text-sm bg-transparent outline-none placeholder:text-[hsl(var(--muted-foreground))]"
              role="combobox"
              aria-expanded={hasResults}
              aria-controls="cmd-k-listbox"
              aria-activedescendant={
                flatItems[selectedIndex]
                  ? `cmd-k-item-${selectedIndex}`
                  : undefined
              }
              aria-label="Search"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="p-1 rounded-sm text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 hover:!text-[hsl(var(--foreground))] hover:!opacity-100 transition-opacity"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Filter bar */}
          <SearchFilterBar
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            counts={filterCounts}
          />

          {/* Results */}
          <div
            ref={listRef}
            id="cmd-k-listbox"
            className="max-h-[min(65vh,560px)] overflow-y-auto overscroll-contain p-2"
            role="listbox"
          >
            {!hasResults && (query.trim() || activeFilter !== 'all') ? (
              <p className="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
                {activeFilterLabel
                  ? `No ${activeFilterLabel} found`
                  : 'No results found'}
              </p>
            ) : (
              groups.map((group) => {
                const Icon = group.icon
                return (
                  <div key={`${group.type}-${group.label}`}>
                    <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] font-medium flex items-center gap-1.5">
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      {group.label}
                    </p>
                    {group.items.map((result) => {
                      const resultKey = `${result.item.type}-${result.item.entityId}`
                      const flatIndex = indexMap.get(resultKey) ?? 0
                      return (
                        <SearchResultItem
                          key={resultKey}
                          result={result}
                          isSelected={flatIndex === selectedIndex}
                          index={flatIndex}
                          onSelect={handleSelect}
                        />
                      )
                    })}
                  </div>
                )
              })
            )}
          </div>

          {/* Footer hints */}
          <div className="border-t border-[hsl(var(--border))] px-3 py-1.5 flex items-center gap-4 text-[10px] text-[hsl(var(--muted-foreground))]">
            <span className="flex items-center gap-1">
              <kbd className="font-mono">↑↓</kbd> Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-mono">↵</kbd> Open
            </span>
            <span className="flex items-center gap-1 ml-auto">
              <kbd className="font-mono">esc</kbd> Close
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
