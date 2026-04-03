// SPDX-License-Identifier: Apache-2.0

import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import { Group, Panel, Separator, usePanelRef, type PanelSize } from 'react-resizable-panels'
import { useAppBootstrap } from '@/hooks/useAppBootstrap'
import { useAppStore } from '@/stores/appStore'
import { useTerminalOverlayStore } from '@/stores/terminalOverlayStore'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Sidebar } from '@/components/Sidebar/Sidebar'
import { MainPanel } from '@/components/MainPanel/MainPanel'
import { DetailPanel } from '@/components/DetailPanel/DetailPanel'
import { StatusBar } from '@/components/StatusBar/StatusBar'
import { CommandPalette } from '@/components/CommandPalette/CommandPalette'
import { OnboardingModal } from '@/components/Onboarding/OnboardingModal'
import { InboxMessageList } from '@/components/InboxView/InboxMessageList'
import { InboxMessageDetail } from '@/components/InboxView/InboxMessageDetail'
import { useInboxKeyboard } from '@/hooks/useInboxKeyboard'
import { useSlashFocusShortcut } from '@/hooks/useSlashFocusShortcut'
import { useThemeEffect } from '@/hooks/useThemeEffect'
import { SettingsModal } from '@/components/Settings/SettingsModal'
import { AboutDialog } from '@/components/About/AboutDialog'
import { Toaster } from '@/components/ui/Toaster'
import { BrowserSheet } from '@/components/BrowserSheet/BrowserSheet'
import { BrowserPiPTrigger } from '@/components/BrowserPiP/BrowserPiPTrigger'
import { TerminalPanel } from '@/components/TerminalSheet/TerminalSheet'
import { SplashScreen } from '@/components/SplashScreen/SplashScreen'
import { MemoryToast } from '@/components/memory/MemoryToast'
import { IssueFileSheet } from '@/components/IssueFileSheet/IssueFileSheet'
import { useBrowserOverlayStore } from '@/stores/browserOverlayStore'
import { useIssueFileOverlayStore } from '@/stores/issueFileOverlayStore'

// ── Constants ────────────────────────────────────────────────────────

/** Default terminal panel height (px) — roughly 25% of a typical window */
const TERMINAL_DEFAULT_HEIGHT = 260
/** Minimum terminal panel height (px) */
const TERMINAL_MIN_HEIGHT = 120
/** Maximum terminal panel height as a ratio of window height */
const TERMINAL_MAX_RATIO = 0.70

/** Enter animation duration (ms) — Tier 2 panel-level */
const TERMINAL_ENTER_MS = 250
/** Exit animation duration (ms) — snappy collapse */
const TERMINAL_EXIT_MS = 180

/** Left sidebar panel sizes (% of horizontal group width). */
const SIDEBAR_EXPANDED_DEFAULT_PCT = 15
const SIDEBAR_EXPANDED_MIN_PCT = 12
const SIDEBAR_EXPANDED_MAX_PCT = 25
const SIDEBAR_COLLAPSED_PCT = 3.6
const SIDEBAR_COLLAPSE_GUARD = 0.25

/** Convert sidebar percentage values to explicit Panel size strings. */
function sidebarPct(value: number): `${number}%` {
  return `${value}%`
}

/** Module-level memory: last user-dragged terminal height (persists across mount/unmount) */
let lastTerminalHeight = TERMINAL_DEFAULT_HEIGHT

// ── Components ───────────────────────────────────────────────────────

