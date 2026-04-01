// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'

type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl'

const SIZE_CLASSES: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl'
}

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  size?: DialogSize
  children: React.ReactNode
  className?: string
  /** When true, clicking the overlay does not close the dialog (Escape key still works). */
  preventOverlayClose?: boolean
}

/**
 * Dialog — modal overlay with glass-safe scroll architecture.
 *
 * The modal panel is split into two sibling layers:
 *   1. **Glass surface** — an absolutely-positioned, child-free `<div>` that
 *      carries `data-surface="modal"` (backdrop-filter in glass texture mode).
 *      Because it has no descendants, Chromium's GPU compositor never needs to
 *      re-render the blur when content inside the dialog scrolls.
 *   2. **Content layer** — a relatively-positioned `<div>` that holds
 *      `{children}`, keyboard handling, and ARIA attributes.  It has no
 *      `backdrop-filter`, so scroll repaints are handled by the normal
 *      fast-path compositor.
 *
 * The content layer declares `contain: paint` to establish an explicit paint
 * containment boundary.  Without it, scroll-driven paint events inside children
 * propagate up through the shell to the glass surface sibling, forcing Chromium
 * to re-evaluate the `backdrop-filter` blur and causing visible overlay flicker.
 *
 * This separation mirrors macOS NSVisualEffectView / Windows Acrylic, where
 * the blur effect lives on a dedicated compositing layer that is independent
 * of the content layer's paint lifecycle.
 */
export function Dialog({
  open,
  onClose,
  title,
  size = 'md',
  children,
  className,
  preventOverlayClose = false
}: DialogProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null)
  const blockerId = useId()
  const { mounted, phase } = useModalAnimation(open)

  // Automatically hide native WebContentsView while any Dialog is open.
  // This prevents the Electron native layer from obscuring the modal.
  useBlockBrowserView(`dialog-${blockerId}`, open)

  useEffect(() => {
    if (mounted) dialogRef.current?.focus()
  }, [mounted])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [onClose]
  )

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center overscroll-contain no-drag">
      {/* Overlay */}
      <div
        className={cn(
          'absolute inset-0 bg-black/50 surface-backdrop-isolate',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit' && 'modal-overlay-exit'
        )}
        onClick={preventOverlayClose ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Shell — sizing, positioning, animation */}
      <div
        className={cn(
          'relative z-10 w-full',
          SIZE_CLASSES[size],
          phase === 'enter' && 'modal-content-enter',
          phase === 'exit' && 'modal-content-exit',
          className
        )}
      >
        {/* Glass surface — visual decoration only, child-free.
            backdrop-filter lives here and is never invalidated by scroll repaints. */}
        <div
          {...surfaceProps({ elevation: 'modal', color: 'card' })}
          className="absolute inset-0 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg pointer-events-none"
          aria-hidden="true"
        />

        {/* Content layer — scroll-safe, paint-contained, no backdrop-filter.
            `contain: paint` prevents scroll-driven repaints from propagating to
            the sibling glass surface, which would trigger backdrop-filter
            re-evaluation and visible overlay flicker. */}
        <div
          ref={dialogRef}
          role="dialog"
          aria-label={title}
          aria-modal="true"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className={cn('relative rounded-2xl outline-none overscroll-contain [contain:paint]', className)}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
