// SPDX-License-Identifier: Apache-2.0

/**
 * WindowManager — Centralised main-window lifecycle management.
 *
 * Every part of the application that needs to access, focus, or query the main
 * BrowserWindow MUST go through this module.  This eliminates the duplicated
 * `BrowserWindow.getAllWindows().find(…)` pattern that was scattered across
 * main.ts, tray.ts, and service files — a pattern that already caused one
 * ReferenceError and one latent popover-targeting bug.
 *
 * Design:
 *   - Module-private reference (`mainWindow`) — never leaked directly.
 *   - `setMainWindow()` is called exactly once per window lifecycle (from
 *     `createWindow()` in main.ts).  A `closed` listener auto-clears the ref.
 *   - Pure functions with zero side-effects beyond Electron window APIs.
 */

import { BrowserWindow, app } from 'electron'

// ── Private state ───────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Register the main window reference.
 *
 * Must be called exactly once after a new BrowserWindow is created.
 * Automatically clears the reference when the window emits `closed`.
 */
export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
  win.on('closed', () => {
    mainWindow = null
  })
}

/**
 * Retrieve the main window if it exists and has not been destroyed.
 *
 * @returns The main BrowserWindow, or `null`.
 */
export function getMainWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  return null
}

/**
 * Bring the main window to the foreground.
 *
 * Cross-platform:
 *   - macOS: `app.focus({ steal: true })` to activate via the Dock.
 *   - All platforms: restore from minimised state, show, and focus.
 */
export function focusMainWindow(): void {
  if (process.platform === 'darwin') app.focus({ steal: true })

  const win = getMainWindow()
  if (!win) return

  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
