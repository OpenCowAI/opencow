// SPDX-License-Identifier: Apache-2.0

/**
 * Check whether a keyboard event target is inside an editor (TipTap / Monaco / etc.).
 *
 * Use this to guard global keyboard shortcuts so they don't interfere with
 * normal text-editing behaviour (e.g. ArrowUp / ArrowDown moving a cursor).
 */
export function isInsideEditor(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  // Standard form controls
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true

  // TipTap / ProseMirror (contenteditable divs)
  if (target.isContentEditable) return true

  // Monaco editor (the focused element sits inside a .monaco-editor container)
  if (target.closest?.('.monaco-editor')) return true

  return false
}

/**
 * Check whether a keyboard event target is inside a modal dialog.
 *
 * Use this to guard global keyboard shortcuts (e.g. ArrowUp / ArrowDown list
 * navigation) so they don't fire when a dialog overlay is open.
 */
export function isInsideDialog(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest?.('[role="dialog"]') != null
}
