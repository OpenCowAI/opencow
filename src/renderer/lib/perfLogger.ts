// SPDX-License-Identifier: Apache-2.0

/**
 * perfLogger — Lightweight performance instrumentation for streaming hot paths.
 *
 * Toggle via DevTools console:
 *   window.__PERF_LOG = true    // enable
 *   window.__PERF_LOG = false   // disable (default)
 *
 * When enabled, logs timing data to console with structured prefixes:
 *   [perf:flush:msg]   — message flush cycle
 *   [perf:batch:msg]   — batchAppendSessionMessages internals
 *   [perf:flush:meta]  — metadata flush cycle
 *   [perf:batch:meta]  — batchUpsertManagedSessions internals
 *   [perf:render]      — React component render timing
 *
 * All timing uses `performance.now()` (sub-ms precision).
 * Zero overhead when disabled — the `enabled()` check is a single property read.
 */

declare global {
  interface Window {
    __PERF_LOG?: boolean
  }
}

/** Check if perf logging is enabled (fast path: single property read). */
export function perfEnabled(): boolean {
  return typeof window !== 'undefined' && window.__PERF_LOG === true
}

/** Log a perf event with timing. Only writes when enabled. */
export function perfLog(tag: string, durationMs: number, detail?: Record<string, unknown>): void {
  if (!perfEnabled()) return
  const rounded = Math.round(durationMs * 100) / 100
  if (detail) {
    console.log(`[perf:${tag}] ${rounded}ms`, detail)
  } else {
    console.log(`[perf:${tag}] ${rounded}ms`)
  }
}

/**
 * Start a perf measurement. Returns a function to end it.
 *
 * Usage:
 *   const end = perfStart('batch:msg')
 *   // ... work ...
 *   end({ path: 'fast', msgCount: 1 })
 */
export function perfStart(tag: string): ((detail?: Record<string, unknown>) => void) {
  if (!perfEnabled()) return _noop
  const t0 = performance.now()
  return (detail?: Record<string, unknown>) => {
    perfLog(tag, performance.now() - t0, detail)
  }
}

function _noop(): void { /* no-op when disabled */ }

/**
 * Warn when a measurement exceeds a threshold.
 * Useful for detecting jank in hot paths.
 */
export function perfWarn(tag: string, durationMs: number, thresholdMs: number, detail?: Record<string, unknown>): void {
  if (!perfEnabled()) return
  if (durationMs < thresholdMs) return
  const rounded = Math.round(durationMs * 100) / 100
  console.warn(`[perf:${tag}] ⚠️ ${rounded}ms (>${thresholdMs}ms threshold)`, detail ?? '')
}
