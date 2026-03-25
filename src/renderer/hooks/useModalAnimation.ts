// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react'

/**
 * Duration of the CSS exit animations (overlay + content both 150ms).
 *
 * Only exit timing is tracked in JS — it drives the unmount delay
 * (`setMounted(false)` must wait until the exit animation finishes).
 *
 * Enter animations need no JS timer at all.  CSS animations play once
 * on class-add and finish naturally (`animation-fill-mode` defaults to
 * `none`, so the element returns to base styles on its own).  The
 * `phase` stays `'enter'` until close triggers `'exit'` — this avoids
 * an unnecessary React re-render and, crucially, prevents the
 * compositor-destabilising style recalc that would occur if we removed
 * the animation class (causing the shell to lose its animation-driven
 * `transform`, demoting its GPU layer, and forcing a backdrop-filter
 * re-evaluation that manifests as overlay flicker).
 */
const FALLBACK_EXIT_DURATION_MS = 150
const MODAL_EXIT_DURATION_VAR = '--modal-exit-duration'
const DIALOG_DATA_CLEANUP_BUFFER_MS = 10

export const EXIT_DURATION = FALLBACK_EXIT_DURATION_MS

type Phase = 'enter' | 'exit' | null

function parseCssDurationMs(raw: string): number | null {
  const value = raw.trim()
  if (value.length === 0) return null
  if (value.endsWith('ms')) {
    const ms = Number.parseFloat(value.slice(0, -2))
    return Number.isFinite(ms) ? ms : null
  }
  if (value.endsWith('s')) {
    const seconds = Number.parseFloat(value.slice(0, -1))
    return Number.isFinite(seconds) ? seconds * 1000 : null
  }
  const numeric = Number.parseFloat(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function resolveModalExitDurationMs(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return FALLBACK_EXIT_DURATION_MS
  }
  const cssValue = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(MODAL_EXIT_DURATION_VAR)
  const parsed = parseCssDurationMs(cssValue)
  if (parsed === null || parsed <= 0) {
    return FALLBACK_EXIT_DURATION_MS
  }
  return parsed
}

interface ModalAnimationState {
  mounted: boolean
  phase: Phase
}

type ModalAnimationAction =
  | { type: 'open' }
  | { type: 'start-exit' }
  | { type: 'finish-exit' }

function modalAnimationReducer(
  state: ModalAnimationState,
  action: ModalAnimationAction
): ModalAnimationState {
  switch (action.type) {
    case 'open':
      return { mounted: true, phase: 'enter' }
    case 'start-exit':
      return state.mounted ? { mounted: true, phase: 'exit' } : state
    case 'finish-exit':
      return { mounted: false, phase: null }
  }
}

// ---------------------------------------------------------------------------
// useModalAnimation — for modals controlled by an `open` boolean prop
// ---------------------------------------------------------------------------

/**
 * Manages mount/unmount lifecycle with enter & exit CSS animations.
 *
 * Usage (Dialog, ConfirmDialog, CommandPalette):
 * ```ts
 * const { mounted, phase } = useModalAnimation(open)
 * if (!mounted) return null
 * // Apply phase === 'enter' → 'modal-overlay-enter' / 'modal-content-enter'
 * // Apply phase === 'exit'  → 'modal-overlay-exit'  / 'modal-content-exit'
 * ```
 */
export function useModalAnimation(open: boolean): {
  mounted: boolean
  phase: Phase
} {
  const [state, dispatch] = useReducer(modalAnimationReducer, {
    mounted: open,
    phase: open ? 'enter' : null
  })
  const mountedRef = useRef(open)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    if (open) {
      mountedRef.current = true
      dispatch({ type: 'open' })
      // No timer — the CSS enter animation completes on its own.
      // phase stays 'enter' until close, see module doc for rationale.
    } else if (mountedRef.current) {
      dispatch({ type: 'start-exit' })
      const exitDurationMs = resolveModalExitDurationMs()
      timer = setTimeout(() => {
        mountedRef.current = false
        dispatch({ type: 'finish-exit' })
      }, exitDurationMs)
    }

    return () => {
      if (timer !== null) clearTimeout(timer)
    }
  }, [open])

  return state
}

