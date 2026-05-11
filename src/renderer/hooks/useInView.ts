// SPDX-License-Identifier: Apache-2.0

import { useCallback, useRef, useState } from 'react'

/**
 * Default pre-warm band added on top and bottom of the viewport when
 * deciding whether an element is "in view".  Roughly one screenful below
 * the fold gives card content time to load before the user scrolls there.
 */
export const IN_VIEW_PRE_WARM_PX = 200

/**
 * One-shot intersection probe — flips to `true` the first time the
 * element is inside the viewport (plus `rootMarginPx` pre-warm band) and
 * never flips back.  Designed for "lazy-mount once the user might see it"
 * use cases like card thumbnails or disk-backed previews.
 *
 * Strategy:
 *   1. Synchronously check `getBoundingClientRect()` in the ref callback
 *      (layout is complete at that point).  If the element already sits
 *      inside the viewport + pre-warm band, flip `inView` straight away —
 *      `IntersectionObserver`'s async initial callback can miss this on
 *      the first paint after mount, which used to leave above-the-fold
 *      cards stuck on a loading state until the user manually scrolled.
 *   2. Only when the initial check reports "off-screen" do we install an
 *      `IntersectionObserver` and wait for the user to scroll there.
 */
export function useInView(rootMarginPx = IN_VIEW_PRE_WARM_PX): {
  ref: (node: Element | null) => void
  inView: boolean
} {
  const [inView, setInView] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  // Once flipped, never go back — late ref re-attachments mustn't
  // re-create the observer or re-trigger the initial probe.
  const settledRef = useRef(false)

  const ref = useCallback(
    (node: Element | null) => {
      observerRef.current?.disconnect()
      observerRef.current = null
      if (!node || settledRef.current) return

      const rect = node.getBoundingClientRect()
      const inViewport =
        rect.bottom > -rootMarginPx &&
        rect.top < window.innerHeight + rootMarginPx
      if (inViewport) {
        settledRef.current = true
        setInView(true)
        return
      }

      const obs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              settledRef.current = true
              setInView(true)
              obs.disconnect()
              return
            }
          }
        },
        { rootMargin: `${rootMarginPx}px` },
      )
      obs.observe(node)
      observerRef.current = obs
    },
    [rootMarginPx],
  )

  return { ref, inView }
}
