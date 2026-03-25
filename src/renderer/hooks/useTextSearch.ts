// SPDX-License-Identifier: Apache-2.0

/**
 * useTextSearch — DOM text search with CSS Custom Highlight API.
 *
 * Performs case-insensitive text search within a scrollable container and
 * highlights all matches using the browser-native CSS Custom Highlight API.
 *
 * Design decisions:
 *
 * 1. **CSS Custom Highlight API over DOM mutation** — Highlights are applied
 *    via `CSS.highlights` + `::highlight()` pseudo-elements, never by injecting
 *    `<mark>` nodes.  This avoids conflicts with React's virtual DOM
 *    reconciliation and eliminates repaint/reflow from DOM manipulation.
 *
 * 2. **Cross-node matching** — Text nodes are collected in document order and
 *    concatenated into a single searchable string.  Matches that span multiple
 *    text nodes (e.g. across inline formatting: "Hello **World**") are handled
 *    correctly via multi-node Range objects.
 *
 * 3. **Debounced search** — A 150 ms debounce prevents excessive re-computation
 *    during rapid typing while still feeling instant.
 *
 * 4. **Graceful degradation** — If `CSS.highlights` is unavailable (non-Chromium
 *    environment), search still navigates to matches via scroll; highlighting
 *    is silently skipped.
 */

import { useState, useCallback, useEffect, useRef, type RefObject } from 'react'

// ─── Public types ────────────────────────────────────────────────────────────

export interface UseTextSearchConfig {
  /** Ref to the scrollable container holding rendered content. */
  containerRef: RefObject<HTMLElement | null>
}

export interface TextSearchState {
  /** Whether the search bar is currently visible. */
  isOpen: boolean
  /** Current search query string. */
  query: string
  /** Total number of matches found in the container. */
  matchCount: number
  /** 0-based index of the currently focused match. */
  currentIndex: number
}

export interface TextSearchActions {
  /** Show the search bar and focus the input.  Safe to call when already open — re-focuses and selects input. */
  open: () => void
  /** Hide the search bar, clear the query and all highlights. */
  close: () => void
  /** Update the search query (triggers debounced re-search). */
  setQuery: (query: string) => void
  /** Focus the next match (wraps around). */
  goToNext: () => void
  /** Focus the previous match (wraps around). */
  goToPrevious: () => void
}

export interface TextSearchReturn extends TextSearchState, TextSearchActions {
  /**
   * Ref to attach to the search `<input>` element.
   * Owned by the hook so `open()` can re-focus / select the input
   * when the user presses Ctrl/Cmd+F while the search bar is already visible.
   */
  searchInputRef: RefObject<HTMLInputElement | null>
}

// ─── CSS Highlight API constants ─────────────────────────────────────────────

/** Highlight name for all non-focused matches. */
const HIGHLIGHT_ALL = 'text-search-match'
/** Highlight name for the single focused/current match. */
const HIGHLIGHT_CURRENT = 'text-search-current'

/** Search debounce delay in milliseconds. */
const SEARCH_DEBOUNCE_MS = 150

// ─── Text node utilities ─────────────────────────────────────────────────────

interface TextNodeEntry {
  node: Text
  /** Character offset of this node's text within the concatenated string. */
  start: number
}

/**
 * Walk all text nodes inside `container` in document order and record
 * their cumulative character offset within the concatenated string.
 */
function collectTextNodes(container: HTMLElement): TextNodeEntry[] {
  const entries: TextNodeEntry[] = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let offset = 0
  let node: Node | null

  while ((node = walker.nextNode())) {
    const text = node as Text
    const len = text.textContent?.length ?? 0
    if (len > 0) {
      entries.push({ node: text, start: offset })
      offset += len
    }
  }

  return entries
}

/**
 * Binary search for the text node entry containing `offset`.
 */
function findNodeForOffset(
  entries: TextNodeEntry[],
  offset: number,
): { node: Text; localOffset: number } | null {
  let lo = 0
  let hi = entries.length - 1

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const entry = entries[mid]
    const entryEnd = entry.start + (entry.node.textContent?.length ?? 0)

    if (offset < entry.start) {
      hi = mid - 1
    } else if (offset >= entryEnd && mid < entries.length - 1) {
      lo = mid + 1
    } else {
      return { node: entry.node, localOffset: offset - entry.start }
    }
  }

  return null
}

/**
 * Create a DOM Range spanning from `matchStart` to `matchEnd` within
 * the concatenated text represented by `entries`.
 */
function createRange(
  entries: TextNodeEntry[],
  matchStart: number,
  matchEnd: number,
): Range | null {
  const startInfo = findNodeForOffset(entries, matchStart)
  const endInfo = findNodeForOffset(entries, matchEnd)
  if (!startInfo || !endInfo) return null

  try {
    const range = new Range()
    range.setStart(startInfo.node, startInfo.localOffset)
    range.setEnd(endInfo.node, endInfo.localOffset)
    return range
  } catch {
    // Range creation can fail if offsets are out of bounds
    // (e.g. during DOM mutation between search and highlight)
    return null
  }
}

/**
 * Find all case-insensitive occurrences of `query` within `container`'s
 * text content and return corresponding DOM Range objects.
 */
