// SPDX-License-Identifier: Apache-2.0

import { create } from 'zustand'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: string
  message: string
  action?: ToastAction
}

interface ToastStore {
  toasts: ToastItem[]
  /** IDs of toasts currently playing exit animation */
  exitingIds: ReadonlySet<string>
  add: (item: ToastItem) => void
  dismiss: (id: string) => void
}

// ─── Store ──────────────────────────────────────────────────────────────────

/** Duration of the toast exit animation (must match CSS `.toast-exit`). */
const EXIT_DURATION = 150

const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  exitingIds: new Set<string>(),
  add: (item) => set((s) => ({ toasts: [...s.toasts, item] })),
  dismiss: (id) => {
    const { exitingIds, toasts } = get()
    // Skip if already exiting or not found
    if (exitingIds.has(id) || !toasts.some((t) => t.id === id)) return

    // Mark as exiting (triggers CSS exit animation)
    set({ exitingIds: new Set([...exitingIds, id]) })

    // Actually remove after animation completes
    setTimeout(() => {
      set((s) => ({
        toasts: s.toasts.filter((t) => t.id !== id),
        exitingIds: new Set([...s.exitingIds].filter((eid) => eid !== id)),
      }))
    }, EXIT_DURATION)
  },
}))

// ─── Public API ─────────────────────────────────────────────────────────────

let counter = 0

/**
 * Show a non-blocking toast notification.
 * Auto-dismisses after `duration` ms (default 3 000).
 */
export function toast(
  message: string,
  options?: { action?: ToastAction; duration?: number },
): void {
  const id = `toast-${++counter}-${Date.now()}`
  const duration = options?.duration ?? 3000

  useToastStore.getState().add({ id, message, action: options?.action })

  setTimeout(() => {
    useToastStore.getState().dismiss(id)
  }, duration)
}

/** Hook consumed by the Toaster component. */
export { useToastStore }
