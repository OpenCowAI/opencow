// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect } from 'react'

/**
 * Returns a human-readable countdown string for a schedule's nextRunAt timestamp.
 * Updates every second.
 */
export function useScheduleCountdown(nextRunAt: number | null): string {
  const [countdown, setCountdown] = useState(() => formatCountdown(nextRunAt))

  useEffect(() => {
    if (nextRunAt === null) {
      setCountdown('—')
      return
    }

    const update = () => setCountdown(formatCountdown(nextRunAt))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [nextRunAt])

  return countdown
}

function formatCountdown(targetMs: number | null): string {
  if (targetMs === null) return '—'

  const diff = targetMs - Date.now()
  if (diff <= 0) return 'now'

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}
