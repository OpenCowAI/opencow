// SPDX-License-Identifier: Apache-2.0

/**
 * Shared constants for the conversation pipeline.
 *
 * Centralises magic numbers used across domain reducer, stream state,
 * and dispatch throttle — ensuring a single source of truth for
 * streaming frequency limits.
 */

/**
 * Maximum interval between IPC dispatches for streaming updates (~60 fps).
 *
 * Used by:
 *   - DispatchThrottle (assistant.partial / tool.progress / hook_progress coalescing)
 *   - ToolProgressRelay (Evose relay default throttle)
 *
 * 16 ms ≈ 60 dispatches/sec, aligned with the browser's requestAnimationFrame
 * cadence.  Each dispatch carries a full message snapshot (~1-10 KB); at 60 fps
 * this amounts to 60-600 KB/sec of IPC throughput — well within Electron's
 * structured-clone capacity.
 *
 * The renderer's rAF buffer (`useAppBootstrap.ts`) further coalesces these into
 * at most one store update per animation frame, so increasing the dispatch rate
 * does NOT increase React render frequency — it only reduces the token-to-pixel
 * latency from ~50ms to ~16ms, making streaming feel noticeably smoother.
 *
 * Previous value was 50ms (20 fps), which created visible text "chunking"
 * compared to modern streaming UIs (Claude.ai, ChatGPT) that update at 30-60fps.
 */
export const DISPATCH_THROTTLE_INTERVAL_MS = 16
