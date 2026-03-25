// SPDX-License-Identifier: Apache-2.0

import { useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'
import { MarketView } from './MarketView'

interface MarketDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * Skills Market dialog — a near-fullscreen overlay that wraps MarketView.
 * Opens from the Capabilities sidebar, giving a browsing experience
 * without leaving the current context.
 */
export function MarketDialog({ open, onClose }: MarketDialogProps): React.JSX.Element | null {
  const { mounted, phase } = useModalAnimation(open)
  useBlockBrowserView('market-dialog', open)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    },
    [onClose],
  )

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center overscroll-contain no-drag">
      {/* Overlay */}
      <div
        className={cn(
          'absolute inset-0 bg-black/50 surface-backdrop-isolate',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit' && 'modal-overlay-exit',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog shell — large, near-fullscreen */}
      <div
        className={cn(
          'relative z-10 w-[min(960px,calc(100vw-48px))] h-[min(720px,calc(100vh-48px))]',
          phase === 'enter' && 'modal-content-enter',
          phase === 'exit' && 'modal-content-exit',
        )}
      >
        {/* Glass surface */}
        <div
          {...surfaceProps({ elevation: 'modal', color: 'card' })}
          className="absolute inset-0 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl pointer-events-none"
          aria-hidden="true"
        />

        {/* Content layer */}
        <div
          role="dialog"
          aria-label="Skills Market"
          aria-modal="true"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className="relative flex flex-col h-full rounded-2xl outline-none overscroll-contain overflow-hidden"
        >
          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'absolute top-3 right-3 z-10 p-1.5 rounded-lg transition-colors',
              'text-[hsl(var(--muted-foreground)/0.5)] hover:text-[hsl(var(--foreground))]',
              'hover:bg-[hsl(var(--foreground)/0.05)]',
              'outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
            )}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          {/* MarketView fills the dialog */}
          <MarketView />
        </div>
      </div>
    </div>,
    document.body,
  )
}
