// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X, Clock } from 'lucide-react'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { useRecentSearches } from '@/hooks/useRecentSearches'
import { useCapabilitySearch, type SearchFlatItem } from '@/hooks/useCapabilitySearch'
import type {
  CapabilityEntryBase,
  CapabilityIdentifier,
  CapabilityCategory,
} from '@shared/types'

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface CapabilitySearchOverlayProps {
  open: boolean
  onClose: () => void
  /** Pre-computed per-category entries — parent owns the data source. */
  entriesByCategory: Record<string, CapabilityEntryBase[]>
  /** Called with a CapabilityIdentifier — parent handles navigation. */
  onSelect: (identifier: CapabilityIdentifier) => void
  /** Called to switch the active category tab in the sidebar. */
  onNavigateCategory: (categoryId: CapabilityCategory) => void
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function CapabilitySearchOverlay({
  open,
  onClose,
  entriesByCategory,
  onSelect,
  onNavigateCategory,
}: CapabilitySearchOverlayProps): React.JSX.Element | null {
  const { t } = useTranslation('sessions')
  useBlockBrowserView('capability-search-overlay', open)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const { mounted, phase } = useModalAnimation(open)

  // ── Recent searches ──────────────────────────────────────────────
  const { recentSearches, addRecent, clearRecent } = useRecentSearches()

  // ── Search results ───────────────────────────────────────────────
  const { grouped, flatItems, hasResults } = useCapabilitySearch(
    query,
    entriesByCategory,
  )

  const q = query.trim()

  // ── Reset state on open ─────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [open])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [flatItems.length])

  // ── Scroll selected item into view ───────────────────────────────
  useEffect(() => {
    if (!listRef.current) return
    const selected = listRef.current.querySelector('[data-selected="true"]')
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // ── Handlers ─────────────────────────────────────────────────────

  const handleSelectItem = useCallback(
    (item: SearchFlatItem) => {
      addRecent(query.trim())

      const identifier: CapabilityIdentifier = {
        category: item.config.id,
        name: item.entry.name,
        source: item.entry.source,
      }

      onNavigateCategory(item.config.id)
      onSelect(identifier)
      onClose()
    },
    [query, addRecent, onNavigateCategory, onSelect, onClose],
  )

  const handleRecentClick = useCallback(
    (text: string) => {
      setQuery(text)
    },
    [],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (q && flatItems.length > 0) {
          setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1))
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (q && flatItems.length > 0) {
          setSelectedIndex((i) => Math.max(i - 1, 0))
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (q && flatItems[selectedIndex]) {
          handleSelectItem(flatItems[selectedIndex])
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [q, flatItems, selectedIndex, handleSelectItem, onClose],
  )

  // ── Show recent searches or results ──────────────────────────────

  const showRecent = !q && recentSearches.length > 0

  // ── Render ───────────────────────────────────────────────────────

  if (!mounted) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] overscroll-contain no-drag">
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-black/50 surface-backdrop-isolate',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit' && 'modal-overlay-exit',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Shell */}
      <div
        className={cn(
          'relative z-10 w-full max-w-lg',
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
          aria-label={t('capabilityCenter.searchOverlay.ariaLabel', 'Search capabilities')}
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
              placeholder={t('capabilityCenter.searchOverlay.placeholder', 'Search capabilities...')}
              className="flex-1 h-11 px-3 text-sm bg-transparent outline-none placeholder:text-[hsl(var(--muted-foreground))]"
              aria-label={t('capabilityCenter.searchOverlay.ariaLabel', 'Search capabilities')}
              autoFocus
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="p-1 rounded-sm text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 hover:!text-[hsl(var(--foreground))] hover:!opacity-100 transition-opacity"
                aria-label={t('common:clearSearch', 'Clear')}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Results area */}
          <div
            ref={listRef}
            className="max-h-80 overflow-y-auto overscroll-contain p-2"
            role="listbox"
          >
            {showRecent ? (
              /* ── Recent searches ── */
              <div>
                <div className="flex items-center justify-between px-2 py-1">
                  <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] font-medium flex items-center gap-1.5">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {t('capabilityCenter.searchOverlay.recentSearches', 'Recent')}
                  </p>
                  <button
                    onClick={clearRecent}
                    className="text-[10px] text-[hsl(var(--muted-foreground)/0.6)] hover:text-[hsl(var(--foreground))] transition-colors"
                  >
                    {t('capabilityCenter.searchOverlay.clearRecent', 'Clear')}
                  </button>
                </div>
                {recentSearches.map((text) => (
                  <button
                    key={text}
                    className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-left text-[hsl(var(--foreground)/0.8)] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
                    onClick={() => handleRecentClick(text)}
                    role="option"
                    aria-selected={false}
                  >
                    <Search className="h-3 w-3 text-[hsl(var(--muted-foreground)/0.4)] shrink-0" aria-hidden="true" />
                    <span className="truncate">{text}</span>
                  </button>
                ))}
              </div>
            ) : q && !hasResults ? (
              /* ── No results ── */
              <p className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
                {t('capabilityCenter.searchOverlay.noResults', { query, defaultValue: `No results for "${query}"` })}
              </p>
            ) : q ? (
              /* ── Grouped results ── */
              grouped.map((groupResult) =>
                groupResult.categories.map((catResult) => {
                  const Icon = catResult.config.icon
                  return (
                    <div key={catResult.config.id}>
                      {/* Category header */}
                      <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] font-medium flex items-center gap-1.5">
                        <Icon className={cn('h-3 w-3', catResult.config.textColor)} aria-hidden="true" />
                        {t(`capabilityCenter.categories.${catResult.config.titleKey}`)}
                      </p>

                      {/* Items — use pre-computed index from flatItems */}
                      {catResult.items.map((entry) => {
                        const flatItem = flatItems.find(
                          (fi) => fi.config.id === catResult.config.id && fi.entry === entry,
                        )
                        const isSelected = flatItem ? flatItem.index === selectedIndex : false
                        return (
                          <button
                            key={`${catResult.config.id}:${entry.source.scope}:${entry.name}`}
                            className={cn(
                              'w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors text-left',
                              isSelected
                                ? 'bg-[hsl(var(--primary)/0.08)]'
                                : 'hover:bg-[hsl(var(--foreground)/0.04)]',
                            )}
                            onClick={() =>
                              flatItem && handleSelectItem(flatItem)
                            }
                            role="option"
                            aria-selected={isSelected}
                            data-selected={isSelected}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[hsl(var(--foreground))]">
                                {entry.name}
                              </div>
                              {entry.description && (
                                <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                                  {entry.description}
                                </div>
                              )}
                            </div>
                            {/* Scope badge */}
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md shrink-0 bg-[hsl(var(--muted)/0.5)] text-[hsl(var(--muted-foreground)/0.6)]">
                              {entry.source.scope === 'project' ? 'Project' : 'User'}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )
                }),
              )
            ) : (
              /* ── Empty state (no recent, no query) ── */
              <p className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
                {t('capabilityCenter.searchOverlay.placeholder', 'Search capabilities...')}
              </p>
            )}
          </div>

          {/* Footer hint */}
          {q && hasResults && (
            <div className="border-t border-[hsl(var(--border))] px-3 py-1.5 flex items-center gap-3 text-[10px] text-[hsl(var(--muted-foreground)/0.5)]">
              <span><kbd className="px-1 py-0.5 rounded border border-[hsl(var(--border)/0.5)] text-[9px]">&uarr;&darr;</kbd> navigate</span>
              <span><kbd className="px-1 py-0.5 rounded border border-[hsl(var(--border)/0.5)] text-[9px]">Enter</kbd> open</span>
              <span><kbd className="px-1 py-0.5 rounded border border-[hsl(var(--border)/0.5)] text-[9px]">Esc</kbd> close</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
