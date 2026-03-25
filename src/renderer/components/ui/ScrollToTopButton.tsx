// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '../../lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScrollToTopButtonProps {
  /** Ref to the scrollable container to monitor and scroll. */
  containerRef: React.RefObject<HTMLElement | null>
  /**
   * How far the user must scroll (px) before the button appears.
   * @default 300
   */
  threshold?: number
  /** Extra class names forwarded to the root button element. */
  className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Floating "back to top" button that appears when the user scrolls past a
 * configurable threshold inside a scrollable container.
 *
 * Place this as a sibling of the scroll container inside a `position: relative`
 * wrapper so it overlays the bottom-right corner.
 *
 * Features:
 * - Passive scroll listener with `requestAnimationFrame` debounce (no jank).
 * - Fade + slide-up entrance / exit transition.
 * - Keyboard-accessible with visible focus ring.
 * - Removed from tab order when invisible (`tabIndex={-1}`).
 */
export function ScrollToTopButton({
  containerRef,
  threshold = 300,
  className
}: ScrollToTopButtonProps): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  const rafRef = useRef(0)

  // -------------------------------------------------------------------------
  // Scroll position tracking
  // -------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const checkScroll = (): void => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        setVisible(container.scrollTop > threshold)
      })
    }

    container.addEventListener('scroll', checkScroll, { passive: true })

    // Evaluate initial position (the container may already be scrolled, e.g.
    // after a hot-module-reload or restored scroll position).
    checkScroll()

    return () => {
      container.removeEventListener('scroll', checkScroll)
      cancelAnimationFrame(rafRef.current)
    }
  }, [containerRef, threshold])

  // -------------------------------------------------------------------------
  // Action
  // -------------------------------------------------------------------------

  const scrollToTop = useCallback(() => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [containerRef])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <button
      onClick={scrollToTop}
      className={cn(
        // Positioning
        'absolute right-3 bottom-3 z-10',
        // Size & shape
        'w-7 h-7 flex items-center justify-center rounded-full',
        // Colors
        'bg-[hsl(var(--background))] border border-[hsl(var(--border))]',
        'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
        // Elevation
        'shadow-sm hover:shadow-md',
        // Transition
        'transition-all duration-200',
        // Visibility driven by scroll state
        visible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-2 pointer-events-none',
        // Focus ring (accessible keyboard nav)
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
        className
      )}
      aria-label="Scroll to top"
      tabIndex={visible ? 0 : -1}
    >
      <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  )
}
