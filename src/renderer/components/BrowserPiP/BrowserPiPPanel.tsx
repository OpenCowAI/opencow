// SPDX-License-Identifier: Apache-2.0

/**
 * BrowserPiPPanel — Card list panel for active sub-browsers.
 *
 * Pops up above the PiP trigger button. Each card displays a thumbnail
 * preview, page title, URL, source type badge, and a hover-visible close
 * button that destroys the browser view (with confirmation).
 *
 * Page info (URL/title) is read from the centralized viewPageInfoMap
 * (single source of truth). Thumbnails come from the lightweight
 * thumbnailCache (external store, not in Zustand).
 *
 * Patterns: useExitAnimation + outside click + Escape (mirrors AddProjectPopover).
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useExitAnimation } from '@/hooks/useModalAnimation'
import { useBrowserOverlayStore } from '@/stores/browserOverlayStore'
import { useThumbnail } from '@/lib/thumbnailCache'
import { getAppAPI } from '@/windowAPI'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { ActiveBrowserSource, BrowserPageInfoPayload, BrowserSource } from '@shared/types'

interface BrowserPiPPanelProps {
  sources: ActiveBrowserSource[]
  onClose: () => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
}

export function BrowserPiPPanel({ sources, onClose, triggerRef }: BrowserPiPPanelProps): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const openBrowserOverlay = useBrowserOverlayStore((s) => s.openBrowserOverlay)
  const viewPageInfoMap = useBrowserOverlayStore((s) => s.viewPageInfoMap)
  const { phase, requestClose } = useExitAnimation(onClose)
  const panelRef = useRef<HTMLDivElement>(null)

  // ── Close/destroy confirmation state ──
  const [confirmViewId, setConfirmViewId] = useState<string | null>(null)

  const handleRequestClose = useCallback((viewId: string) => {
    setConfirmViewId(viewId)
  }, [])

  const handleConfirmClose = useCallback(() => {
    if (!confirmViewId) return
    getAppAPI()['browser:close-view'](confirmViewId)
    setConfirmViewId(null)
    // browser:view:closed DataBus event will auto-clean store + thumbnailCache
  }, [confirmViewId])

  // Click a card → reopen BrowserSheet for that source
  const handleCardClick = useCallback(
    (source: ActiveBrowserSource) => {
      openBrowserOverlay(source.source, source.openOptions)
      onClose() // immediate — BrowserSheet slide-in covers PiP
    },
    [openBrowserOverlay, onClose],
  )

  // Outside click + Escape → close panel
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent): void => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        requestClose()
      }
    }
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleEscape, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleEscape, true)
    }
  }, [requestClose, triggerRef])

  return (
    <>
      <div
        ref={panelRef}
        {...surfaceProps({ elevation: 'floating', color: 'popover' })}
        className={cn(
          'w-72 mb-2',
          'rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))]',
          'text-[hsl(var(--popover-foreground))] shadow-md',
          'overflow-hidden',
          phase === 'enter' && 'popover-enter',
          phase === 'exit' && 'popover-exit',
        )}
      >
        {/* Header */}
        <div className="px-3 py-2 border-b border-[hsl(var(--border)/0.5)]">
          <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
            {t('browser.pip.activeBrowsers', 'Active Browsers')}
          </span>
        </div>

        {/* Card list */}
        <div className="py-1 max-h-80 overflow-y-auto">
          {sources.map((source) => (
            <BrowserSourceCard
              key={source.viewId}
              source={source}
              pageInfo={viewPageInfoMap[source.viewId] ?? null}
              onClick={() => handleCardClick(source)}
              onRequestClose={() => handleRequestClose(source.viewId)}
            />
          ))}
        </div>
      </div>

      {/* Confirm dialog for closing browser */}
      <ConfirmDialog
        open={confirmViewId !== null}
        variant="destructive"
        title={t('browser.closeConfirmTitle')}
        message={t('browser.closeConfirmMessage')}
        confirmLabel={t('browser.closeConfirmAction')}
        onConfirm={handleConfirmClose}
        onCancel={() => setConfirmViewId(null)}
      />
    </>
  )
}

// ─── Source Card ──────────────────────────────────────────────────────────

function BrowserSourceCard({ source, pageInfo, onClick, onRequestClose }: {
  source: ActiveBrowserSource
  pageInfo: BrowserPageInfoPayload | null
  onClick: () => void
  onRequestClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const typeLabel = getSourceTypeLabel(source.source, t)
  const thumbnail = useThumbnail(source.viewId)

  const handleCloseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation() // Prevent card click (reopen)
      onRequestClose()
    },
    [onRequestClose],
  )

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group w-full flex items-start gap-2.5 px-3 py-2 relative',
        'hover:bg-[hsl(var(--foreground)/0.04)]',
        'transition-colors text-left cursor-pointer',
      )}
    >
      {/* Thumbnail or fallback Globe icon */}
      {thumbnail ? (
        <div className="w-10 h-7 shrink-0 mt-0.5 rounded overflow-hidden bg-[hsl(var(--muted)/0.3)]">
          <img
            src={thumbnail}
            alt=""
            className="w-full h-full object-cover object-top"
            draggable={false}
          />
        </div>
      ) : (
        <Globe className="h-3.5 w-3.5 mt-1 shrink-0 text-[hsl(var(--muted-foreground))]" />
      )}

      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate text-[hsl(var(--foreground))]">
          {pageInfo?.title || source.displayName}
        </div>
        {pageInfo?.url && (
          <div className="text-[10px] text-[hsl(var(--muted-foreground))] truncate mt-0.5">
            {pageInfo.url}
          </div>
        )}
      </div>

      {/* Type badge — hidden when close button visible */}
      <span
        className={cn(
          'text-[10px] px-1.5 py-0.5 rounded-md shrink-0 mt-0.5',
          'bg-[hsl(var(--accent)/0.5)] text-[hsl(var(--muted-foreground))]',
          'border border-[hsl(var(--border)/0.5)]',
          'group-hover:hidden',
        )}
      >
        {typeLabel}
      </span>

      {/* Close button — visible on hover */}
      <div
        role="button"
        tabIndex={-1}
        onClick={handleCloseClick}
        aria-label={t('browser.closeBrowser')}
        title={t('browser.closeBrowser')}
        className={cn(
          'hidden group-hover:inline-flex',
          'items-center justify-center shrink-0 mt-0.5',
          'w-5 h-5 rounded-md',
          'text-[hsl(var(--muted-foreground))] hover:text-red-500',
          'hover:bg-red-500/10 transition-colors',
        )}
      >
        <X className="h-3 w-3" />
      </div>
    </button>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function getSourceTypeLabel(
  source: BrowserSource,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (...args: any[]) => any,
): string {
  switch (source.type) {
    case 'issue-session':
    case 'issue-standalone':
      return String(t('browser.pip.typeIssue', 'Issue'))
    case 'chat-session':
      return String(t('browser.pip.typeChat', 'Chat'))
    case 'standalone':
      return String(t('browser.pip.typeBrowser', 'Browser'))
  }
}
