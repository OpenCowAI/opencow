// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react'
import { cn } from '../../lib/utils'

interface ContextWindowRingProps {
  /** Last turn's normalized context usage in tokens. */
  contextUsed: number
  /** Maximum context window size in tokens */
  contextLimit: number
  /** Whether context ratio is estimated from static model metadata. */
  estimated?: boolean
  /** Diameter in px (default 18) */
  size?: number
  className?: string
}

function formatTokensShort(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}k`
  return `${count}`
}

/**
 * Tiny SVG ring that visualises context window usage.
 * The filled arc represents the **used** portion; hover tooltip shows remaining %.
 */
export function ContextWindowRing({
  contextUsed,
  contextLimit,
  estimated = false,
  size = 14,
  className
}: ContextWindowRingProps): React.JSX.Element | null {
  const { remainingPct, remainingLabel, color, radius, strokeWidth, circumference, dashOffset } =
    useMemo(() => {
      const usedPct = Math.min(contextUsed / contextLimit, 1)
      const remaining = Math.max(0, 1 - usedPct) * 100
      const remainingLabel = remaining > 0 && remaining < 1 ? '<1' : remaining.toFixed(0)

      // Color thresholds based on remaining %:
      //   green  > 50%  — plenty of room
      //   yellow 25-50% — getting tight
      //   red    < 25%  — danger zone
      let c: string
      if (remaining > 50) {
        c = 'text-emerald-500'
      } else if (remaining > 25) {
        c = 'text-yellow-500'
      } else {
        c = 'text-red-500'
      }

      const sw = 2
      const r = (size - sw) / 2
      const circ = 2 * Math.PI * r
      // dashOffset = unfilled portion → arc fills clockwise for used %
      const offset = circ * (1 - usedPct)

      return {
        remainingPct: remaining,
        remainingLabel,
        color: c,
        radius: r,
        strokeWidth: sw,
        circumference: circ,
        dashOffset: offset
      }
    }, [contextUsed, contextLimit, size])

  const center = size / 2

  // Don't render when no data is available yet
  if (contextUsed <= 0 || contextLimit <= 0) return null

  return (
    <span
      className={cn('group/ring relative inline-flex items-center shrink-0 cursor-default', className)}
      role="meter"
      aria-valuenow={Math.round(remainingPct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Context window: ${remainingLabel}% remaining${estimated ? ' (estimated)' : ''}`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn('block transform -rotate-90', color)}
        aria-hidden="true"
      >
        {/* Background track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          opacity={0.2}
        />
        {/* Filled arc — represents used portion of context window */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      {/* Hover tooltip */}
      <span
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[hsl(var(--popover))] px-2 py-1 text-[11px] leading-tight text-[hsl(var(--popover-foreground))] shadow-md border border-[hsl(var(--border))] opacity-0 scale-95 transition-all duration-150 group-hover/ring:opacity-100 group-hover/ring:scale-100"
        aria-hidden="true"
      >
        Context: {remainingLabel}% remaining{estimated ? ' (estimated)' : ''}
        <span className="block text-[hsl(var(--muted-foreground))]">
          {formatTokensShort(contextUsed)} / {formatTokensShort(contextLimit)} tokens
        </span>
      </span>
    </span>
  )
}
