// SPDX-License-Identifier: Apache-2.0

/**
 * StreamingOverlayContent — self-subscribing overlay for streaming state.
 *
 * Renders StreamingFooter (during processing) or TodoStatusPill (when paused
 * with pending todos).
 *
 * Self-subscribing architecture:
 *   - `selectSessionMessages` → latestTodos derivation
 *   - `useStreamingSessionMetrics` → per-frame volatile data (token counts,
 *     duration, activity) — subscribed directly instead of via props from
 *     SessionPanel, so SessionPanel doesn't re-render on every streaming tick.
 *
 * Only `sessionId`, `isProcessing`, and `isSessionPaused` come from the parent.
 * These are stable during streaming and don't trigger parent re-renders.
 */
import React from 'react'
import { StreamingFooter } from './StreamingFooter'
import { TodoStatusPill } from './TodoWidgets'
import { useCommandStore, selectLatestOpenTodos, useStreamingSessionMetrics } from '@/stores/commandStore'

interface StreamingOverlayContentProps {
  sessionId: string
  isProcessing: boolean
  isSessionPaused: boolean
}

export const StreamingOverlayContent = React.memo(function StreamingOverlayContent({
  sessionId,
  isProcessing,
  isSessionPaused,
}: StreamingOverlayContentProps): React.JSX.Element | null {
  const latestTodos = useCommandStore((s) => selectLatestOpenTodos(s, sessionId))
  const metrics = useStreamingSessionMetrics(sessionId)

  // `mx-3 mt-1` lifts both the streaming footer and the todo pill rail
  // off the message list and aligns their horizontal edges with the
  // floating `SessionInputBar` card below (which uses `mx-3 mb-3 mt-1`).
  // `rounded` on the footer swaps its `border-t` strip chrome for a
  // pill with full border + rounded corners — same chip vibe as the
  // input bar, so the bottom overlay reads as one cohesive stack of
  // floating cards instead of a row of full-bleed strips.
  if (isProcessing && metrics) {
    return (
      <div className="mx-3 mt-1 shrink-0">
        <StreamingFooter
          activeDurationMs={metrics.activeDurationMs}
          activeStartedAt={metrics.activeStartedAt}
          inputTokens={metrics.inputTokens}
          outputTokens={metrics.outputTokens}
          activity={metrics.activity}
          todos={latestTodos}
          rounded
        />
      </div>
    )
  }

  if (latestTodos) {
    return (
      <div className="mx-3 mt-1 flex items-center justify-end px-3 py-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] shrink-0">
        <TodoStatusPill todos={latestTodos} isPaused={isSessionPaused} />
      </div>
    )
  }

  return null
})
