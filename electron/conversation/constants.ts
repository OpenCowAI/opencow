// SPDX-License-Identifier: Apache-2.0

/**
 * Shared constants for the conversation pipeline.
 *
 * Centralises magic numbers used across domain reducer, stream state,
 * and dispatch throttle — ensuring a single source of truth for
 * streaming frequency limits.
 */

/**
 * Maximum interval between IPC dispatches for streaming updates (~20 fps).
 *
 * Used by:
 *   - DispatchThrottle (assistant.partial / tool.progress / hook_progress coalescing)
 *   - ToolProgressRelay (Evose relay default throttle)
 *
 * 50 ms ≈ 20 dispatches/sec.  Each dispatch carries a full message snapshot
 * via Electron structured-clone (~1-50 KB depending on response length).
 * At 60 fps (16 ms) the per-frame IPC serialisation cost grew linearly with
 * message size and consumed 1-5 ms of the renderer's 16 ms frame budget,
 * leaving insufficient headroom for input handling and scroll events — causing
 * perceptible UI lag during active streaming.
 *
 * Raising the interval to 50 ms reduces IPC dispatches by ~66%, freeing
 * ~3-8 ms/frame for user interaction.  The renderer's write-coalescing buffer
 * (`useAppBootstrap.ts`) further batches these into at most one Zustand
 * store update per 33 ms, so the visual streaming cadence is ~20-30 fps —
 * perceptually smooth for text content.
 *
 * Terminal events (assistant.final, turn.result, protocol.violation) call
 * `DispatchThrottle.flushNow()` and bypass this interval entirely, so final
 * messages are never delayed.
 */
export const DISPATCH_THROTTLE_INTERVAL_MS = 50

/**
 * Maximum interval between IPC dispatches for tool.progress-only updates (~5 fps).
 *
 * tool.progress events fire at 100+/sec during Claude engine tool execution,
 * but the progress output is a scrollable log — 5 fps visual updates are
 * perceptually smooth.  Separating progress from the main message throttle
 * (50 ms) reduces IPC round-trips for progress-only changes by 75%.
 *
 * Text streaming (assistant.partial) remains at 50 ms for responsive text
 * appearance.  Only tool.progress uses this longer interval.
 */
export const PROGRESS_THROTTLE_INTERVAL_MS = 200

/**
 * Maximum progress string length sent over IPC (characters).
 *
 * tool.progress accumulates to 50-200 KB during long tool executions.
 * The renderer's ToolProgressText component only displays the last 8000
 * characters.  Sending the full string wastes 96%+ of structured clone
 * budget on data that will never be rendered.
 *
 * Capping at the IPC boundary reduces per-dispatch serialisation cost
 * from 1-5 ms to <0.1 ms, freeing the main process event loop and the
 * renderer main thread for input handling and scrolling.
 */
export const IPC_PROGRESS_CAP_CHARS = 8000
