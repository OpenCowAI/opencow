// SPDX-License-Identifier: Apache-2.0

/**
 * useBrowserSheetLifecycle — WebContentsView lifecycle management.
 *
 * When BrowserSheet mounts:
 *   1. Load the profiles list
 *   2. Call browser:ensure-source-view to create/reuse a view (main process handles reattach)
 *   3. viewId is populated immediately; NativeViewport is only mounted by BrowserSheet
 *      after the animation completes, so the first syncBounds always gets a stable
 *      getBoundingClientRect() value
 *
 * When BrowserSheet unmounts:
 *   Detach is triggered by BrowserOverlayStore.finishBrowserSheetExit() (after the animation ends).
 *   This hook itself does no cleanup, avoiding race conditions with the exit animation.
 *
 * Key design: bounds sync correctness does not rely on any timing guesses or magic numbers.
 * BrowserSheet uses the animationSettled state to control when NativeViewport mounts,
 * and the main process clears _displayedViewId on detachView, ensuring that
 * setDisplayedView is not short-circuited on reopen.
 */

import { useEffect, useMemo } from 'react'
import { useBrowserOverlayStore } from '@/stores/browserOverlayStore'
import { getAppAPI } from '@/windowAPI'
import { createLogger } from '@/lib/logger'
import type { BrowserOverlayState } from '@shared/types'

const log = createLogger('BrowserSheet')

export function useBrowserSheetLifecycle(overlay: BrowserOverlayState): void {
  const setBrowserOverlayViewId = useBrowserOverlayStore((s) => s.setBrowserOverlayViewId)
  const setBrowserOverlayActiveProfileId = useBrowserOverlayStore((s) => s.setBrowserOverlayActiveProfileId)
  const setBrowserOverlayStatePolicy = useBrowserOverlayStore((s) => s.setBrowserOverlayStatePolicy)
  const setBrowserOverlayProfileBindingReason = useBrowserOverlayStore((s) => s.setBrowserOverlayProfileBindingReason)
  const setBrowserOverlayProfiles = useBrowserOverlayStore((s) => s.setBrowserOverlayProfiles)

  const { source } = overlay
  const bindingRequest = useMemo<import('@shared/types').BrowserSourceResolutionRequest>(() => {
    const request: import('@shared/types').BrowserSourceResolutionRequest = {
      source,
      policy: overlay.statePolicy,
      projectId: overlay.projectId ?? undefined,
    }
    if (overlay.statePolicy === 'custom-profile' && overlay.activeProfileId) {
      request.preferredProfileId = overlay.activeProfileId
    }
    return request
  }, [
    source.type,
    // @ts-expect-error -- discriminated union: sessionId only exists on session-type sources
    source.sessionId,
    // @ts-expect-error -- discriminated union: issueId only exists on issue-type sources
    source.issueId,
    overlay.statePolicy,
    overlay.projectId,
    overlay.activeProfileId,
  ])

  // Load profile list on mount
  useEffect(() => {
    getAppAPI()['browser:list-profiles']()
      .then((profiles) => setBrowserOverlayProfiles(profiles))
      .catch(() => { /* Not critical */ })
  }, [setBrowserOverlayProfiles])

  // Ensure the correct view is created/attached based on source.
  //
  // The main process handler (browser:ensure-source-view) takes care of:
  //   1. Creating or finding the existing view
  //   2. Reattaching it to the window if previously detached (PiP reopen)
  //   3. Dispatching browser:view:opened via setDisplayedView()
  //
  // We simply await the viewId and store it. NativeViewport won't mount until
  // BrowserSheet's slide-in animation completes (animationSettled), so there's
  // no risk of syncing mid-animation bounds.
  useEffect(() => {
    let cancelled = false

    const ensureView = async () => {
      try {
        const viewId = await getAppAPI()['browser:ensure-source-view'](bindingRequest)

        if (cancelled) return
        setBrowserOverlayViewId(viewId.viewId)
        setBrowserOverlayActiveProfileId(viewId.profileId)
        setBrowserOverlayStatePolicy(viewId.statePolicy)
        setBrowserOverlayProfileBindingReason(viewId.profileBindingReason)
      } catch (err) {
        // View creation failed — overlay will show loading state
        log.error('ensure-source-view failed:', err)
      }
    }

    ensureView()

    return () => {
      cancelled = true
    }
  // Re-run only when the source identity changes (type + ids)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bindingRequest,
    setBrowserOverlayViewId,
    setBrowserOverlayActiveProfileId,
    setBrowserOverlayStatePolicy,
    setBrowserOverlayProfileBindingReason,
  ])

  // Sync profile info when viewId arrives
  const viewId = overlay.viewId
  const activeProfileId = overlay.activeProfileId
  useEffect(() => {
    if (!viewId || activeProfileId) return
    // viewId set but no profileId — fetch from get-active-view
    getAppAPI()['browser:get-active-view']()
      .then((info) => {
        if (info) setBrowserOverlayActiveProfileId(info.profileId)
      })
      .catch(() => {})
  }, [viewId, activeProfileId, setBrowserOverlayActiveProfileId])
}
