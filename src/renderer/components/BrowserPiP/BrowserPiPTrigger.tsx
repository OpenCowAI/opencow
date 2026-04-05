// SPDX-License-Identifier: Apache-2.0

/**
 * BrowserPiPTrigger — Mini browser window floating at the bottom-left.
 *
 * Designed to look like a miniature browser window with:
 *   - Title bar: traffic-light dots (red = close) + page title + count badge
 *   - Content area: live thumbnail preview (or Globe placeholder)
 *   - Bottom URL overlay on thumbnail
 *
 * Click behaviors:
 *   - Single browser → open directly (no panel)
 *   - Multiple browsers → toggle BrowserPiPPanel
 *   - Red traffic-light dot → close/destroy browser (with confirmation)
 *
 * Visibility: browserOverlay === null && activeBrowserSources.length > 0
 * Z-index: z-30 (above AppLayout z-0, below BrowserSheet z-40)
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { useBrowserOverlayStore } from '@/stores/browserOverlayStore'
import { useThumbnail } from '@/lib/thumbnailCache'
import { getAppAPI } from '@/windowAPI'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { BrowserPiPPanel } from './BrowserPiPPanel'

const PIP_POSITION_STORAGE_KEY = 'opencow.browser-pip-position.v1'
const DEFAULT_PIP_LEFT_PX = 16 // Tailwind left-4
const DEFAULT_PIP_BOTTOM_PX = 128 // Tailwind bottom-32
const PIP_VIEWPORT_MARGIN_PX = 8
const PIP_DRAG_THRESHOLD_PX = 4
const PIP_DRAG_DAMPING = 0.16

interface PiPPosition {
  left: number
  bottom: number
}

function loadPiPPosition(): PiPPosition {
  try {
    const raw = window.localStorage.getItem(PIP_POSITION_STORAGE_KEY)
    if (!raw) return { left: DEFAULT_PIP_LEFT_PX, bottom: DEFAULT_PIP_BOTTOM_PX }
    const parsed = JSON.parse(raw) as Partial<PiPPosition>
    const left = Number(parsed.left)
    const bottom = Number(parsed.bottom)
    if (!Number.isFinite(left) || !Number.isFinite(bottom)) {
      return { left: DEFAULT_PIP_LEFT_PX, bottom: DEFAULT_PIP_BOTTOM_PX }
    }
    return { left, bottom }
  } catch {
    return { left: DEFAULT_PIP_LEFT_PX, bottom: DEFAULT_PIP_BOTTOM_PX }
  }
}

function savePiPPosition(position: PiPPosition): void {
  try {
    window.localStorage.setItem(PIP_POSITION_STORAGE_KEY, JSON.stringify(position))
  } catch {
    // Ignore storage failures (private mode / restricted env).
  }
}

/** Extract hostname from a URL string, returns empty string on failure. */
function extractHostname(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function BrowserPiPTrigger(): React.JSX.Element | null {
  const { t } = useTranslation('navigation')
  const browserOverlay = useBrowserOverlayStore((s) => s.browserOverlay)
  const activeSources = useBrowserOverlayStore((s) => s.activeBrowserSources)
  const viewPageInfoMap = useBrowserOverlayStore((s) => s.viewPageInfoMap)
  const openBrowserOverlay = useBrowserOverlayStore((s) => s.openBrowserOverlay)

  const visible = browserOverlay === null && activeSources.length > 0
  const { mounted, phase } = useModalAnimation(visible)

  const [panelOpen, setPanelOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [position, setPosition] = useState<PiPPosition>(() => loadPiPPosition())
  const positionRef = useRef(position)
  const containerRef = useRef<HTMLDivElement>(null)
  const suppressClickRef = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const updatePosition = useCallback((next: PiPPosition) => {
    positionRef.current = next
    setPosition(next)
  }, [])

  const clampPosition = useCallback((next: PiPPosition): PiPPosition => {
    const width = containerRef.current?.offsetWidth ?? 160
    const height = containerRef.current?.offsetHeight ?? 110
    const maxLeft = Math.max(PIP_VIEWPORT_MARGIN_PX, window.innerWidth - width - PIP_VIEWPORT_MARGIN_PX)
    const maxBottom = Math.max(PIP_VIEWPORT_MARGIN_PX, window.innerHeight - height - PIP_VIEWPORT_MARGIN_PX)

    return {
      left: Math.min(Math.max(next.left, PIP_VIEWPORT_MARGIN_PX), maxLeft),
      bottom: Math.min(Math.max(next.bottom, PIP_VIEWPORT_MARGIN_PX), maxBottom),
    }
  }, [])

  // Latest active source (last in array) — drives thumbnail + page info
  const latestSource = useMemo(
    () => (activeSources.length > 0 ? activeSources[activeSources.length - 1] : null),
    [activeSources],
  )
  const latestViewId = latestSource?.viewId ?? null
  const thumbnail = useThumbnail(latestViewId)
  const pageInfo = latestViewId ? viewPageInfoMap[latestViewId] : null

  const title = pageInfo?.title || latestSource?.displayName || ''
  const hostname = extractHostname(pageInfo?.url)

  const handleTriggerClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }

    // Single browser → open directly; multiple → toggle panel
    if (activeSources.length === 1) {
      openBrowserOverlay(activeSources[0].source, activeSources[0].openOptions)
    } else {
      setPanelOpen((v) => !v)
    }
  }, [activeSources, openBrowserOverlay])

  const handlePanelClose = useCallback(() => {
    setPanelOpen(false)
  }, [])

  // ── Red dot close: destroy the latest view ──
  const handleRedDotClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation() // Don't trigger card open / panel toggle
      setConfirmOpen(true)
    },
    [],
  )

  const handleConfirmClose = useCallback(() => {
    setConfirmOpen(false)
    if (!latestViewId) return
    getAppAPI()['browser:close-view'](latestViewId)
    // browser:view:closed DataBus event will auto-clean store + thumbnailCache
  }, [latestViewId])

  const handleTitlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if ((e.target as HTMLElement | null)?.closest('[data-pip-no-drag="true"]')) return

    e.preventDefault()

    const dragState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: positionRef.current.left,
      startBottom: positionRef.current.bottom,
      lastTarget: positionRef.current,
      didDrag: false,
    }

    const handlePointerMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== dragState.pointerId) return
      const dx = ev.clientX - dragState.startX
      const dy = ev.clientY - dragState.startY

      if (!dragState.didDrag && Math.hypot(dx, dy) < PIP_DRAG_THRESHOLD_PX) return
      if (!dragState.didDrag) dragState.didDrag = true

      setIsDragging(true)
      const target = clampPosition({
        left: dragState.startLeft + dx,
        bottom: dragState.startBottom - dy,
      })
      dragState.lastTarget = target

      // Full-time damping: move towards pointer target with a smoothing factor.
      const current = positionRef.current
      updatePosition({
        left: current.left + (target.left - current.left) * PIP_DRAG_DAMPING,
        bottom: current.bottom + (target.bottom - current.bottom) * PIP_DRAG_DAMPING,
      })
    }

    const handlePointerEnd = (ev: PointerEvent): void => {
      if (ev.pointerId !== dragState.pointerId) return
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)

      setIsDragging(false)
      if (dragState.didDrag) {
        // Snap to the last pointer target on release to avoid residual offset.
        updatePosition(dragState.lastTarget)
        suppressClickRef.current = true
        savePiPPosition(dragState.lastTarget)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
  }, [clampPosition, updatePosition])

  // Keep PiP inside viewport on resize and when content height changes (panel open/close).
  useEffect(() => {
    if (!mounted) return
    const clamped = clampPosition(positionRef.current)
    if (clamped.left !== positionRef.current.left || clamped.bottom !== positionRef.current.bottom) {
      updatePosition(clamped)
      savePiPPosition(clamped)
    }
  }, [mounted, panelOpen, activeSources.length, clampPosition, updatePosition])

  useEffect(() => {
    if (!mounted) return
    const handleResize = (): void => {
      const clamped = clampPosition(positionRef.current)
      if (clamped.left === positionRef.current.left && clamped.bottom === positionRef.current.bottom) return
      updatePosition(clamped)
      savePiPPosition(clamped)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [mounted, clampPosition, updatePosition])

  if (!mounted) return null

  return createPortal(
    <>
      <div
        ref={containerRef}
        className={cn(
          'fixed z-30 no-drag',
          'flex flex-col items-start',
        )}
        style={{
          left: `${position.left}px`,
          bottom: `${position.bottom}px`,
        }}
      >
        {/* Expandable card panel — renders above the trigger */}
        {panelOpen && (
          <BrowserPiPPanel
            sources={activeSources}
            onClose={handlePanelClose}
            triggerRef={triggerRef}
          />
        )}

        {/* ── Mini browser window trigger ── */}
        <button
          ref={triggerRef}
          type="button"
          onClick={handleTriggerClick}
          data-surface="floating"
          style={{
            '--_surface-color': 'var(--popover)',
            transition: 'transform .3s cubic-bezier(.22,1,.36,1), box-shadow .3s cubic-bezier(.22,1,.36,1), border-color .3s cubic-bezier(.22,1,.36,1), background-color .3s ease-out',
          } as React.CSSProperties}
          className={cn(
            'w-40 flex flex-col rounded-xl overflow-hidden',
            'border border-[hsl(var(--border))] bg-[hsl(var(--popover))]',
            'text-[hsl(var(--popover-foreground))]',
            'shadow-sm hover:shadow-md',
            'hover:border-[hsl(var(--foreground)/0.15)]',
            'hover:scale-[1.02] active:scale-[0.98]',
            'cursor-pointer select-none',
            phase === 'enter' && 'pip-enter',
            phase === 'exit' && 'pip-exit',
          )}
          aria-label={`${activeSources.length} active browser(s)`}
        >
          {/* ── Title bar ── */}
          <div
            onPointerDown={handleTitlePointerDown}
            className={cn(
              'h-6 shrink-0 flex items-center gap-1.5 px-2',
              'border-b border-[hsl(var(--border)/0.6)]',
              'bg-[hsl(var(--popover))]',
              isDragging ? 'cursor-grabbing' : 'cursor-grab',
            )}
          >
            {/* Traffic-light dots — red dot is clickable (close) */}
            <div className="flex items-center gap-[3px]" aria-hidden data-pip-no-drag="true">
              <span
                role="button"
                tabIndex={-1}
                onClick={handleRedDotClick}
                title={t('browser.closeBrowser')}
                className={cn(
                  'w-[7px] h-[7px] rounded-full',
                  'bg-[#FF605C]/80 hover:bg-[#FF605C]',
                  'hover:scale-150 transition-[background-color,transform] duration-200',
                )}
              />
              <span className="w-[7px] h-[7px] rounded-full bg-[#FFBD44]/80" />
              <span className="w-[7px] h-[7px] rounded-full bg-[#00CA4E]/80" />
            </div>

            {/* Page title */}
            <span className="flex-1 text-[10px] leading-none truncate text-[hsl(var(--muted-foreground))]">
              {title}
            </span>

            {/* Active count badge */}
            {activeSources.length > 1 && (
              <span
                className={cn(
                  'text-[9px] font-medium leading-none tabular-nums',
                  'px-[5px] py-[2px] rounded-[4px]',
                  'bg-[hsl(var(--foreground)/0.08)] text-[hsl(var(--muted-foreground))]',
                )}
              >
                {activeSources.length}
              </span>
            )}
          </div>

          {/* ── Content area (thumbnail or placeholder) ── */}
          <div className="relative flex-1 min-h-[76px]">
            {thumbnail ? (
              <>
                {/* Page screenshot */}
                <img
                  src={thumbnail}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover object-top"
                  draggable={false}
                />
                {/* Bottom gradient + hostname */}
                {hostname && (
                  <div className="absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-black/25 to-transparent flex items-end px-2 pb-1.5">
                    <div className="flex items-center gap-1 min-w-0">
                      <Globe className="h-2 w-2 shrink-0 text-white/60" />
                      <span className="text-[9px] leading-none text-white/70 truncate">
                        {hostname}
                      </span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Empty state — still looks like a browser window */
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[hsl(var(--muted)/0.15)]">
                <Globe className="h-5 w-5 text-[hsl(var(--muted-foreground)/0.4)]" />
                {hostname && (
                  <span className="text-[9px] text-[hsl(var(--muted-foreground)/0.5)] truncate max-w-[90%]">
                    {hostname}
                  </span>
                )}
              </div>
            )}
          </div>
        </button>
      </div>

      {/* Confirm dialog for closing browser */}
      <ConfirmDialog
        open={confirmOpen}
        variant="destructive"
        title={t('browser.closeConfirmTitle')}
        message={t('browser.closeConfirmMessage')}
        confirmLabel={t('browser.closeConfirmAction')}
        onConfirm={handleConfirmClose}
        onCancel={() => setConfirmOpen(false)}
      />
    </>,
    document.body,
  )
}
