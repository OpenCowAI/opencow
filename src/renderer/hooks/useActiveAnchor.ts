// SPDX-License-Identifier: Apache-2.0

/**
 * useActiveAnchor — IntersectionObserver-based anchor tracking.
 *
 * Tracks which message anchor is most visible within a scroll container,
 * enabling the SessionScrollNav to highlight the "active" turn in real time.
 *
 * Separated from SessionMessageList to achieve proper concern isolation:
 *   - SessionMessageList: message rendering + layout
 *   - useActiveAnchor: viewport visibility tracking (read-only observation)
 *   - SessionScrollNav: navigation UI
 */

import { useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnchorEntry {
  /** DOM attribute value: data-msg-id on the target element */
  msgId: string
}

export interface UseActiveAnchorConfig {
  /** Scroll container that serves as the IntersectionObserver root */
  containerRef: RefObject<HTMLElement | null>
  /** Ordered list of anchors to observe */
  anchors: AnchorEntry[]
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the `msgId` of the anchor with the highest intersection ratio
 * within the scroll container, or `null` when no anchor is visible.
 *
 * Uses 3 thresholds (0, 0.5, 1) — enough granularity for accurate tracking
 * without excessive callback pressure during fast scrolling.
 */
export function useActiveAnchor({ containerRef, anchors }: UseActiveAnchorConfig): string | null {
  const [activeId, setActiveId] = useState<string | null>(null)

  // Stable key derived from anchor IDs — triggers observer re-creation only
  // when the set of observed messages actually changes.
  const anchorIdsKey = useMemo(
    () => anchors.map((a) => a.msgId).join(','),
    [anchors],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container || anchorIdsKey === '') return

    const ids = anchorIdsKey.split(',')
    const ratioMap = new Map<string, number>()

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const msgId = (entry.target as HTMLElement).dataset.msgId
          if (msgId) ratioMap.set(msgId, entry.intersectionRatio)
        }

        // Pick the anchor with the highest intersection ratio.
        // Only update when there is a clear winner (ratio > 0) to avoid
        // flicker to the first anchor when all ratios are momentarily 0
        // during fast scrolling between threshold crossings.
        let bestId: string | null = null
        let bestRatio = 0
        for (const id of ids) {
          const ratio = ratioMap.get(id) ?? 0
          if (ratio > bestRatio) {
            bestRatio = ratio
            bestId = id
          }
        }
        if (bestId !== null) {
          setActiveId(bestId)
        }
      },
      { root: container, threshold: [0, 0.5, 1] },
    )

    for (const id of ids) {
      const el = container.querySelector(`[data-msg-id="${id}"]`)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [containerRef, anchorIdsKey])

  return activeId
}
