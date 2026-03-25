// SPDX-License-Identifier: Apache-2.0

/**
 * TextSearchBar + SearchTrigger — in-content search UI surface.
 *
 * Two visual states, same absolute top-right position:
 *
 *   Idle (search closed):
 *   ┌───────────────┐
 *   │  🔍  ⌘F       │   ← subtle icon + shortcut badge; click to open
 *   └───────────────┘
 *
 *   Active (search open):
 *   ┌──────────────────────────────────────────────────────┐
 *   │  🔍  [ search query       ]   3 of 12  [↑] [↓] [✕] │
 *   └──────────────────────────────────────────────────────┘
 *
 * The `SearchTrigger` provides feature discoverability — users see the icon
 * and shortcut hint without needing to guess Ctrl/Cmd+F.
 *
 * All search logic lives in the `useTextSearch` hook; these components are
 * purely presentational.
 *
 * Focus management:
 *   The search `<input>` ref is owned by the hook (`search.searchInputRef`)
 *   so the hook's `open()` can re-focus the input when the user presses
 *   Ctrl/Cmd+F while the search bar is already visible.
 *
 * Keyboard bindings (when search bar is active):
 *   Enter       → next match
 *   Shift+Enter → previous match
 *   Escape      → close search
 */

import { memo, useCallback } from 'react'
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TextSearchReturn } from '@/hooks/useTextSearch'

// ─── Platform-aware shortcut label ───────────────────────────────────────────

const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const SHORTCUT_LABEL = IS_MAC ? '⌘F' : 'Ctrl+F'

// ─── SearchTrigger — idle state icon button ──────────────────────────────────

interface SearchTriggerProps {
  onOpen: () => void
  className?: string
}

/**
 * Compact search icon button visible when the search bar is closed.
 * Shows the keyboard shortcut badge for discoverability.
 */
export const SearchTrigger = memo(function SearchTrigger({
  onOpen,
  className,
}: SearchTriggerProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        // Positioning: same top-right slot as TextSearchBar
        'absolute top-2 right-4 z-20',
        // Visual: ghost button, becomes visible on hover
        'flex items-center gap-1.5 px-2 py-1 rounded-lg',
        'text-[hsl(var(--muted-foreground)/0.4)]',
        'hover:text-[hsl(var(--muted-foreground))]',
        'hover:bg-[hsl(var(--foreground)/0.04)]',
        'transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
        className,
      )}
      aria-label={`Search in document (${SHORTCUT_LABEL})`}
      title={`Search (${SHORTCUT_LABEL})`}
    >
      <Search className="w-3.5 h-3.5" aria-hidden="true" />
      <kbd
        className={cn(
          'text-[10px] font-mono leading-none',
          'px-1 py-0.5 rounded',
          'border border-[hsl(var(--border)/0.5)]',
          'bg-[hsl(var(--muted)/0.3)]',
          'select-none pointer-events-none',
        )}
      >
        {SHORTCUT_LABEL}
      </kbd>
    </button>
  )
})

// ─── TextSearchBar — active state search input ───────────────────────────────

interface TextSearchBarProps {
  search: TextSearchReturn
  className?: string
}

export const TextSearchBar = memo(function TextSearchBar({
  search,
  className,
}: TextSearchBarProps): React.JSX.Element {
  // ── Keyboard handling ───────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        search.close()
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) {
          search.goToPrevious()
        } else {
          search.goToNext()
        }
      }
    },
    [search.close, search.goToNext, search.goToPrevious],
  )

  // ── Match counter text ──────────────────────────────────────────────────

  const hasQuery = search.query.length > 0
  const counterText = hasQuery
    ? search.matchCount > 0
      ? `${search.currentIndex + 1} / ${search.matchCount}`
      : 'No results'
    : null

  return (
    <div
      className={cn(
        // Positioning: absolute top-right with slight offset
        'absolute top-2 right-4 z-20',
        // Visual style: glass card with border
        'flex items-center gap-1 px-2 py-1.5 rounded-lg',
        'bg-[hsl(var(--card)/0.95)] backdrop-blur-sm',
        'border border-[hsl(var(--border))]',
        'shadow-md',
        // Entrance animation
        'search-bar-enter',
        className,
      )}
      role="search"
      aria-label="Search in document"
    >
      {/* Search icon */}
      <Search
        className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]"
        aria-hidden="true"
      />

      {/* Search input — ref owned by useTextSearch for focus management */}
      <input
        ref={search.searchInputRef}
        type="text"
        value={search.query}
        onChange={(e) => search.setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search…"
        className={cn(
          'w-40 px-1.5 py-0.5 text-xs bg-transparent outline-none',
          'text-[hsl(var(--foreground))]',
          'placeholder:text-[hsl(var(--muted-foreground)/0.5)]',
        )}
        aria-label="Search text"
        spellCheck={false}
        autoComplete="off"
      />

      {/* Match counter */}
      {counterText && (
        <span
          className={cn(
            'text-[11px] tabular-nums whitespace-nowrap shrink-0 px-1',
            search.matchCount > 0
              ? 'text-[hsl(var(--muted-foreground))]'
              : 'text-[hsl(var(--destructive)/0.7)]',
          )}
          aria-live="polite"
          aria-atomic="true"
        >
          {counterText}
        </span>
      )}

      {/* Navigation buttons */}
      <NavButton
        onClick={search.goToPrevious}
        disabled={search.matchCount === 0}
        label="Previous match (Shift+Enter)"
        icon={<ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />}
      />
      <NavButton
        onClick={search.goToNext}
        disabled={search.matchCount === 0}
        label="Next match (Enter)"
        icon={<ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
      />

      {/* Close button */}
      <NavButton
        onClick={search.close}
        disabled={false}
        label="Close search (Escape)"
        icon={<X className="w-3.5 h-3.5" aria-hidden="true" />}
      />
    </div>
  )
})

// ─── NavButton — small icon button for search bar actions ────────────────────

interface NavButtonProps {
  onClick: () => void
  disabled: boolean
  label: string
  icon: React.ReactNode
}

const NavButton = memo(function NavButton({
  onClick,
  disabled,
  label,
  icon,
}: NavButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'p-0.5 rounded transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
        disabled
          ? 'text-[hsl(var(--muted-foreground)/0.3)] cursor-not-allowed'
          : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.06)]',
      )}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  )
})
