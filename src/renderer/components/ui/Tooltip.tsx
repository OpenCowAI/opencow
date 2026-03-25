// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'
import { surfaceProps } from '../../lib/surface'
import { useModalAnimation } from '@/hooks/useModalAnimation'

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right'
type TooltipAlign = 'start' | 'center' | 'end'

interface TooltipProps {
  /** Tooltip text — accepts a string or multi-line ReactNode. */
  content: React.ReactNode
  children: React.ReactNode
  /** Placement relative to the trigger element. @default 'bottom' */
  position?: TooltipPosition
  /** Horizontal alignment relative to the trigger. @default 'center' */
  align?: TooltipAlign
  className?: string
}

const TOOLTIP_GAP = 8

interface TooltipPlacement {
  top: number
  left: number
  transform: string
}

function resolveTooltipPlacement(
  triggerRect: DOMRect,
  position: TooltipPosition,
  align: TooltipAlign,
): TooltipPlacement {
  switch (position) {
    case 'top': {
      const top = triggerRect.top - TOOLTIP_GAP
      if (align === 'start') return { top, left: triggerRect.left, transform: 'translateY(-100%)' }
      if (align === 'end') return { top, left: triggerRect.right, transform: 'translate(-100%, -100%)' }
      return { top, left: triggerRect.left + triggerRect.width / 2, transform: 'translate(-50%, -100%)' }
    }
    case 'bottom': {
      const top = triggerRect.bottom + TOOLTIP_GAP
      if (align === 'start') return { top, left: triggerRect.left, transform: 'none' }
      if (align === 'end') return { top, left: triggerRect.right, transform: 'translateX(-100%)' }
      return { top, left: triggerRect.left + triggerRect.width / 2, transform: 'translateX(-50%)' }
    }
    case 'left': {
      const left = triggerRect.left - TOOLTIP_GAP
      if (align === 'start') return { top: triggerRect.top, left, transform: 'translateX(-100%)' }
      if (align === 'end') return { top: triggerRect.bottom, left, transform: 'translate(-100%, -100%)' }
      return { top: triggerRect.top + triggerRect.height / 2, left, transform: 'translate(-100%, -50%)' }
    }
    case 'right': {
      const left = triggerRect.right + TOOLTIP_GAP
      if (align === 'start') return { top: triggerRect.top, left, transform: 'none' }
      if (align === 'end') return { top: triggerRect.bottom, left, transform: 'translateY(-100%)' }
      return { top: triggerRect.top + triggerRect.height / 2, left, transform: 'translateY(-50%)' }
    }
  }
}

/**
 * Lightweight tooltip mounted in a body portal.
 *
 * Follows the same visual language used by `ContextWindowRing` and
 * `SegmentedRing`, but extracted into a reusable component so tooltip
 * styles aren't scattered across the codebase.
 *
 * @example
 * <Tooltip content="Resume session — conversation history is preserved.">
 *   <button>Retry</button>
 * </Tooltip>
 */
export function Tooltip({
  content,
  children,
  position = 'bottom',
  align = 'center',
  className,
}: TooltipProps): React.JSX.Element {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const { mounted, phase } = useModalAnimation(open)
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null)

  const updatePlacement = useCallback(() => {
    if (!triggerRef.current) return
    setPlacement(resolveTooltipPlacement(triggerRef.current.getBoundingClientRect(), position, align))
  }, [position, align])

  useLayoutEffect(() => {
    if (!mounted) return
    updatePlacement()
  }, [mounted, updatePlacement, content])

  useEffect(() => {
    if (!mounted) return

    const handleViewportChange = (): void => {
      updatePlacement()
    }

    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [mounted, updatePlacement])

  const handleMouseEnter = useCallback(() => {
    updatePlacement()
    setOpen(true)
  }, [updatePlacement])

  const handleMouseLeave = useCallback(() => {
    setOpen(false)
  }, [])

  const handleFocusCapture = useCallback(() => {
    updatePlacement()
    setOpen(true)
  }, [updatePlacement])

  const handleBlurCapture = useCallback((e: React.FocusEvent<HTMLSpanElement>) => {
    const nextTarget = e.relatedTarget as Node | null
    if (nextTarget && triggerRef.current?.contains(nextTarget)) return
    setOpen(false)
  }, [])

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      {children}
      {mounted && placement && createPortal(
        <span
          className="pointer-events-none fixed z-[120]"
          style={{
            top: placement.top,
            left: placement.left,
            transform: placement.transform,
          }}
        >
          <span
            {...surfaceProps({ elevation: 'floating', color: 'popover' })}
            className={cn(
              'block whitespace-nowrap',
              'rounded-md bg-[hsl(var(--popover))] px-2 py-1 text-[11px] leading-tight',
              'text-[hsl(var(--popover-foreground))] shadow-md border border-[hsl(var(--border))]',
              phase === 'enter' && 'dropdown-enter',
              phase === 'exit' && 'dropdown-exit',
              className,
            )}
            role="tooltip"
            aria-hidden="true"
          >
            {content}
          </span>
        </span>,
        document.body,
      )}
    </span>
  )
}
