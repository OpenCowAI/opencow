// SPDX-License-Identifier: Apache-2.0

/**
 * useBrowserViewOverlayGuard — Overlay Guard for WebContentsView visibility.
 *
 * WebContentsView is an Electron native layer that always floats above all DOM
 * content regardless of CSS z-index. When any DOM-layer modal opens (Artifact
 * viewer, CommandPalette, Settings, etc.), the native view must be temporarily
 * hidden via setBounds(-9999,...) to prevent it from obscuring the modal.
 *
 * This guard reads from `overlayBlockers` (a generic Set<string> in
 * browserOverlayStore). Any component can register a blocker via the
 * `useBlockBrowserView(id, active)` hook — zero changes needed here.
 *
 * Uses `useLayoutEffect` to synchronize with `useBlockBrowserView`:
 * both fire before the browser paints, ensuring the native view is hidden
 * on the same frame the modal becomes visible (zero-flicker guarantee).
 */

import { useLayoutEffect } from 'react'
import { useBrowserOverlayStore } from '@/stores/browserOverlayStore'
import { getAppAPI } from '@/windowAPI'

export function useBrowserViewOverlayGuard(): void {
  const viewId = useBrowserOverlayStore((s) => s.browserOverlay?.viewId ?? null)
  const blockerCount = useBrowserOverlayStore((s) => s.overlayBlockers.size)

  const shouldHide = blockerCount > 0

  useLayoutEffect(() => {
    if (!viewId) return

    getAppAPI()['browser:set-view-visible']({
      viewId,
      visible: !shouldHide,
    }).catch(() => {
      // View may have been detached — ignore
    })
  }, [shouldHide, viewId])
}
