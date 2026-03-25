// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/appStore'
import { isInsideEditor, isInsideDialog } from '@/lib/domUtils'

interface UseListKeyboardNavOptions {
  /** The currently displayed list items (must have an `id` field). */
  items: { id: string }[]
  /** The currently selected item ID (null = nothing selected). */
  selectedId: string | null
  /** Callback invoked when a new item should be selected. */
  onSelect: (id: string) => void
  /**
   * Custom scroll-into-view strategy. When provided, this callback handles
   * scrolling entirely — `containerRef` is ignored.
   *
   * Use this for virtualized lists (e.g. react-virtuoso) where off-screen
   * items don't exist in the DOM and `querySelector` cannot find them.
   */
  scrollToItem?: (id: string, index: number) => void
  /**
   * Ref to the scrollable container — used as the default scroll strategy
   * via `querySelector('[data-item-id="…"]').scrollIntoView()`.
   *
   * Ignored when `scrollToItem` is provided.
   */
  containerRef?: React.RefObject<HTMLElement | null>
}

/**
 * Reusable hook that adds ArrowUp / ArrowDown keyboard navigation to a list.
 *
 * - Wraps around at both ends (last → first, first → last).
 * - Automatically scrolls the newly-selected item into view.
 * - Supports two scroll strategies: DOM querySelector (for standard lists)
 *   and custom callback (for virtualized lists like react-virtuoso).
 * - Skips events when focus is inside an input / textarea / select, or when the
 *   command palette is open.
 */
export function useListKeyboardNav({
  items,
  selectedId,
  onSelect,
  scrollToItem,
  containerRef
}: UseListKeyboardNavOptions): void {
  // Hold scrollToItem in a ref so the effect dependency array stays stable.
  // The callback identity may change on each render (inline arrow in caller),
  // but the latest version is always read from the ref inside the handler.
  const scrollToItemRef = useRef(scrollToItem)
  scrollToItemRef.current = scrollToItem

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return

      // Skip if user is interacting with an editor (input, textarea, contenteditable, Monaco, etc.)
      if (isInsideEditor(e.target)) return

      // Skip if focus is inside a modal dialog (e.g. DiffChangesDialog)
      if (isInsideDialog(e.target)) return

      // Skip if command palette is open
      if (useAppStore.getState().commandPaletteOpen) return

      // Nothing to navigate
      if (items.length === 0) return

      e.preventDefault()

      const currentIdx = selectedId ? items.findIndex((item) => item.id === selectedId) : -1

      let nextIdx: number
      if (e.key === 'ArrowUp') {
        nextIdx = currentIdx <= 0 ? items.length - 1 : currentIdx - 1
      } else {
        nextIdx = currentIdx >= items.length - 1 ? 0 : currentIdx + 1
      }

      const nextId = items[nextIdx].id
      onSelect(nextId)

      // Remove focus from the previously-clicked button so its focus ring
      // doesn't linger while the selection has moved to a different item.
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }

      // Scroll the newly selected item into view.
      // Two strategies: custom callback (virtualized lists) or DOM fallback.
      const customScroll = scrollToItemRef.current
      if (customScroll) {
        customScroll(nextId, nextIdx)
      } else {
        // DOM strategy: next tick so React has flushed the selection update
        requestAnimationFrame(() => {
          const container = containerRef?.current
          if (!container) return
          const el = container.querySelector(`[data-item-id="${nextId}"]`)
          el?.scrollIntoView({ block: 'nearest' })
        })
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [items, selectedId, onSelect, containerRef])
}