function findAllMatches(container: HTMLElement, query: string): Range[] {
  if (!query) return []

  const entries = collectTextNodes(container)
  if (entries.length === 0) return []

  const fullText = entries.map((e) => e.node.textContent ?? '').join('')
  const lowerText = fullText.toLowerCase()
  const lowerQuery = query.toLowerCase()

  if (lowerQuery.length === 0) return []

  const ranges: Range[] = []
  let searchFrom = 0

  while (searchFrom <= lowerText.length - lowerQuery.length) {
    const idx = lowerText.indexOf(lowerQuery, searchFrom)
    if (idx === -1) break

    const range = createRange(entries, idx, idx + lowerQuery.length)
    if (range) ranges.push(range)

    searchFrom = idx + 1
  }

  return ranges
}

// ─── Highlight helpers ───────────────────────────────────────────────────────

const supportsHighlightAPI = typeof CSS !== 'undefined' && 'highlights' in CSS

function clearHighlights(): void {
  if (!supportsHighlightAPI) return
  CSS.highlights!.delete(HIGHLIGHT_ALL)
  CSS.highlights!.delete(HIGHLIGHT_CURRENT)
}

function applyHighlights(ranges: Range[], activeIndex: number): void {
  if (!supportsHighlightAPI) return

  if (ranges.length === 0) {
    clearHighlights()
    return
  }

  // All matches (includes the current one — CSS specificity makes current's
  // style override the generic match style)
  CSS.highlights!.set(HIGHLIGHT_ALL, new Highlight(...ranges))

  // Current / focused match
  if (activeIndex >= 0 && activeIndex < ranges.length) {
    CSS.highlights!.set(HIGHLIGHT_CURRENT, new Highlight(ranges[activeIndex]))
  } else {
    CSS.highlights!.delete(HIGHLIGHT_CURRENT)
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTextSearch({ containerRef }: UseTextSearchConfig): TextSearchReturn {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQueryState] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [currentIndex, setCurrentIndex] = useState(0)

  // Ref for the search <input> — owned here so open() can re-focus it.
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Ranges stored in a ref to avoid re-rendering on every search update;
  // the derived `matchCount` state drives UI updates instead.
  const rangesRef = useRef<Range[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Ref mirror of currentIndex — guarantees immediate reads in callbacks
  // that may fire before React commits the batched state update.
  // (Dual-track pattern: ref for synchronous reads, state for UI re-renders.)
  const currentIndexRef = useRef(0)

  // ── Scroll current match into view ──────────────────────────────────────

  const scrollToMatch = useCallback(
    (index: number) => {
      const container = containerRef.current
      const range = rangesRef.current[index]
      if (!container || !range) return

      const rangeRect = range.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      // Already fully visible — no scroll needed
      const isVisible =
        rangeRect.top >= containerRect.top && rangeRect.bottom <= containerRect.bottom

      if (!isVisible) {
        // Center the match within the container's visible area
        const targetTop =
          rangeRect.top - containerRect.top + container.scrollTop - container.clientHeight / 3

        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        container.scrollTo({
          top: Math.max(0, targetTop),
          behavior: prefersReduced ? 'auto' : 'smooth',
        })
      }
    },
    [containerRef],
  )

  // ── Perform search (debounced) ──────────────────────────────────────────

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!isOpen || !query) {
      clearHighlights()
      rangesRef.current = []
      setMatchCount(0)
      currentIndexRef.current = 0
      setCurrentIndex(0)
      return
    }

    debounceRef.current = setTimeout(() => {
      const container = containerRef.current
      if (!container) return

      const ranges = findAllMatches(container, query)
      rangesRef.current = ranges
      setMatchCount(ranges.length)
      currentIndexRef.current = 0
      setCurrentIndex(0)
      applyHighlights(ranges, 0)

      if (ranges.length > 0) {
        scrollToMatch(0)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, isOpen, containerRef, scrollToMatch])

  // ── Clean up highlights on unmount ──────────────────────────────────────

  useEffect(() => {
    return () => clearHighlights()
  }, [])

  // ── Actions ─────────────────────────────────────────────────────────────

  const open = useCallback(() => {
    setIsOpen(true)
    // Re-focus and select the input text.  Works for both:
    //   1. Initial open: rAF fires after React commit → input is mounted → focus.
    //   2. Re-open (already visible): input exists → immediate focus + select.
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    setQueryState('')
    setMatchCount(0)
    currentIndexRef.current = 0
    setCurrentIndex(0)
    clearHighlights()
    rangesRef.current = []
  }, [])

  const setQuery = useCallback((q: string) => setQueryState(q), [])

  // goToNext / goToPrevious read from currentIndexRef (immediate) rather than
  // the currentIndex state (potentially stale during React's batched update).
  // This eliminates the stale-closure bug when the user navigates rapidly
  // (e.g. holding Enter) and also makes these callbacks stable — no dependency
  // on currentIndex means they are never recreated on index change.

  const goToNext = useCallback(() => {
    const ranges = rangesRef.current
    if (ranges.length === 0) return

    const next = (currentIndexRef.current + 1) % ranges.length
    currentIndexRef.current = next
    setCurrentIndex(next)
    applyHighlights(ranges, next)
    scrollToMatch(next)
  }, [scrollToMatch])

  const goToPrevious = useCallback(() => {
    const ranges = rangesRef.current
    if (ranges.length === 0) return

    const prev = (currentIndexRef.current - 1 + ranges.length) % ranges.length
    currentIndexRef.current = prev
    setCurrentIndex(prev)
    applyHighlights(ranges, prev)
    scrollToMatch(prev)
  }, [scrollToMatch])

  return {
    isOpen,
    query,
    matchCount,
    currentIndex,
    searchInputRef,
    open,
    close,
    setQuery,
    goToNext,
    goToPrevious,
  }
}
