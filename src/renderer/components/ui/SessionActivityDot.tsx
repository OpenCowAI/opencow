// SPDX-License-Identifier: Apache-2.0

import { memo, useEffect, useState } from 'react'
import { cn } from '../../lib/utils'
import { computeActiveDuration, formatDuration } from '@/lib/sessionHelpers'
import type { ActiveDuration } from '@/lib/sessionHelpers'
import type { ManagedSessionState } from '@shared/types'

interface SessionActivityDotProps {
  state: ManagedSessionState
  /** Active duration tracking — omit to show the default label. */
  activeDuration?: ActiveDuration
}

interface StateConfig {
  dotColor: string
  textColor: string
  bgColor: string
  label: string
  animate: boolean
}

/** States that should show elapsed active time instead of the default label. */
const DURATION_STATES: ReadonlySet<ManagedSessionState> = new Set(['streaming', 'idle'])

function getStateConfig(state: ManagedSessionState): StateConfig | null {
  switch (state) {
    case 'creating':
      return { dotColor: 'bg-blue-500', textColor: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-500/10', label: 'Starting', animate: true }
    case 'streaming':
      return { dotColor: 'bg-green-500', textColor: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-500/10', label: 'Running', animate: true }
    case 'awaiting_input':
      return null // Agent is not actively working; no attention-grabbing indicator needed
    case 'awaiting_question':
      return { dotColor: 'bg-amber-500', textColor: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-500/10', label: 'Waiting for answer', animate: false }
    case 'stopping':
      return { dotColor: 'bg-blue-500', textColor: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-500/10', label: 'Stopping', animate: true }
    case 'error':
      return { dotColor: 'bg-red-500', textColor: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-500/10', label: 'Error', animate: false }
    case 'idle':
      return { dotColor: 'bg-gray-400', textColor: 'text-gray-600 dark:text-gray-400', bgColor: 'bg-gray-400/10', label: 'Idle', animate: false }
    case 'stopped':
      return null
  }
}

/**
 * Session activity badge for list contexts.
 * Pill-shaped with animated dot + label for clear visibility.
 * Returns null for stopped sessions (no user attention needed).
 *
 * When `activeDuration` is provided and state is Running or Idle,
 * the label is replaced with the session's cumulative active time.
 */
export const SessionActivityDot = memo(function SessionActivityDot({
  state,
  activeDuration,
}: SessionActivityDotProps): React.JSX.Element | null {
  const config = getStateConfig(state)
  const showDuration = activeDuration != null && DURATION_STATES.has(state)

  // Tick every second so the elapsed time stays current (only for streaming — idle is static).
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!showDuration || state !== 'streaming') return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [showDuration, state])

  if (!config) return null

  const displayLabel = showDuration
    ? formatDuration(computeActiveDuration(activeDuration))
    : config.label

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-none',
        config.bgColor, config.textColor,
        showDuration && 'tabular-nums'
      )}
      role="status"
      aria-label={`Session ${config.label.toLowerCase()}${showDuration ? ` for ${displayLabel}` : ''}`}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          config.dotColor,
          config.animate && 'motion-safe:animate-pulse'
        )}
        aria-hidden="true"
      />
      {displayLabel}
    </span>
  )
})
