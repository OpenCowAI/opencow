// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'destructive' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  detail,
  confirmLabel: confirmLabelProp,
  cancelLabel: cancelLabelProp,
  variant = 'destructive',
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element | null {
  const { t } = useTranslation('common')
  const confirmLabel = confirmLabelProp ?? t('confirm')
  const cancelLabel = cancelLabelProp ?? t('cancel')
  const dialogRef = useRef<HTMLDivElement>(null)
  const { mounted, phase } = useModalAnimation(open)
  useBlockBrowserView('confirm-dialog', open)

  useEffect(() => {
    if (mounted) dialogRef.current?.focus()
  }, [mounted])

  // Focus trap: keep Tab cycling within dialog
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
        return
      }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [tabindex]:not([tabindex="-1"])'
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
    [onCancel]
  )

  if (!mounted) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overscroll-contain no-drag">
      <div
        className={cn(
          'absolute inset-0 bg-black/50 surface-backdrop-isolate',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit' && 'modal-overlay-exit'
        )}
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Shell */}
      <div
        className={cn(
          'relative z-10 w-full max-w-sm mx-4',
          phase === 'enter' && 'modal-content-enter',
          phase === 'exit' && 'modal-content-exit'
        )}
      >
        {/* Glass surface */}
        <div
          {...surfaceProps({ elevation: 'modal', color: 'card' })}
          className="absolute inset-0 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg pointer-events-none"
          aria-hidden="true"
        />

        {/* Content */}
        <div
          ref={dialogRef}
          role="alertdialog"
          aria-label={title}
          aria-modal="true"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className="relative rounded-2xl p-6 outline-none overscroll-contain"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className={cn(
                'h-5 w-5 shrink-0 mt-0.5',
                variant === 'destructive' ? 'text-red-500' : 'text-amber-500'
              )}
              aria-hidden="true"
            />
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{message}</p>
              {detail && (
                <p className="text-xs text-[hsl(var(--muted-foreground))] font-mono bg-[hsl(var(--muted)/0.3)] rounded px-2 py-1">
                  {detail}
                </p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              aria-label={cancelLabel}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                variant === 'destructive'
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90'
              )}
              aria-label={confirmLabel}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