function ResizeHandle({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  return (
    <Separator
      disabled={disabled}
      className={cn(
        'w-px bg-[hsl(var(--border)/0.5)] relative data-[separator=active]:bg-[hsl(var(--ring)/0.7)] hover:bg-[hsl(var(--ring)/0.3)] transition-colors',
        disabled && 'opacity-0 pointer-events-none',
      )}
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </Separator>
  )
}

/**
 * EmbeddedTerminal — Embedded terminal panel with smooth enter/exit animations.
 *
 * Layout: CSS flex + native DOM drag (no dependency on react-resizable-panels).
 * Animation: CSS transition-driven height interpolation, two-phase exit (close -> animate -> finish).
 *
 * Enter: mount -> height: 0 -> rAF -> height: target (250ms ease-out-quint)
 * Exit: isExiting -> height: 0 (180ms ease-in) -> transitionEnd -> finishTerminalExit
 */
function EmbeddedTerminal(): React.JSX.Element {
  const isExiting = useTerminalOverlayStore((s) => s._terminalExiting)
  const finishTerminalExit = useTerminalOverlayStore((s) => s.finishTerminalExit)

  const [height, setHeight] = useState(0) // start at 0 for enter animation
  const heightRef = useRef(0)
  const [isDragging, setIsDragging] = useState(false)
  const [isAnimating, setIsAnimating] = useState(true) // animation starts on mount

  // Sync ref (event handler closures need the latest value)
  useEffect(() => { heightRef.current = height }, [height])

  // ── Enter animation: mount -> rAF -> expand to target height ──
  useEffect(() => {
    // Double rAF ensures the browser has committed the height: 0 layout before the transition takes effect
    let id2 = 0
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        setHeight(lastTerminalHeight)
      })
    })
    return () => {
      cancelAnimationFrame(id1)
      cancelAnimationFrame(id2)
    }
     
  }, []) // mount only

  // ── Exit animation: isExiting -> collapse to 0 ──
  useEffect(() => {
    if (isExiting) {
      // Remember current height for next open
      lastTerminalHeight = heightRef.current
      setIsAnimating(true)
      setHeight(0)
    }
  }, [isExiting])

  // ── Transition end callback ──
  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      // Only handle this element's own height transition (ignore bubbled events from children)
      if (e.target !== e.currentTarget || e.propertyName !== 'height') return
      setIsAnimating(false)
      if (isExiting) {
        finishTerminalExit()
      }
    },
    [isExiting, finishTerminalExit],
  )

  // ── Drag to resize height ──
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = heightRef.current
    setIsDragging(true)

    const onMove = (ev: MouseEvent): void => {
      const delta = startY - ev.clientY // upward = positive = terminal grows
      const maxH = window.innerHeight * TERMINAL_MAX_RATIO
      const next = Math.round(Math.max(TERMINAL_MIN_HEIGHT, Math.min(maxH, startH + delta)))
      setHeight(next)
      lastTerminalHeight = next // persist in real-time
    }

    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setIsDragging(false)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [])

  // Transition style during animation (disabled while dragging to avoid laggy tracking)
  const transitionStyle = !isDragging && isAnimating
    ? isExiting
      ? `height ${TERMINAL_EXIT_MS}ms ease-in`
      : `height ${TERMINAL_ENTER_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
    : 'none'

  return (
    <div
      style={{ height, transition: transitionStyle }}
      className="flex flex-col min-h-0 overflow-hidden"
      onTransitionEnd={handleTransitionEnd}
    >
      {/* ── Drag handle (interaction disabled during animation) ── */}
      <div
        className={cn(
          'h-px relative shrink-0 transition-colors',
          isAnimating
            ? 'cursor-default'
            : 'cursor-row-resize',
          isDragging
            ? 'bg-[hsl(var(--ring)/0.7)]'
            : 'bg-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--ring)/0.3)]',
        )}
        onMouseDown={isAnimating ? undefined : handleDragStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
      >
        {/* Expand drag hit area -> 3px above and below (7px total) */}
        <div className="absolute inset-x-0 -top-[3px] -bottom-[3px]" />
      </div>

      {/* ── Terminal content ── */}
      <div className="flex-1 min-h-0">
        <TerminalPanel />
      </div>
    </div>
  )
}

// ── AppLayout ────────────────────────────────────────────────────────

function AppLayout(): React.JSX.Element {
  useInboxKeyboard()
  useSlashFocusShortcut()
  useThemeEffect()

  const appView = useAppStore((s) => s.appView)
  const leftSidebarExpanded = useAppStore((s) => s.leftSidebarExpanded)
  const detailContext = useAppStore((s) => s.detailContext)
  const navigateToInbox = useAppStore((s) => s.navigateToInbox)
  const terminalOverlay = useTerminalOverlayStore((s) => s.terminalOverlay)

  const isInbox = appView.mode === 'inbox'
  const inboxMessageId = isInbox ? appView.selectedMessageId : null

  const showDetail = isInbox || detailContext !== null
  const sidebarPanelRef = usePanelRef()
  const detailPanelRef = usePanelRef()
  const lastSidebarExpandedSizeRef = useRef(SIDEBAR_EXPANDED_DEFAULT_PCT)
  const prevShowDetailRef = useRef(false)
  const prevDetailKindRef = useRef<string | null>(null)

  const detailKind = isInbox ? 'inbox' : detailContext?.type ?? null

  useEffect(() => {
    const panel = detailPanelRef.current
    if (!panel) return

    const size = isInbox ? '60%' : detailContext?.type === 'session' ? '42%' : detailContext?.type === 'memory' ? '35%' : '50%'

    if (showDetail) {
      panel.expand()
      if (!prevShowDetailRef.current || prevDetailKindRef.current !== detailKind) {
        panel.resize(size)
      }
    } else {
      panel.collapse()
    }
    prevShowDetailRef.current = showDetail
    prevDetailKindRef.current = detailKind
  }, [showDetail, detailContext, detailPanelRef, isInbox, detailKind])

  // Keep the left sidebar panel size in sync with the icon-only collapsed state.
  const handleSidebarResize = useCallback(
    (panelSize: PanelSize) => {
      if (!leftSidebarExpanded) return
      if (panelSize.asPercentage <= SIDEBAR_COLLAPSED_PCT + SIDEBAR_COLLAPSE_GUARD) return
      if (panelSize.asPercentage < SIDEBAR_EXPANDED_DEFAULT_PCT) return
      lastSidebarExpandedSizeRef.current = panelSize.asPercentage
    },
    [leftSidebarExpanded],
  )

  useEffect(() => {
    const panel = sidebarPanelRef.current
    if (!panel) return

    if (!leftSidebarExpanded) {
      const current = panel.getSize()
      if (current.asPercentage > SIDEBAR_COLLAPSED_PCT + SIDEBAR_COLLAPSE_GUARD) {
        lastSidebarExpandedSizeRef.current = current.asPercentage
      }
      panel.resize(SIDEBAR_COLLAPSED_PCT)
      return
    }

    const target = Math.min(
      SIDEBAR_EXPANDED_MAX_PCT,
      Math.max(SIDEBAR_EXPANDED_DEFAULT_PCT, lastSidebarExpandedSizeRef.current),
    )
    panel.resize(target)
  }, [leftSidebarExpanded, sidebarPanelRef])

  const isTerminalExiting = useTerminalOverlayStore((s) => s._terminalExiting)
  const isTerminalOpen = terminalOverlay !== null
  // Panel stays mounted during exit animation (two-phase exit)
  const showTerminal = isTerminalOpen || isTerminalExiting

  // ── Detail panel slide animation: enable flex-grow transitions after initial
  //    layout settles (prevents unwanted animation on first mount). ──
  const [layoutAnimated, setLayoutAnimated] = useState(false)
  useEffect(() => {
    // Double rAF: let the browser commit the initial collapsed layout first,
    // then enable transitions so subsequent expand/collapse operations animate.
    let id2 = 0
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setLayoutAnimated(true))
    })
    return () => { cancelAnimationFrame(id1); cancelAnimationFrame(id2) }
  }, [])

  // Sidebar flex-grow transition is now always active via the general
  // `layout-animated` class (see globals.css). This prevents the sidebar
  // from jumping instantly when the detail panel toggles — the old
  // opt-in `sidebar-resize-animated` class is no longer needed.

  return (
    <div data-surface="ground" className="flex flex-col h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      {/* ── Update notification moved to SidebarUpdateCard ── */}
      {/* ── Content area: horizontal panel layout (flat structure, no nesting) ── */}
      <Group
        id="opencow-layout"
        orientation="horizontal"
        className={cn(
          'flex-1 min-h-0',
          layoutAnimated && 'layout-animated',
        )}
      >
        <Panel
          id="sidebar"
          panelRef={sidebarPanelRef}
          defaultSize={sidebarPct(SIDEBAR_EXPANDED_DEFAULT_PCT)}
          minSize={sidebarPct(leftSidebarExpanded ? SIDEBAR_EXPANDED_MIN_PCT : SIDEBAR_COLLAPSED_PCT)}
          maxSize={sidebarPct(leftSidebarExpanded ? SIDEBAR_EXPANDED_MAX_PCT : SIDEBAR_COLLAPSED_PCT)}
          onResize={handleSidebarResize}
        >
          <Sidebar />
        </Panel>

        <ResizeHandle disabled={!leftSidebarExpanded} />

        <Panel id="main" minSize="20%">
          {isInbox ? (
            <InboxMessageList
              selectedMessageId={inboxMessageId}
              onSelectMessage={(id) => navigateToInbox(id)}
            />
          ) : (
            <MainPanel />
          )}
        </Panel>

        <ResizeHandle />

        <Panel
          id="detail"
          panelRef={detailPanelRef}
          defaultSize="50%"
          minSize="30%"
          maxSize="70%"
          collapsible
          collapsedSize={0}
        >
          {isInbox ? (
            <InboxMessageDetail selectedMessageId={inboxMessageId} />
          ) : (
            <DetailPanel />
          )}
        </Panel>
      </Group>

      {/* ── Terminal area: embedded panel (CSS flex + native drag + animation) ── */}
      {showTerminal && <EmbeddedTerminal />}

      <StatusBar />
    </div>
  )
}

// ── App ──────────────────────────────────────────────────────────────

export function App(): React.JSX.Element {
  // Unified bootstrap: initial data loading + real-time event subscription.
  // Called at App level (not inside AppLayout) to ensure zero event loss
  // during the splash screen phase.
  useAppBootstrap()

  const appReady = useAppStore((s) => s.appReady)
  const browserOverlay = useBrowserOverlayStore((s) => s.browserOverlay)
  const closeBrowserOverlay = useBrowserOverlayStore((s) => s.closeBrowserOverlay)
  const issueFileOverlay = useIssueFileOverlayStore((s) => s.issueFileOverlay)
  const closeIssueFileOverlay = useIssueFileOverlayStore((s) => s.closeIssueFileOverlay)
  const prevBrowserOpenRef = useRef(false)
  const prevIssueFileOpenRef = useRef(false)

  // Overlay orchestration (mutual exclusion):
  // BrowserSheet and IssueFileSheet are both fullscreen layers.
  // Whichever opens later wins; we close the previously open layer.
  useEffect(() => {
    const browserOpen = browserOverlay !== null
    const issueFileOpen = issueFileOverlay !== null

    const browserJustOpened = browserOpen && !prevBrowserOpenRef.current
    const issueFileJustOpened = issueFileOpen && !prevIssueFileOpenRef.current

    if (browserJustOpened && issueFileOpen) {
      closeIssueFileOverlay()
    }
    if (issueFileJustOpened && browserOpen) {
      closeBrowserOverlay()
    }

    prevBrowserOpenRef.current = browserOpen
    prevIssueFileOpenRef.current = issueFileOpen
  }, [browserOverlay, issueFileOverlay, closeBrowserOverlay, closeIssueFileOverlay])

  // ── Concurrent mount: prevent splash animation jank ──────────────
  // When appReady flips to true, React must mount the entire AppLayout
  // tree (sidebar, panels, modals, etc.) — a 50–200ms synchronous main
  // thread block that freezes the splash Canvas particle animation.
  //
  // useDeferredValue tells React to time-slice the mount: render in small
  // chunks, yielding to the browser between each chunk so requestAnimationFrame
  // keeps firing. The splash uses the immediate `appReady` for its phase
  // transitions, while the heavy app tree uses the deferred value.
  const deferredAppReady = useDeferredValue(appReady)

  const [splashDone, setSplashDone] = useState(false)

  // Stable callback — avoids re-creating on every render
  const handleSplashComplete = useCallback(() => setSplashDone(true), [])

  return (
    <ErrorBoundary>
      {/* App tree uses deferred value — mounts via concurrent transition,
          keeping the splash Canvas animation smooth. */}
      {deferredAppReady && (
        <>
          <OnboardingModal />
          <AppLayout />
          <BrowserPiPTrigger />   {/* z: 30 */}
          <BrowserSheet />        {/* z: 40 */}
          <IssueFileSheet />      {/* z: 40 */}
          <SettingsModal />       {/* z: 50 */}
          <AboutDialog />         {/* z: 50 */}
          <CommandPalette />      {/* z: 50 */}
        </>
      )}

      {/* Splash uses immediate value — responds to appReady without delay. */}
      {!splashDone && (
        <SplashScreen appReady={appReady} onComplete={handleSplashComplete} />
      )}

      {/* Toaster always visible (even during splash for error toasts) */}
      <Toaster />             {/* z: 60 */}
      <MemoryToast />         {/* z: 50 */}
    </ErrorBoundary>
  )
}
