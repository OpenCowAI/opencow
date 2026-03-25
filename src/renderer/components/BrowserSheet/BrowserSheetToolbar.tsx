// SPDX-License-Identifier: Apache-2.0

/**
 * BrowserSheetToolbar — Top toolbar for the browser overlay.
 *
 * Contains: Source Badge | Back / Forward / Reload | URL bar | Minimize | Close.
 * The close button uses an inline popover confirmation instead of a modal,
 * keeping the interaction lightweight and contextual.
 */

import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  Globe,
  Loader2,
  PictureInPicture2,
} from 'lucide-react'
import { useBrowserOverlayStore } from '@/stores/browserOverlayStore'
import { cn } from '@/lib/utils'
import { getAppAPI } from '@/windowAPI'
import type { BrowserSource } from '@shared/types'

interface BrowserSheetToolbarProps {
  source: BrowserSource
  onClose: () => void
}

export function BrowserSheetToolbar({ source, onClose }: BrowserSheetToolbarProps): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const viewId = useBrowserOverlayStore((s) => s.browserOverlay?.viewId ?? null)
  const urlBarValue = useBrowserOverlayStore((s) => s.browserOverlay?.urlBarValue ?? '')
  const isLoading = useBrowserOverlayStore((s) => s.browserOverlay?.isLoading ?? false)
  const pageInfo = useBrowserOverlayStore((s) => s.browserOverlay?.pageInfo ?? null)
  const setUrlBarValue = useBrowserOverlayStore((s) => s.setBrowserOverlayUrlBarValue)
  const setUrlBarFocused = useBrowserOverlayStore((s) => s.setBrowserOverlayUrlBarFocused)

  const urlInputRef = useRef<HTMLInputElement>(null)
  const hasView = viewId !== null

  // ── Close/destroy inline confirmation ──
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleCloseClick = useCallback(() => {
    setConfirmOpen(true)
  }, [])

  const handleConfirmClose = useCallback(() => {
    setConfirmOpen(false)
    if (!viewId) return
    getAppAPI()['browser:close-view'](viewId)
  }, [viewId])

  // ── Navigation ──
  const handleNavigate = useCallback(
    (action: 'go-back' | 'go-forward' | 'reload') => {
      if (!viewId) return
      getAppAPI()['browser:execute']({ viewId, action }).catch(() => {})
    },
    [viewId]
  )

  const handleUrlSubmit = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter' || !viewId) return

      let url = urlBarValue.trim()
      if (!url) return

      if (!/^https?:\/\//i.test(url)) {
        if (/^[a-zA-Z0-9].*\.[a-zA-Z]{2,}/.test(url)) {
          url = `https://${url}`
        } else {
          url = `https://www.google.com/search?q=${encodeURIComponent(url)}`
        }
      }

      setUrlBarValue(url)
      getAppAPI()['browser:execute']({
        viewId,
        action: 'navigate',
        url,
      }).catch(() => {})

      urlInputRef.current?.blur()
    },
    [viewId, urlBarValue, setUrlBarValue]
  )

  const handleUrlFocus = useCallback(() => {
    setUrlBarFocused(true)
    urlInputRef.current?.select()
  }, [setUrlBarFocused])

  const handleUrlBlur = useCallback(() => {
    setUrlBarFocused(false)
    if (pageInfo?.url) {
      setUrlBarValue(pageInfo.url)
    }
  }, [setUrlBarFocused, setUrlBarValue, pageInfo?.url])

  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] shrink-0 pl-[76px]">
      {/* Source badge */}
      <SourceBadge source={source} />

      {/* Navigation buttons */}
      <div className="flex items-center gap-0.5 ml-1">
        <ToolbarButton
          icon={ArrowLeft}
          label={t('back', { ns: 'common' })}
          onClick={() => handleNavigate('go-back')}
          disabled={!hasView}
        />
        <ToolbarButton
          icon={ArrowRight}
          label={t('forward', { ns: 'common' })}
          onClick={() => handleNavigate('go-forward')}
          disabled={!hasView}
        />
        {isLoading ? (
          <ToolbarButton icon={X} label={t('stop', { ns: 'common' })} onClick={() => handleNavigate('reload')} disabled={!hasView} />
        ) : (
          <ToolbarButton
            icon={RotateCw}
            label={t('reload', { ns: 'common' })}
            onClick={() => handleNavigate('reload')}
            disabled={!hasView}
          />
        )}
      </div>

      {/* URL bar */}
      <div className="flex-1 flex items-center min-w-0 ml-1.5">
        <div
          className={cn(
            'flex-1 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs',
            'bg-[hsl(var(--background))] border-[hsl(var(--border))]',
            'focus-within:border-[hsl(var(--ring))] focus-within:ring-1 focus-within:ring-[hsl(var(--ring))]',
            'transition-colors'
          )}
        >
          <Globe className="h-3 w-3 flex-shrink-0 text-[hsl(var(--muted-foreground))]" />
          <input
            ref={urlInputRef}
            type="text"
            value={urlBarValue}
            onChange={(e) => setUrlBarValue(e.target.value)}
            onKeyDown={handleUrlSubmit}
            onFocus={handleUrlFocus}
            onBlur={handleUrlBlur}
            placeholder={hasView ? t('browser.enterUrl') : t('browser.selectProfile')}
            disabled={!hasView}
            className={cn(
              'flex-1 bg-transparent outline-none text-[hsl(var(--foreground))]',
              'placeholder:text-[hsl(var(--muted-foreground))]',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
            spellCheck={false}
          />
          {isLoading && (
            <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-[hsl(var(--muted-foreground))]" />
          )}
        </div>
      </div>

      {/* Minimize to PiP */}
      <button
        type="button"
        onClick={onClose}
        aria-label={t('browser.minimizeToPip')}
        title={t('browser.minimizeToPip')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 ml-1.5',
          'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
          'hover:bg-[hsl(var(--accent))] transition-colors',
          'text-xs',
        )}
      >
        <PictureInPicture2 className="h-3.5 w-3.5" />
        <span>{t('browser.minimize')}</span>
      </button>

      {/* Close / destroy browser — with inline popover confirm */}
      <CloseButtonWithConfirm
        disabled={!hasView}
        label={t('browser.closeBrowser')}
        confirmMessage={t('browser.closeConfirmMessage')}
        confirmLabel={t('browser.closeConfirmAction')}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onClickClose={handleCloseClick}
        onConfirm={handleConfirmClose}
      />
    </div>
  )
}

