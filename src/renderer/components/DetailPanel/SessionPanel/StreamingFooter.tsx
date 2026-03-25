// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { computeActiveDuration, formatDuration } from '@/lib/sessionHelpers'
import { TodoStatusPill } from './TodoWidgets'
import type { TodoItem } from './TodoWidgets'

const STATUS_ROTATE_MS = 4000

function formatTokens(count: number): string {
  if (count < 1000) return `${count}`
  return `${(count / 1000).toFixed(1)}k`
}

interface StreamingFooterProps {
  /** Cumulative active time already settled (ms). */
  activeDurationMs: number
  /** Epoch ms when the current active segment started; `null` when not active. */
  activeStartedAt: number | null
  inputTokens: number
  outputTokens: number
  activity: string | null
  todos: TodoItem[] | null
  /** When true, renders with rounded corners and a full border instead of just border-top */
  rounded?: boolean
}

export const StreamingFooter = React.memo(function StreamingFooter({
  activeDurationMs,
  activeStartedAt,
  inputTokens,
  outputTokens,
  activity,
  todos,
  rounded = false
}: StreamingFooterProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const statusTexts = t('streamingFooter.statusTexts', { returnObjects: true }) as string[]

  const [elapsed, setElapsed] = useState(() =>
    computeActiveDuration({ accumulatedMs: activeDurationMs, activeStartedAt }),
  )
  const [statusIndex, setStatusIndex] = useState(
    () => Math.floor(Math.random() * statusTexts.length)
  )
  const elapsedRef = useRef<ReturnType<typeof setInterval>>(undefined)
  const statusRef = useRef<ReturnType<typeof setInterval>>(undefined)

  useEffect(() => {
    elapsedRef.current = setInterval(() => {
      setElapsed(computeActiveDuration({ accumulatedMs: activeDurationMs, activeStartedAt }))
    }, 1000)
    return () => clearInterval(elapsedRef.current)
  }, [activeDurationMs, activeStartedAt])

  useEffect(() => {
    statusRef.current = setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % statusTexts.length)
    }, STATUS_ROTATE_MS)
    return () => clearInterval(statusRef.current)
  }, [])

  const totalTokens = inputTokens + outputTokens

  // During compact / memory optimization, replace the rotating status text
  // with a stable label so the user sees a coherent message instead of
  // "Thinking… (… · Optimizing memory…)" which reads as two unrelated things.
  const isOptimizing = activity != null && activity.includes('Optimizing')
  const displayStatus = isOptimizing ? 'Optimizing' : statusTexts[statusIndex]

  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1.5 bg-[hsl(var(--muted))] font-mono text-xs shrink-0 ${rounded ? 'rounded-lg border border-[hsl(var(--border))]' : 'border-t border-[hsl(var(--border))]'}`}
      role="status"
      aria-live="polite"
      aria-label={`Streaming: ${displayStatus} ${formatDuration(elapsed)}${activity ? ` ${activity}` : ''}`}
    >
      <span
        className="sparkle-spinner text-orange-400 shrink-0"
        aria-hidden="true"
        data-testid="sparkle-spinner"
      />
      <span className="text-orange-400/80">{displayStatus}{'\u2026'}</span>
      <span className="text-[hsl(var(--muted-foreground)/0.6)]">
        ({formatDuration(elapsed)}
        {totalTokens > 0 && <>{` \u00b7 \u2193 ${formatTokens(totalTokens)} tokens`}</>}
        {activity && !isOptimizing && <>{` \u00b7 ${activity}`}</>}
        )
      </span>
      {/* Todo status pill — right-aligned */}
      {todos && (
        <span className="ml-auto">
          <TodoStatusPill todos={todos} />
        </span>
      )}
    </div>
  )
})
