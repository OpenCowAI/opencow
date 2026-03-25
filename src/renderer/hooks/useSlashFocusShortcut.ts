// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react'
import { isInsideEditor } from '../lib/domUtils'
import { getSessionInputFocus } from '../lib/sessionInputRegistry'
import { useAppStore } from '../stores/appStore'

// Re-export registry functions so existing imports (e.g. SessionInputBar)
// continue to work without updating every consumer at once.
// TODO: migrate all consumers to import directly from sessionInputRegistry.
export { registerSessionInputFocus, unregisterSessionInputFocus } from '../lib/sessionInputRegistry'

/* ------------------------------------------------------------------ */
/*  DOM helper                                                         */
/* ------------------------------------------------------------------ */

/**
 * Check if the event target is inside the Session Console input bar
 * (marked with `data-session-input`).
 */
function isInsideSessionInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return !!target.closest('[data-session-input]')
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

const DOUBLE_TAP_MS = 300

/**
 * Global keyboard shortcut: press `/` or `、` to focus the Session
 * Console input bar; double-press to also trigger slash command
 * suggestions.
 *
 * Flow:
 * - **Single press** (not inside any editor) → focus the session input.
 * - **Double press** → focus the session input AND open slash commands.
 *
 * For `/` double-press the natural flow is:
 *   1st press → focuses editor (global handler).
 *   2nd press → now inside editor → TipTap naturally handles `/` and
 *               opens the suggestion popup.
 *
 * For `、` double-press we need special handling because TipTap's
 * suggestion trigger is `/`, not `、`:
 *   1st press → focuses editor (global handler).
 *   2nd press → still `、`, inside session input → we intercept,
 *               preventDefault, and programmatically insert `/`.
 *
 * Guards:
 * - Skipped when focus is inside an editor/input (except the `、`
 *   double-tap case described above).
 * - Skipped when command palette is open.
 * - Skipped when modifier keys (Cmd/Ctrl/Alt) are held.
 */
export function useSlashFocusShortcut(): void {
  const lastPressRef = useRef(0)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== '/' && e.key !== '、') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (useAppStore.getState().commandPaletteOpen) return

      const now = Date.now()
      const isDoubleTap = now - lastPressRef.current < DOUBLE_TAP_MS
      const callbacks = getSessionInputFocus()

      if (isInsideEditor(e.target)) {
        // Already inside an editor.  Only intercept double-tap of `、`
        // inside the session input — convert it to `/` so the TipTap
        // slash command suggestion triggers.
        if (e.key === '、' && isDoubleTap && isInsideSessionInput(e.target)) {
          e.preventDefault()
          lastPressRef.current = 0
          callbacks?.focusWithSlash()
        } else {
          // Record timestamp for cross-focus double-tap detection.
          lastPressRef.current = now
        }
        return
      }

      // Not inside any editor — focus the session input.
      e.preventDefault()
      lastPressRef.current = now

      if (isDoubleTap) {
        callbacks?.focusWithSlash()
        lastPressRef.current = 0
      } else {
        callbacks?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])
}
