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
  ChevronDown,
  Check,
} from 'lucide-react'
import { useBrowserOverlayStore } from '@/stores/browserOverlayStore'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'
import { cn } from '@/lib/utils'
import { getAppAPI } from '@/windowAPI'
import type { BrowserSource, BrowserStatePolicy } from '@shared/types'

interface BrowserSheetToolbarProps {
  source: BrowserSource
  statePolicy: import('@shared/types').BrowserStatePolicy
  onClose: () => void
}

export function BrowserSheetToolbar({ source, statePolicy, onClose }: BrowserSheetToolbarProps): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const viewId = useBrowserOverlayStore((s) => s.browserOverlay?.viewId ?? null)
  const projectId = useBrowserOverlayStore((s) => s.browserOverlay?.projectId ?? null)
  const urlBarValue = useBrowserOverlayStore((s) => s.browserOverlay?.urlBarValue ?? '')
  const isLoading = useBrowserOverlayStore((s) => s.browserOverlay?.isLoading ?? false)
  const pageInfo = useBrowserOverlayStore((s) => s.browserOverlay?.pageInfo ?? null)
  const profiles = useBrowserOverlayStore((s) => s.browserOverlay?.profiles ?? [])
  const activeProfileId = useBrowserOverlayStore((s) => s.browserOverlay?.activeProfileId ?? null)
  const profileBindingReason = useBrowserOverlayStore((s) => s.browserOverlay?.profileBindingReason ?? null)
  const switchBrowserStatePolicy = useBrowserOverlayStore((s) => s.switchBrowserStatePolicy)
  const switchBrowserPreferredProfile = useBrowserOverlayStore((s) => s.switchBrowserPreferredProfile)
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
      <StateModeDropdown
        source={source}
        projectId={projectId}
        policy={statePolicy}
        profileBindingReason={profileBindingReason}
        profiles={profiles}
        activeProfileId={activeProfileId}
        onSelectPolicy={(policy) => {
          void switchBrowserStatePolicy(policy)
        }}
        onSelectProfile={(profileId) => {
          void switchBrowserPreferredProfile(profileId)
        }}
      />

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

function StateModeDropdown({
  source,
  projectId,
  policy,
  profileBindingReason,
  profiles,
  activeProfileId,
  onSelectPolicy,
  onSelectProfile,
}: {
  source: BrowserSource
  projectId: string | null
  policy: BrowserStatePolicy
  profileBindingReason: string | null
  profiles: import('@shared/types').BrowserProfileInfo[]
  activeProfileId: string | null
  onSelectPolicy: (policy: BrowserStatePolicy) => void
  onSelectProfile: (profileId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  useBlockBrowserView('browser-state-mode-dropdown', open)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent): void => {
      if (!dropdownRef.current) return
      if (!dropdownRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onEscape, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onEscape, true)
    }
  }, [open])

  const policyOptions: BrowserStatePolicy[] = [
    'shared-global',
    'shared-project',
    'isolated-issue',
    'isolated-session',
    'custom-profile',
  ]

  const getPolicyLabel = useCallback((value: BrowserStatePolicy): string => {
    switch (value) {
      case 'shared-global':
        return t('browser.stateMode.sharedGlobal')
      case 'shared-project':
        return t('browser.stateMode.sharedProject')
      case 'isolated-issue':
        return t('browser.stateMode.isolatedIssue')
      case 'isolated-session':
        return t('browser.stateMode.isolatedSession')
      case 'custom-profile':
        return t('browser.stateMode.customProfile')
    }
  }, [t])

  const getPolicyAvailability = useCallback((value: BrowserStatePolicy): { enabled: boolean; reason: string | null } => {
    const hasIssueScope = source.type === 'issue-session' || source.type === 'issue-standalone'
    const hasSessionScope = source.type === 'issue-session' || source.type === 'chat-session'

    switch (value) {
      case 'shared-project':
        return projectId
          ? { enabled: true, reason: null }
          : { enabled: false, reason: t('browser.stateMode.disabled.noProject') }
      case 'isolated-issue':
        return hasIssueScope
          ? { enabled: true, reason: null }
          : { enabled: false, reason: t('browser.stateMode.disabled.noIssue') }
      case 'isolated-session':
        return hasSessionScope
          ? { enabled: true, reason: null }
          : { enabled: false, reason: t('browser.stateMode.disabled.noSession') }
      case 'custom-profile':
        return profiles.length > 0
          ? { enabled: true, reason: null }
          : { enabled: false, reason: t('browser.stateMode.disabled.noProfile') }
      case 'shared-global':
      default:
        return { enabled: true, reason: null }
    }
  }, [profiles.length, projectId, source.type, t])

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null
  const triggerLabel = policy === 'custom-profile' && activeProfile
    ? `${getPolicyLabel(policy)} · ${activeProfile.name}`
    : getPolicyLabel(policy)

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium',
          'bg-[hsl(var(--accent)/0.35)] text-[hsl(var(--muted-foreground))]',
          'border border-[hsl(var(--border)/0.45)]',
          'hover:bg-[hsl(var(--accent)/0.6)] hover:text-[hsl(var(--foreground))] transition-colors',
          'shrink-0',
        )}
        title={profileBindingReason ?? undefined}
        aria-label={t('browser.stateMode.label')}
      >
        <span>{triggerLabel}</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div
          className={cn(
            'absolute top-full left-0 mt-1.5 z-50 min-w-[240px]',
            'rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))]',
            'text-[hsl(var(--popover-foreground))] shadow-lg p-1',
          )}
        >
          {policyOptions.map((option) => {
            const selected = option === policy
            const availability = getPolicyAvailability(option)
            return (
              <button
                key={option}
                type="button"
                disabled={!availability.enabled}
                onClick={() => {
                  if (!availability.enabled) return
                  setOpen(false)
                  onSelectPolicy(option)
                }}
                title={availability.reason ?? undefined}
                className={cn(
                  'w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs',
                  'hover:bg-[hsl(var(--foreground)/0.04)] transition-colors',
                  !availability.enabled && 'cursor-not-allowed opacity-55 hover:bg-transparent',
                  selected && 'text-[hsl(var(--foreground))] bg-[hsl(var(--accent)/0.45)]',
                )}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{getPolicyLabel(option)}</span>
                  {!availability.enabled && availability.reason ? (
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))] leading-tight mt-0.5">
                      {availability.reason}
                    </span>
                  ) : null}
                </div>
                {selected ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
            )
          })}

          {policy === 'custom-profile' && (
            <div className="mt-1 pt-1 border-t border-[hsl(var(--border)/0.7)]">
              <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {t('browser.stateMode.profile')}
              </div>
              {profiles.map((profile) => {
                const selected = profile.id === activeProfileId
                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      onSelectProfile(profile.id)
                    }}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs',
                      'hover:bg-[hsl(var(--foreground)/0.04)] transition-colors',
                      selected && 'text-[hsl(var(--foreground))] bg-[hsl(var(--accent)/0.45)]',
                    )}
                  >
                    <span className="truncate">{profile.name}</span>
                    {selected ? <Check className="h-3.5 w-3.5" /> : null}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
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
