// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
import { isInsideEditor } from '../lib/domUtils'
import { isSessionInputMounted } from '../lib/sessionInputRegistry'
import { useAppStore } from '../stores/appStore'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface UseIssueShortcutsConfig {
  /** Called when Cmd+N / Ctrl+N is pressed to create a new issue. */
  onCreateIssue: () => void
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Keyboard shortcuts for the Issues list view.
 *
 * This hook is intended to be mounted inside `IssuesView` — it is only
 * active while the Issues tab is rendered, so no explicit tab-check is
 * needed.
 *
 * Shortcuts:
 * | Keys             | Action              |
 * |------------------|---------------------|
 * | `Cmd+N / Ctrl+N` | Create a new issue  |
 *
 * Guards (shortcut is suppressed when any of these are true):
 * - Focus is inside an editor / input / textarea / contenteditable.
 * - Command palette is open.
 * - Session Console input bar is mounted (user is in a session context).
 */
export function useIssueShortcuts({ onCreateIssue }: UseIssueShortcutsConfig): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Only handle Cmd+N (macOS) / Ctrl+N (Windows/Linux)
      if (e.key !== 'n' && e.key !== 'N') return
      if (!(e.metaKey || e.ctrlKey)) return
      // Ignore if other modifiers are held (Shift, Alt)
      if (e.shiftKey || e.altKey) return

      // Guard: skip if inside an editor (input, textarea, contenteditable, Monaco)
      if (isInsideEditor(e.target)) return

      // Guard: skip if command palette is open
      if (useAppStore.getState().commandPaletteOpen) return

      // Guard: skip if Session Console input bar is visible
      if (isSessionInputMounted()) return

      e.preventDefault()
      onCreateIssue()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCreateIssue])
}