// ─── Close Button + Inline Popover Confirm ───────────────────────────

interface CloseButtonWithConfirmProps {
  disabled: boolean
  label: string
  confirmMessage: string
  confirmLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onClickClose: () => void
  onConfirm: () => void
}

function CloseButtonWithConfirm({
  disabled,
  label,
  confirmMessage,
  confirmLabel,
  open,
  onOpenChange,
  onClickClose,
  onConfirm,
}: CloseButtonWithConfirmProps): React.JSX.Element {
  const { t } = useTranslation('common')
  const anchorRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Outside click → dismiss
  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent): void => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onOpenChange(false)
      }
    }
    const handleEscape = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onOpenChange(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleEscape, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleEscape, true)
    }
  }, [open, onOpenChange])

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        onClick={onClickClose}
        disabled={disabled}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex items-center justify-center rounded-md p-1.5',
          'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
          'hover:bg-[hsl(var(--accent))] transition-colors',
          'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent',
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Inline popover confirmation */}
      {open && (
        <div
          ref={popoverRef}
          className={cn(
            'absolute top-full right-0 mt-1.5 z-50',
            'w-56 p-3 rounded-xl',
            'border border-[hsl(var(--border))] bg-[hsl(var(--popover))]',
            'text-[hsl(var(--popover-foreground))]',
            'shadow-lg popover-enter',
          )}
        >
          <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
            {confirmMessage}
          </p>
          <div className="flex justify-end gap-1.5 mt-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className={cn(
                'px-2.5 py-1 text-xs rounded-lg',
                'border border-[hsl(var(--border))]',
                'hover:bg-[hsl(var(--foreground)/0.04)] transition-colors',
              )}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={cn(
                'px-2.5 py-1 text-xs rounded-lg font-medium',
                'bg-red-600 text-white hover:bg-red-700 transition-colors',
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Source Badge ─────────────────────────────────────────────────────

function SourceBadge({ source }: { source: BrowserSource }): React.JSX.Element {
  const { t } = useTranslation('navigation')

  let label: string
  switch (source.type) {
    case 'issue-session':
    case 'issue-standalone':
      label = t('browser.sourceIssue')
      break
    case 'chat-session':
      label = t('browser.sourceChat')
      break
    case 'standalone':
      label = t('browser.sourceBrowser')
      break
  }

  return (
    <div className={cn(
      'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium',
      'bg-[hsl(var(--accent)/0.5)] text-[hsl(var(--foreground))]',
      'border border-[hsl(var(--border)/0.5)]',
      'shrink-0',
    )}>
      <Globe className="h-3 w-3" />
      <span>{label}</span>
    </div>
  )
}

// ─── Toolbar Button ──────────────────────────────────────────────────

interface ToolbarButtonProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  disabled?: boolean
  className?: string
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  className,
}: ToolbarButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-md p-1.5',
        'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
        'hover:bg-[hsl(var(--accent))] transition-colors',
        'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent',
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}
