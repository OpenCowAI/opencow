// SPDX-License-Identifier: Apache-2.0

/**
 * Session Input Focus Registry
 *
 * A lightweight module-level registry that lets SessionInputBar expose its
 * editor focus callbacks to any consumer (keyboard shortcuts, etc.) without
 * prop drilling or React context wiring.
 *
 * Lifecycle:
 *   - SessionInputBar registers on mount via `registerSessionInputFocus`.
 *   - SessionInputBar unregisters on unmount via `unregisterSessionInputFocus`.
 *   - Consumers query `getSessionInputFocus` / `isSessionInputMounted`.
 */

type FocusFn = () => void

interface SessionInputFocusCallbacks {
  /** Focus the editor (no text inserted). */
  focus: FocusFn
  /** Focus the editor AND insert `/` to trigger slash command suggestion. */
  focusWithSlash: FocusFn
}

let registered: SessionInputFocusCallbacks | null = null

/**
 * Register focus callbacks from SessionInputBar.
 *
 * @param focus       Focus the editor (no text inserted).
 * @param focusSlash  Focus the editor AND insert `/` to trigger slash command.
 */
export function registerSessionInputFocus(focus: FocusFn, focusSlash: FocusFn): void {
  registered = { focus, focusWithSlash: focusSlash }
}

/** Unregister (call on SessionInputBar unmount). */
export function unregisterSessionInputFocus(): void {
  registered = null
}

/**
 * Return the currently registered focus callbacks, or `null` if no
 * SessionInputBar is mounted.
 */
export function getSessionInputFocus(): SessionInputFocusCallbacks | null {
  return registered
}

/** Whether a SessionInputBar is currently mounted and registered. */
export function isSessionInputMounted(): boolean {
  return registered !== null
}