// ---------------------------------------------------------------------------
// useExitAnimation — for modals conditionally rendered by their parent
// ---------------------------------------------------------------------------

/**
 * Provides enter animation on mount and an exit animation before unmount.
 * The component intercepts the `onClose` callback to play the exit animation
 * first, then invokes the real `onClose` after the animation finishes.
 *
 * Usage (IssueFormModal, ImageLightbox, SvgViewer):
 * ```ts
 * const { phase, requestClose } = useExitAnimation(onClose)
 * // Apply phase === 'enter' → 'modal-overlay-enter' / 'modal-content-enter'
 * // Apply phase === 'exit'  → 'modal-overlay-exit'  / 'modal-content-exit'
 * // Use requestClose instead of onClose for all close actions
 * ```
 */
export function useExitAnimation(onClose: () => void): {
  phase: Phase
  requestClose: () => void
} {
  const [phase, setPhase] = useState<Phase>('enter')
  const onCloseRef = useRef(onClose)
  const closingRef = useRef(false)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // No enter timer — same rationale as useModalAnimation.
  // phase stays 'enter' until requestClose triggers 'exit'.

  const requestClose = useCallback(() => {
    if (closingRef.current) return // prevent double-close
    closingRef.current = true
    setPhase('exit')
    setTimeout(() => onCloseRef.current(), resolveModalExitDurationMs())
  }, [])

  return { phase, requestClose }
}

// ---------------------------------------------------------------------------
// useDialogState — for data-driven dialogs where data doubles as visibility
// ---------------------------------------------------------------------------

/**
 * Encapsulates the "two-phase close" pattern for dialogs whose visibility is
 * driven by data (e.g. `viewingArtifact`, `viewerFile`).
 *
 * Problem: `{data && <Dialog open={true} />}` unmounts instantly on data clear,
 * preventing exit animation. Consumers need `open` state, a data ref, and a
 * delayed clear — this hook bundles all three.
 *
 * Usage:
 * ```ts
 * const viewer = useDialogState<ArtifactData>()
 *
 * // Open:  viewer.show(artifact)
 * // Close: viewer.close()  — plays exit animation, then clears data
 *
 * // Render:
 * {viewer.data && (
 *   <ArtifactViewerDialog open={viewer.open} onClose={viewer.close} data={viewer.data} />
 * )}
 * ```
 */
export function useDialogState<T>(): {
  /** Whether the dialog should be visible (drives Dialog `open` prop / animation). */
  open: boolean
  /** Display data — persists during exit animation so children don't flash empty. */
  data: T | null
  /** Open the dialog with the given data. */
  show: (data: T) => void
  /** Trigger exit animation, then clear data after animation completes. */
  close: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [open, setOpen] = useState(false)
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (cleanupTimerRef.current !== null) {
        clearTimeout(cleanupTimerRef.current)
      }
    }
  }, [])

  const show = useCallback((d: T) => {
    // Cancel any pending cleanup from a previous close (rapid open → close → open)
    if (cleanupTimerRef.current !== null) {
      clearTimeout(cleanupTimerRef.current)
      cleanupTimerRef.current = null
    }
    setData(d)
    setOpen(true)
  }, [])

  const close = useCallback(() => {
    if (cleanupTimerRef.current !== null) {
      clearTimeout(cleanupTimerRef.current)
    }
    setOpen(false)
    const exitDurationMs = resolveModalExitDurationMs()
    // Clear data after exit animation + a small buffer to avoid same-frame teardown.
    cleanupTimerRef.current = setTimeout(() => {
      cleanupTimerRef.current = null
      setData(null)
    }, exitDurationMs + DIALOG_DATA_CLEANUP_BUFFER_MS)
  }, [])

  return useMemo(
    () => ({ open, data, show, close }),
    [open, data, show, close]
  )
}
