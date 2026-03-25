// SPDX-License-Identifier: Apache-2.0

import { memo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useToastStore } from '@/lib/toast'
import type { ToastItem } from '@/lib/toast'

// ─── Single toast ───────────────────────────────────────────────────────────

const ToastCard = memo(function ToastCard({
  item,
  isExiting,
  onDismiss,
}: {
  item: ToastItem
  isExiting: boolean
  onDismiss: (id: string) => void
}): React.JSX.Element {
  const handleAction = useCallback(() => {
    item.action?.onClick()
    onDismiss(item.id)
  }, [item, onDismiss])

  return (
    <div
      {...surfaceProps({ elevation: 'overlay', color: 'popover' })}
      className={cn(
        'flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg shadow-lg border',
        'bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] border-[hsl(var(--border))]',
        isExiting ? 'toast-exit' : 'toast-enter',
      )}
      role="status"
      aria-live="polite"
    >
      <span className="text-sm">{item.message}</span>

      {item.action && (
        <button
          onClick={handleAction}
          className="shrink-0 text-xs font-medium text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-1"
        >
          {item.action.label}
        </button>
      )}

      <button
        onClick={() => onDismiss(item.id)}
        className="shrink-0 p-0.5 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
        aria-label="Dismiss"
      >
        <X className="w-3 h-3" aria-hidden="true" />
      </button>
    </div>
  )
})

// ─── Container ──────────────────────────────────────────────────────────────

/**
 * Renders active toasts at the bottom-center of the viewport via Portal.
 * Mount once at the app root level (e.g. App.tsx).
 */
export function Toaster(): React.JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts)
  const exitingIds = useToastStore((s) => s.exitingIds)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return createPortal(
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-auto"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} isExiting={exitingIds.has(t.id)} onDismiss={dismiss} />
      ))}
    </div>,
    document.body,
  )
}
