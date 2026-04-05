// SPDX-License-Identifier: Apache-2.0

/**
 * BrowserSheet — Fullscreen browser overlay.
 *
 * Slides in from the bottom, fully covering the main window (z-40). Split-pane layout:
 * - Left: NativeViewport (WebContentsView bounds sync)
 * - Right: BrowserSheetChat (pure React DOM)
 *
 * Not rendered when browserOverlay is null (conditional rendering ensures
 * NativeViewport mount/unmount aligns with WebContentsView attach/detach).
 *
 * Exit animation flow:
 *   1. closeBrowserOverlay() instantly hides WebContentsView + sets _browserSheetExiting=true
 *   2. This component detects isExiting -> slide-out CSS animation
 *   3. onAnimationEnd -> finishBrowserSheetExit() -> browserOverlay=null -> unmount
 */

import { useCallback, useEffect, useState } from 'react'
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useBrowserOverlayStore } from '@/stores/browserOverlayStore'
import { cn } from '@/lib/utils'
import { BrowserSheetToolbar } from './BrowserSheetToolbar'
import { BrowserSheetChat } from './BrowserSheetChat'
import { NativeViewport } from './NativeViewport'
import { BrowserViewportEdge } from './BrowserViewportEdge'
import { ChatPanelErrorBoundary } from './ChatPanelErrorBoundary'
import { useBrowserSheetLifecycle } from '@/hooks/useBrowserSheetLifecycle'
import { useBrowserViewOverlayGuard } from '@/hooks/useBrowserViewOverlayGuard'
import type { BrowserOverlayState } from '@shared/types'

const SHEET_ENTER_FALLBACK_MS = 360

export function BrowserSheet(): React.JSX.Element | null {
  const overlay = useBrowserOverlayStore((s) => s.browserOverlay)
  if (!overlay) return null

  return <BrowserSheetContent overlay={overlay} />
}

function BrowserSheetContent({ overlay }: {
  overlay: BrowserOverlayState
}): React.JSX.Element {
  const closeBrowserOverlay = useBrowserOverlayStore((s) => s.closeBrowserOverlay)
  const finishBrowserSheetExit = useBrowserOverlayStore((s) => s.finishBrowserSheetExit)
  const isExiting = useBrowserOverlayStore((s) => s._browserSheetExiting)

  // ── Two-phase mount: NativeViewport only renders after slide-in animation ──
  //
  // During the CSS translateY slide-in animation, getBoundingClientRect()
  // returns mid-animation values. If NativeViewport syncs bounds during this
  // window, the WebContentsView's input region may cover the toolbar.
  //
  // By gating NativeViewport on `animationSettled`, we guarantee its first
  // syncBounds call sends final, stable coordinates — no magic numbers needed.
  const [animationSettled, setAnimationSettled] = useState(false)

  // Safety net: if animationend is missed (e.g. browser compositor edge-cases),
  // still mount NativeViewport so bounds sync can recover the native view.
  useEffect(() => {
    if (isExiting || animationSettled) return
    const timer = window.setTimeout(() => {
      setAnimationSettled(true)
    }, SHEET_ENTER_FALLBACK_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [isExiting, animationSettled])

  // WebContentsView lifecycle: ensure-source-view on mount
  useBrowserSheetLifecycle(overlay)

  // Overlay Guard: temporarily hide WebContentsView when CommandPalette/Settings opens
  useBrowserViewOverlayGuard()

  // Esc / Cmd+W → close overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (isExiting) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeBrowserOverlay()
      }
      if (e.key === 'w' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        closeBrowserOverlay()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [closeBrowserOverlay, isExiting])

  const handleAnimationEnd = useCallback(
    (e: React.AnimationEvent<HTMLDivElement>) => {
      // Only react to the sheet container's own animation
      if (e.currentTarget !== e.target) return
      if (isExiting) {
        finishBrowserSheetExit()
      } else {
        // Slide-in complete — safe to mount NativeViewport for bounds sync
        setAnimationSettled(true)
      }
    },
    [isExiting, finishBrowserSheetExit]
  )

  return (
    <div
      className={cn(
        'fixed inset-0 z-40',
        'bg-[hsl(var(--background))]',
        'flex flex-col',
        // no-drag: prevent Electron from intercepting clicks as window-drag events.
        // The Sidebar's drag-region is beneath this overlay (z-index doesn't affect
        // -webkit-app-region computation), so we must explicitly opt out here.
        'no-drag',
        isExiting
          ? 'animate-[sheet-slide-out_200ms_cubic-bezier(0.36,0,0.66,-0.56)_forwards]'
          : 'animate-[sheet-slide-in_300ms_cubic-bezier(0.16,1,0.3,1)_forwards]',
      )}
      onAnimationEnd={handleAnimationEnd}
    >
      {/* Top toolbar */}
      <BrowserSheetToolbar
        source={overlay.source}
        statePolicy={overlay.statePolicy}
        onClose={closeBrowserOverlay}
      />

      {/* Left-right split pane */}
      <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
        <Panel defaultSize={70} minSize={30}>
          {/* Must be a relative container so NativeViewport's absolute inset-0 takes effect */}
          <div className="relative h-full">
            {/* Two-phase mount: only render after slide-in animation settles
                so getBoundingClientRect() returns stable (non-animated) values */}
            {animationSettled && <NativeViewport />}
          </div>
        </Panel>

        <BrowserViewportEdge />

        <PanelResizeHandle className="w-px bg-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--ring)/0.3)] transition-colors data-[resize-handle-state=drag]:bg-[hsl(var(--ring)/0.7)]" />

        <Panel defaultSize={30} minSize={20}>
          <ChatPanelErrorBoundary>
            <BrowserSheetChat source={overlay.source} />
          </ChatPanelErrorBoundary>
        </Panel>
      </PanelGroup>
    </div>
  )
}
