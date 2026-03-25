// SPDX-License-Identifier: Apache-2.0

/**
 * NativeViewport (BrowserSheet version) — Bounds Sync placeholder for the WebContentsView.
 *
 * This component renders an empty div as a positional placeholder.
 * ResizeObserver monitors its size and position, sending bounds to the
 * Main process via IPC so the WebContentsView can be positioned exactly
 * on top of this div.
 *
 * Important: This component is only mounted AFTER the BrowserSheet's
 * slide-in animation has settled (controlled by BrowserSheet's
 * `animationSettled` state). This guarantees that the first
 * getBoundingClientRect() call returns stable, non-animated coordinates.
 */

import { useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useBrowserOverlayStore } from '@/stores/browserOverlayStore'
import { getAppAPI } from '@/windowAPI'

/** Minimum interval between bounds sync IPC calls (ms). */
const SYNC_THROTTLE_MS = 16 // ~60fps

export function NativeViewport(): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const viewId = useBrowserOverlayStore((s) => s.browserOverlay?.viewId ?? null)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastSyncRef = useRef<number>(0)
  const rafRef = useRef<number>(0)

  const syncBounds = useCallback(() => {
    if (!viewId || !containerRef.current) return

    const now = Date.now()
    if (now - lastSyncRef.current < SYNC_THROTTLE_MS) {
      // Throttle — schedule next sync via rAF
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0
          syncBounds()
        })
      }
      return
    }

    lastSyncRef.current = now

    const rect = containerRef.current.getBoundingClientRect()

    // getBoundingClientRect() returns CSS (logical) pixels.
    // Electron's WebContentsView.setBounds() also expects logical pixels,
    // so we pass the rect values directly — NO DPR multiplication.
    getAppAPI()['browser:sync-bounds']({
      viewId,
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    }).catch(() => {
      // Bounds sync failed — view may have been destroyed
    })
  }, [viewId])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !viewId) return

    // Initial sync — animation has already settled (guaranteed by two-phase
    // mount in BrowserSheet), so getBoundingClientRect() returns the final
    // stable coordinates.
    syncBounds()

    // Observe size changes (panel resize, window resize)
    const resizeObserver = new ResizeObserver(() => {
      syncBounds()
    })
    resizeObserver.observe(el)

    // Also sync on window resize (Retina scaling changes, OS window resize, etc.)
    window.addEventListener('resize', syncBounds)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', syncBounds)
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
  }, [viewId, syncBounds])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{
        // Transparent placeholder — the WebContentsView is layered on top
        // by Electron in the Main process.
        background: 'hsl(var(--muted) / 0.3)',
      }}
      aria-label={t('browser.viewport')}
      role="region"
    >
      {/* No children — this space is occupied by the native WebContentsView */}
      {!viewId && (
        <div className="flex items-center justify-center h-full text-[hsl(var(--muted-foreground))] text-sm">
          {t('browser.loadingView')}
        </div>
      )}
    </div>
  )
}
