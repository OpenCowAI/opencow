// SPDX-License-Identifier: Apache-2.0

/**
 * Chat Input Focus Registry
 *
 * Stores focus callbacks for the Chat tab's active input so callers outside
 * the input tree (e.g. MainPanel tab switch effects) can request focus
 * without prop drilling.
 */

type FocusFn = () => void

interface ChatInputFocusCallbacks {
  /** Focus the input editor. */
  focus: FocusFn
}

let registered: ChatInputFocusCallbacks | null = null

/** Register the current Chat input focus callback. */
export function registerChatInputFocus(focus: FocusFn): void {
  registered = { focus }
}

/**
 * Unregister only when the caller still owns the current callback.
 * This prevents stale unmount cleanups from clearing a newer registration.
 */
export function unregisterChatInputFocus(focus: FocusFn): void {
  if (registered?.focus === focus) {
    registered = null
  }
}

/** Return current Chat input focus callbacks, or null when unavailable. */
export function getChatInputFocus(): ChatInputFocusCallbacks | null {
  return registered
}
