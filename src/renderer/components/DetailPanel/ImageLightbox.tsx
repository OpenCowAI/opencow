// SPDX-License-Identifier: Apache-2.0

import { useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useExitAnimation } from '@/hooks/useModalAnimation'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'

interface ImageLightboxProps {
  src: string
  alt: string
  onClose: () => void
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps): React.JSX.Element {
  const { phase, requestClose } = useExitAnimation(onClose)
  useBlockBrowserView('image-lightbox', true)
  const rootRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  const handleEscape = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      requestClose()
    },
    [requestClose]
  )

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    rootRef.current?.focus()

    // Capture-phase listener guarantees Esc is consumed by the lightbox first,
    // preventing parent dialogs/panels from also handling it.
    document.addEventListener('keydown', handleEscape, true)
    return () => {
      document.removeEventListener('keydown', handleEscape, true)
      previouslyFocusedRef.current?.focus?.()
    }
  }, [handleEscape])

  // Use portal to render at document.body level so the lightbox is never
  // clipped or constrained by ancestor CSS containment (content-visibility,
  // contain, transform, will-change, etc.).
  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100] flex items-center justify-center overscroll-contain no-drag"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      tabIndex={-1}
    >
      <div
        className={cn(
          'absolute inset-0 bg-black/70',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit' && 'modal-overlay-exit'
        )}
        onClick={requestClose}
        aria-hidden="true"
      />

      <button
        className={cn(
          'absolute top-4 right-4 z-20 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors',
          phase === 'enter' && 'modal-content-enter',
          phase === 'exit' && 'modal-content-exit'
        )}
        onClick={requestClose}
        aria-label="Close image"
      >
        <X className="h-5 w-5" />
      </button>

      <img
        src={src}
        alt={alt}
        className={cn(
          'relative z-10 max-w-[90vw] max-h-[90vh] object-contain rounded-lg',
          phase === 'enter' && 'modal-content-enter',
          phase === 'exit' && 'modal-content-exit'
        )}
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  )
}
