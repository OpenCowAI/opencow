// SPDX-License-Identifier: Apache-2.0

/**
 * useBlockBrowserView — Declarative blocker for native WebContentsView.
 *
 * When `active` is true, registers a named blocker in browserOverlayStore.
 * The overlay guard hides the WebContentsView whenever any blocker is active,
 * preventing the native layer from obscuring DOM-layer modals.
 *
 * Uses `useLayoutEffect` so the blocker is registered synchronously after DOM
 * mutations but **before the browser paints**. This eliminates the single-frame
 * flash where the native view would still be visible over the newly-opened modal.
 *
 * Usage (one line per modal):
 *   useBlockBrowserView('artifact-viewer', viewerOpen)
 *   useBlockBrowserView('command-palette', commandPaletteOpen)
 */

import { useLayoutEffect } from 'react'
import { useBrowserOverlayStore } from '@/stores/browserOverlayStore'

export function useBlockBrowserView(id: string, active: boolean): void {
  const addBlocker = useBrowserOverlayStore((s) => s.addOverlayBlocker)
  const removeBlocker = useBrowserOverlayStore((s) => s.removeOverlayBlocker)

  useLayoutEffect(() => {
    if (active) {
      addBlocker(id)
    } else {
      removeBlocker(id)
    }
    return () => removeBlocker(id)
  }, [active, id, addBlocker, removeBlocker])
}
