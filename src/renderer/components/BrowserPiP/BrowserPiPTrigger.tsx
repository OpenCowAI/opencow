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

import { useState, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { useBrowserOverlayStore } from '@/stores/browserOverlayStore'
import { useThumbnail } from '@/lib/thumbnailCache'
import { getAppAPI } from '@/windowAPI'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { BrowserPiPPanel } from './BrowserPiPPanel'

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
  const triggerRef = useRef<HTMLButtonElement>(null)

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
    // Single browser → open directly; multiple → toggle panel
    if (activeSources.length === 1) {
      openBrowserOverlay(activeSources[0].source)
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

  if (!mounted) return null

  return createPortal(
    <>
      <div
        className={cn(
          'fixed bottom-20 left-4 z-30 no-drag',
          'flex flex-col items-start',
        )}
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
            className={cn(
              'h-6 shrink-0 flex items-center gap-1.5 px-2',
              'border-b border-[hsl(var(--border)/0.6)]',
              'bg-[hsl(var(--popover))]',
            )}
          >
            {/* Traffic-light dots — red dot is clickable (close) */}
            <div className="flex items-center gap-[3px]" aria-hidden>
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
