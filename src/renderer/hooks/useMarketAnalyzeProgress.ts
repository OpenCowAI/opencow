// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useRef } from 'react'
import type { DataBusEvent, MarketAnalysisPhase } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ─── Types ───────────────────────────────────────────────

/**
 * Re-export the canonical phase type for renderer consumers.
 * Single source of truth lives in @shared/types — never duplicate phases here.
 */
export type AnalyzeProgressPhase = MarketAnalysisPhase

export interface AnalyzeProgressState {
  /** Current phase of the analysis */
  phase: AnalyzeProgressPhase
  /** Human-readable description */
  detail?: string
  /** Tool name when the Agent is using a tool */
  toolName?: string
  /** Elapsed time in seconds since analysis started */
  elapsedSec: number
}

export interface UseMarketAnalyzeProgressResult {
  /** Current analysis progress, or null if no analysis is in flight. */
  progress: AnalyzeProgressState | null
  /** Reset progress state (call when analysis completes or dialog closes). */
  reset: () => void
}

/** Phases that signal analysis is done (no more timer ticks needed). */
const TERMINAL_PHASES: ReadonlySet<string> = new Set(['agent:done', 'cancelled'])

// ─── Internal helpers ─────────────────────────────────────

/** Clear the interval timer and reset start time. Idempotent. */
function clearTimerState(
  intervalRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
  startTimeRef: React.MutableRefObject<number | null>,
): void {
  startTimeRef.current = null
  if (intervalRef.current !== null) {
    clearInterval(intervalRef.current)
    intervalRef.current = null
  }
}

// ─── Hook ────────────────────────────────────────────────

/**
 * Subscribes to `market:analyze:progress` DataBus events and tracks
 * real-time analysis progress for a specific marketplace slug.
 *
 * Also tracks elapsed time via a 1-second interval that starts on the
 * first progress event and stops when a terminal phase is reached.
 *
 * The hook filters events by slug to avoid cross-talk when multiple
 * analyses are theoretically in flight (e.g. from different windows).
 */
export function useMarketAnalyzeProgress(slug: string | null): UseMarketAnalyzeProgressResult {
  const [progress, setProgress] = useState<AnalyzeProgressState | null>(null)
  const slugRef = useRef(slug)
  slugRef.current = slug

  // Elapsed time tracking
  const startTimeRef = useRef<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up interval on unmount
  useEffect(() => {
    return () => clearTimerState(intervalRef, startTimeRef)
  }, [])

  useEffect(() => {
    if (!slug) {
      setProgress(null)
      clearTimerState(intervalRef, startTimeRef)
      return
    }

    // Reset timer state for new slug (fixes P1: timer leak on slug change)
    setProgress(null)
    clearTimerState(intervalRef, startTimeRef)

    const unsub = getAppAPI()['on:opencow:event']((event: DataBusEvent) => {
      if (event.type !== 'market:analyze:progress') return
      if (event.payload.slug !== slugRef.current) return

      const phase = event.payload.phase

      // Start elapsed timer on first progress event
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now()
        if (intervalRef.current === null) {
          intervalRef.current = setInterval(() => {
            if (startTimeRef.current === null) return
            const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000)
            setProgress((prev) => prev ? { ...prev, elapsedSec: elapsed } : null)
          }, 1000)
        }
      }

      // Stop timer on terminal phases
      if (TERMINAL_PHASES.has(phase) && intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }

      const elapsed = startTimeRef.current
        ? Math.floor((Date.now() - startTimeRef.current) / 1000)
        : 0

      setProgress({
        phase,
        detail: event.payload.detail,
        toolName: event.payload.toolName,
        elapsedSec: elapsed,
      })
    })

    return () => {
      unsub()
      // Clear interval on slug change to prevent timer leak
      clearTimerState(intervalRef, startTimeRef)
    }
  }, [slug])

  const reset = useCallback(() => {
    setProgress(null)
    clearTimerState(intervalRef, startTimeRef)
  }, [])

  return { progress, reset }
}
