// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/appStore'
import { isInsideEditor } from '@/lib/domUtils'

// ── Types ──────────────────────────────────────────────────────────

interface UseFocusableListNavOptions {
  /**
   * Flat, ordered list of unique item keys representing the navigable items
   * in their display order.
   */
  keys: string[]

  /**
   * Called when the focused item is activated via Enter or Space.
   * Receives the key of the activated item.
   */
  onActivate?: (key: string) => void

  /** Ref to the scrollable container used for auto-scroll on focus change. */
  containerRef: React.RefObject<HTMLElement | null>

  /**
   * DOM data-attribute name used to locate item elements for scrolling
   * and focus management. Each navigable item must render this attribute
   * with its key as value.
   *
   * @default 'data-nav-key'
   */
  itemAttribute?: string
}

interface UseFocusableListNavReturn {
  /** Currently focused item key (null = no explicit focus). */
  focusedKey: string | null

  /** Imperatively set the focused key (e.g. on mouse click). */
  setFocusedKey: (key: string | null) => void

  /**
   * Keyboard event handler — attach to the navigable container's `onKeyDown`.
   *
   * Handles: ArrowUp, ArrowDown, Home, End, Enter, Space.
   * Uses React event bubbling so it fires when any child has focus.
   */
  handleKeyDown: (e: React.KeyboardEvent) => void

  /**
   * Compute the correct `tabIndex` for a given item key.
   *
   * Implements the WAI-ARIA roving tabindex pattern:
   * - Focused item → `0`
   * - No explicit focus → first item gets `0`
   * - All others → `-1`
   */
  getTabIndex: (key: string) => 0 | -1
}

// ── Hook ───────────────────────────────────────────────────────────

/**
 * Generic, container-scoped keyboard navigation hook for focusable lists.
 *
 * Provides the WAI-ARIA roving tabindex pattern with:
 * - **ArrowUp / ArrowDown** — navigate between items (stops at boundaries)
 * - **Home / End** — jump to first / last item
 * - **Enter / Space** — activate focused item
 * - **Auto-scroll** — scrolls the focused item into view
 * - **DOM focus management** — moves DOM focus to the focused element
 *
 * Designed to be composable: tree views can intercept additional keys
 * (e.g. ArrowLeft/Right) before delegating to `handleKeyDown`.
 */
export function useFocusableListNav({
  keys,
  onActivate,
  containerRef,
  itemAttribute = 'data-nav-key'
}: UseFocusableListNavOptions): UseFocusableListNavReturn {
  const [focusedKey, setFocusedKey] = useState<string | null>(null)

  // Use refs for callbacks to keep handleKeyDown identity stable
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate

  // If focusedKey no longer exists in the keys list (e.g. parent collapsed
  // hiding a child node), treat as "no explicit focus".
  const resolvedKey =
    focusedKey !== null && keys.includes(focusedKey) ? focusedKey : null

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Don't intercept typing inside editors / inputs
      if (isInsideEditor(e.target)) return

      // Don't interfere with the command palette
      if (useAppStore.getState().commandPaletteOpen) return

      if (keys.length === 0) return

      const currentIdx =
        resolvedKey !== null ? keys.indexOf(resolvedKey) : -1

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          if (currentIdx < 0) {
            // Nothing focused → focus first
            setFocusedKey(keys[0])
          } else if (currentIdx < keys.length - 1) {
            setFocusedKey(keys[currentIdx + 1])
          }
          // At last item → stop (no wrap)
          break
        }

        case 'ArrowUp': {
          e.preventDefault()
          if (currentIdx < 0) {
            // Nothing focused → focus last
            setFocusedKey(keys[keys.length - 1])
          } else if (currentIdx > 0) {
            setFocusedKey(keys[currentIdx - 1])
          }
          // At first item → stop (no wrap)
          break
        }

        case 'Home': {
          e.preventDefault()
          setFocusedKey(keys[0])
          break
        }

        case 'End': {
          e.preventDefault()
          setFocusedKey(keys[keys.length - 1])
          break
        }

        case 'Enter':
        case ' ': {
          if (resolvedKey !== null) {
            e.preventDefault()
            onActivateRef.current?.(resolvedKey)
          }
          break
        }
        // All other keys are intentionally ignored — consumers can
        // intercept them before calling this handler.
      }
    },
    [keys, resolvedKey]
  )

  // Auto-scroll & transfer DOM focus when the focused key changes
  useEffect(() => {
    if (resolvedKey === null) return
    requestAnimationFrame(() => {
      const container = containerRef.current
      if (!container) return
      const el = container.querySelector(
        `[${itemAttribute}="${CSS.escape(resolvedKey)}"]`
      )
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: 'nearest' })
        el.focus({ preventScroll: true })
      }
    })
  }, [resolvedKey, containerRef, itemAttribute])

  const getTabIndex = useCallback(
    (key: string): 0 | -1 => {
      if (resolvedKey !== null) {
        return key === resolvedKey ? 0 : -1
      }
      // No explicit focus → first item is Tab-reachable
      return keys.length > 0 && key === keys[0] ? 0 : -1
    },
    [keys, resolvedKey]
  )

  return { focusedKey: resolvedKey, setFocusedKey, handleKeyDown, getTabIndex }
}
