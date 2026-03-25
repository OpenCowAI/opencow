// SPDX-License-Identifier: Apache-2.0

import { memo, useCallback, useMemo, useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NavAnchor {
  msgId: string
  role: 'user' | 'assistant'
  /** First ~80 chars of the message text for hover preview */
  preview: string
}

interface SessionScrollNavProps {
  anchors: NavAnchor[]
  activeId: string | null
  /** Scroll a specific message into view — must use Virtuoso's scrollToIndex
   *  since off-screen items are not in the DOM with virtual scrolling. */
  onScrollToMessage: (msgId: string) => void
  /** Scroll to top via the centralized auto-follow state machine.
   *  Disengages follow mode before scrolling so corrective scrolls
   *  don't fight the scroll-to-top animation. */
  onScrollToTop: () => void
  /** Scroll to absolute bottom via the centralized auto-follow state machine.
   *  This ensures consistent behavior (cooldown, engage) across all
   *  scroll-to-bottom entry points. */
  onScrollToBottom: () => void
}

/** Hovered anchor — stores original index + viewport rect for fixed popover */
interface HoveredState {
  idx: number
  rect: DOMRect
}

// ---------------------------------------------------------------------------
// Layout config
// ---------------------------------------------------------------------------

/** Max anchor marks visible before ellipsis kicks in. */
const WINDOW_SIZE = 18

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the visible window `[start, end)` centered on `activeIdx`.
 *
 * When `total <= WINDOW_SIZE` all anchors are shown.
 * Otherwise a sliding window of `WINDOW_SIZE` is centered on `activeIdx`,
 * clamped to `[0, total)`.
 */
function computeWindow(activeIdx: number, total: number): { start: number; end: number } {
  if (total <= WINDOW_SIZE) return { start: 0, end: total }

  const half = Math.floor(WINDOW_SIZE / 2)
  let start = activeIdx - half
  let end = start + WINDOW_SIZE

  if (start < 0) {
    start = 0
    end = WINDOW_SIZE
  } else if (end > total) {
    end = total
    start = total - WINDOW_SIZE
  }

  return { start, end }
}

// ---------------------------------------------------------------------------
// Ellipsis indicator (pure presentational)
// ---------------------------------------------------------------------------

/** Three stacked dots indicating hidden anchors. */
function Ellipsis({ count }: { count: number }) {
  return (
    <span
      className="shrink-0 w-4 h-2 flex flex-col items-center justify-center gap-[1.5px]"
      aria-label={`${count} messages hidden`}
      title={`${count} messages`}
    >
      <span className="w-[2px] h-[2px] rounded-full bg-[hsl(var(--muted-foreground)/0.3)]" />
      <span className="w-[2px] h-[2px] rounded-full bg-[hsl(var(--muted-foreground)/0.3)]" />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Sliding-window scroll navigation with ellipsis overflow.
 *
 * Shows up to {@link WINDOW_SIZE} anchor marks with the active anchor
 * centered. When there are more anchors than the window, ellipsis indicators
 * appear at the top/bottom edges.
 *
 * - `▲` scrolls to the very top of the message list.
 * - `▼` scrolls to the very bottom.
 * - Both buttons are only visible on hover.
 */
export const SessionScrollNav = memo(function SessionScrollNav({
  anchors,
  activeId,
  onScrollToMessage,
  onScrollToTop,
  onScrollToBottom,
}: SessionScrollNavProps) {
  const [hovered, setHovered] = useState<HoveredState | null>(null)

  // -----------------------------------------------------------------------
  // Derived state (hooks before early return)
  // -----------------------------------------------------------------------

  const activeIdx = useMemo(
    () => anchors.findIndex((a) => a.msgId === activeId),
    [anchors, activeId],
  )

  const win = useMemo(
    () => computeWindow(Math.max(activeIdx, 0), anchors.length),
    [activeIdx, anchors.length],
  )

  // -----------------------------------------------------------------------
  // Hover handlers — capture viewport rect for fixed popover positioning
  // -----------------------------------------------------------------------

  const handleMouseEnter = useCallback((idx: number, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setHovered({ idx, rect })
  }, [])

  const handleMouseLeave = useCallback(() => {
    setHovered(null)
  }, [])

  // Don't render when there aren't enough messages to warrant navigation
  if (anchors.length <= 2) return null

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const hasEllipsisBefore = win.start > 0
  const hasEllipsisAfter = win.end < anchors.length
  const hoveredAnchor = hovered !== null ? anchors[hovered.idx] : null

  return (
    <>
      <nav
        className="group/nav absolute right-1 top-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-0.5 px-1"
        aria-label="Message navigation"
      >
        {/* Scroll to top */}
        <button
          onClick={onScrollToTop}
          className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] opacity-0 group-hover/nav:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
          aria-label="Scroll to top"
        >
          <ChevronUp className="w-3 h-3" aria-hidden="true" />
        </button>

        {/* Top ellipsis */}
        {hasEllipsisBefore && <Ellipsis count={win.start} />}

        {/* Visible anchor marks */}
        {anchors.slice(win.start, win.end).map((anchor, localIdx) => {
          const globalIdx = win.start + localIdx
          const isActive = globalIdx === activeIdx
          const isUser = anchor.role === 'user'

          return (
            <button
              key={anchor.msgId}
              onClick={() => onScrollToMessage(anchor.msgId)}
              onMouseEnter={(e) => handleMouseEnter(globalIdx, e)}
              onMouseLeave={handleMouseLeave}
              className="group shrink-0 w-4 h-2 flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
              aria-label={`${isUser ? 'User' : 'Assistant'} message ${globalIdx + 1}${isActive ? ' (current)' : ''}`}
              aria-current={isActive ? 'true' : undefined}
            >
              <span
                className={`block rounded-full transition-colors ${
                  isUser
                    ? isActive ? 'w-1 h-1'      : 'w-1.5 h-[2px]'
                    : isActive ? 'w-2.5 h-[2px]' : 'w-2.5 h-[2px]'
                } ${
                  isActive
                    ? 'bg-[hsl(var(--foreground))]'
                    : 'bg-[hsl(var(--muted-foreground)/0.35)] group-hover:bg-[hsl(var(--muted-foreground)/0.7)]'
                }`}
              />
            </button>
          )
        })}

        {/* Bottom ellipsis */}
        {hasEllipsisAfter && <Ellipsis count={anchors.length - win.end} />}

        {/* Scroll to bottom */}
        <button
          onClick={onScrollToBottom}
          className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] opacity-0 group-hover/nav:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
          aria-label="Scroll to bottom"
        >
          <ChevronDown className="w-3 h-3" aria-hidden="true" />
        </button>
      </nav>

      {/* Fixed-position popover — rendered outside the nav to avoid clipping */}
      {hovered !== null && hoveredAnchor && (
        <div
          className="fixed z-50 w-max max-w-[200px] rounded-md bg-[hsl(var(--popover))] px-2.5 py-1.5 text-[11px] leading-snug text-[hsl(var(--popover-foreground))] shadow-md border border-[hsl(var(--border))]"
          style={{
            top: hovered.rect.top + hovered.rect.height / 2,
            left: hovered.rect.left - 8,
            transform: 'translate(-100%, -50%)',
          }}
          aria-hidden="true"
        >
          <span className="block text-[10px] text-[hsl(var(--muted-foreground))] mb-0.5">
            {hoveredAnchor.role === 'user' ? '> User' : '\u26A1 Agent'}
          </span>
          <span className="block line-clamp-2 break-words">{hoveredAnchor.preview}</span>
        </div>
      )}
    </>
  )
})
