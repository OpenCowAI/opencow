// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { TrayPopoverHeader } from './TrayPopoverHeader'
import { TrayPopoverIssueList } from './TrayPopoverIssueList'
import { TrayPopoverFooter } from './TrayPopoverFooter'
import { useThemeEffect } from '@/hooks/useThemeEffect'
import { surfaceProps } from '@/lib/surface'
import { cn } from '@/lib/utils'
import type { TrayIssueItem, DataBusEvent } from '@shared/types'
import { getAppAPI } from '@/windowAPI'
import { resolveLocale } from '@shared/i18n'
import { applyLocale } from '@/i18n'
import { APP_VERSION } from '@shared/appIdentity'

const api = getAppAPI()

/**
 * Root component for the Tray Popover renderer process.
 *
 * This is a standalone React app loaded into a separate BrowserWindow
 * (not the main app window). It receives data via the same IPC bridge
 * (`getAppAPI()`) and renders a compact issue-centric overview.
 *
 * Data flow:
 *   1. Initial load: `tray-popover:get-issues` IPC → TrayIssueItem[]
 *   2. Real-time:    `tray:issues-updated` DataBus event → TrayIssueItem[]
 *
 * Navigation: clicking an issue calls `tray-popover:navigate-issue(issueId, projectId)`
 * which brings the main window to the foreground with the issue detail open.
 */

/** Interval for refreshing relative timestamps while the popover is visible. */
const TIMESTAMP_REFRESH_MS = 30_000

export function TrayPopover(): React.JSX.Element {
  const [items, setItems] = useState<TrayIssueItem[]>([])
  const [animPhase, setAnimPhase] = useState<'enter' | 'exit' | null>('enter')
  const containerRef = useRef<HTMLDivElement>(null)
  const systemLocaleRef = useRef<string>('en-US')

  // Periodic tick to refresh relative timestamps (e.g. "2 min ago" → "3 min ago")
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TIMESTAMP_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  // Apply theme (shared with main window via localStorage + CSS variables)
  useThemeEffect()

  // ── Initial data load ────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false

    // Load tray issue items (issue-centric, computed by main process)
    api['tray-popover:get-issues']().then((trayItems) => {
      if (cancelled) return
      setItems(trayItems)
    })

    // Load locale settings
    api['get-initial-state']().then((state) => {
      if (cancelled) return
      systemLocaleRef.current = state.systemLocale
      const locale = resolveLocale(state.settings?.language, state.systemLocale)
      applyLocale(locale)
    })

    return () => { cancelled = true }
  }, [])

  // ── Live event subscription ──────────────────────────────────────────

  useEffect(() => {
    return api['on:opencow:event']((event: DataBusEvent) => {
      // Issue-centric tray updates (pushed by TrayManager on relevant state changes)
      if (event.type === 'tray:issues-updated') {
        setItems(event.payload.items)
      }
      // Cross-window locale sync
      if (event.type === 'settings:updated') {
        const locale = resolveLocale(event.payload.language, systemLocaleRef.current)
        applyLocale(locale)
      }
    })
  }, [])

  // ── Animation: enter on focus, exit on will-hide IPC ─────────────────

  useEffect(() => {
    const handleFocus = (): void => { setAnimPhase('enter') }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [])

  useEffect(() => {
    return api['on:tray-popover:will-hide'](() => {
      setAnimPhase('exit')
    })
  }, [])

  // ── Dynamic height → main process ───────────────────────────────────

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = Math.ceil(entry.contentRect.height)
        api['tray-popover:resize'](height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ── IPC actions ──────────────────────────────────────────────────────

  const handleNavigateIssue = useCallback((issueId: string, projectId: string) => {
    api['tray-popover:navigate-issue'](issueId, projectId)
  }, [])

  const handleOpenMain = useCallback(() => {
    api['tray-popover:open-main']()
  }, [])

  const handleQuit = useCallback(() => {
    api['tray-popover:quit']()
  }, [])

  return (
    <div
      ref={containerRef}
      {...surfaceProps({ elevation: 'overlay', color: 'background' })}
      className={cn(
        'flex flex-col max-h-[480px] rounded-xl overflow-hidden bg-[hsl(var(--background))] border border-[hsl(var(--border)/0.3)] shadow-2xl',
        animPhase === 'enter' && 'popover-enter',
        animPhase === 'exit' && 'popover-exit',
      )}
    >
      <TrayPopoverHeader appVersion={APP_VERSION} />
      <TrayPopoverIssueList
        items={items}
        onNavigateIssue={handleNavigateIssue}
      />
      <TrayPopoverFooter
        onOpenMain={handleOpenMain}
        onQuit={handleQuit}
      />
    </div>
  )
}
