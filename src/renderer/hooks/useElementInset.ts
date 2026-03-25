// SPDX-License-Identifier: Apache-2.0

import { useRef, useState, useEffect, useLayoutEffect, type RefObject } from 'react'

/**
 * Tracks the rendered height (px) of an absolutely-positioned overlay element.
 *
 * Designed for the "overlay inset" pattern where a floating panel sits on top of
 * a scroll container and the scroll container needs equivalent bottom padding so
 * content is never hidden behind the overlay (same principle as iOS contentInset).
 *
 * ## Dual-track measurement strategy
 *
 * | Track | Mechanism | When it fires | Purpose |
 * |-------|-----------|---------------|---------|
 * | Synchronous | `useLayoutEffect` + explicit deps | Before browser paint, on React-driven state changes | Eliminates visual glitch on discrete transitions (e.g. isProcessing toggle) |
 * | Asynchronous | `ResizeObserver` | After paint, on any size change | Catches non-React-driven changes (textarea paste, browser auto-resize) |
 *
 * @param deps - Dependencies that correspond to structural changes in the overlay
 *   content (e.g. `[isProcessing, inputHidden]`). The synchronous measurement
 *   fires only when these deps change, avoiding the double-render-on-every-render
 *   anti-pattern of a dependency-less useLayoutEffect.
 *
 * @returns `[ref, insetPx]` — attach `ref` to the overlay DOM element, read
 *   `insetPx` as the measured height to use as bottom padding / inset.
 */
export function useElementInset(
  deps: readonly unknown[]
): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [inset, setInset] = useState(0)

  // ── Synchronous track ──────────────────────────────────────────────
  // Fires before browser paint when overlay structure changes (deps).
  // Single DOM read + conditional setState — negligible cost.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (ref.current) {
      setInset(ref.current.offsetHeight)
    }
  }, deps)

  // ── Asynchronous track ─────────────────────────────────────────────
  // ResizeObserver catches size changes that happen outside React's
  // commit cycle (e.g. TipTap editor paste resizing, CSS animations).
  // Math.round + prev-comparison guards against sub-pixel jitter and
  // avoids unnecessary re-renders.
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      const h = Math.round(
        entries[0]?.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight
      )
      setInset((prev) => (prev === h ? prev : h))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, inset]
}
