// SPDX-License-Identifier: Apache-2.0

import { memo, useMemo } from 'react'
import { cn } from '../../lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single arc segment in the ring. */
export interface RingSegment {
  /** Proportional value (absolute count — the ring computes ratios internally). */
  value: number
  /** Tailwind stroke-* class for this segment's color. */
  color: string
  /** Human-readable label used in tooltip and aria-label. */
  label: string
}

interface SegmentedRingProps {
  /** Ordered arc segments — rendered clockwise starting from 12 o'clock. */
  segments: RingSegment[]
  /** Diameter in px (default 20). */
  size?: number
  /** Ring thickness in px (default 2.5). */
  strokeWidth?: number
  /** Optional content rendered at the center of the ring (e.g. a count). */
  children?: React.ReactNode
  className?: string
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ComputedArc {
  key: string
  colorClass: string
  dashArray: string
  dashOffset: number
}

interface ComputedRing {
  arcs: ComputedArc[]
  tooltipLines: string[]
  ariaLabel: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Generic multi-segment SVG donut ring.
 *
 * Each segment occupies a proportional arc whose length is determined by its
 * `value` relative to the total. Segments with `value <= 0` are skipped.
 *
 * The component is domain-agnostic — it knows nothing about issues, statuses,
 * or any business concept. Callers map domain data to `RingSegment[]`.
 *
 * Technique: Each arc is a `<circle>` with a `strokeDasharray` that draws
 * only its portion of the circumference, offset by the cumulative length of
 * preceding arcs. A -90° rotation on the SVG ensures arcs start from the
 * 12 o'clock position and proceed clockwise.
 */
export const SegmentedRing = memo(function SegmentedRing({
  segments,
  size = 20,
  strokeWidth = 2.5,
  children,
  className
}: SegmentedRingProps): React.JSX.Element | null {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const center = size / 2

  const computed = useMemo<ComputedRing | null>(() => {
    // Filter to non-empty segments and compute total
    const active = segments.filter((s) => s.value > 0)
    if (active.length === 0) return null

    const total = active.reduce((sum, s) => sum + s.value, 0)
    if (total <= 0) return null

    const arcs: ComputedArc[] = []
    const tooltipLines: string[] = []
    let cumulativeLength = 0

    for (const seg of active) {
      const segmentLength = circumference * (seg.value / total)
      // Add 0.5px overlap to eliminate sub-pixel gaps between adjacent segments.
      // The last segment doesn't need overlap (it wraps back to the first).
      const isLast = seg === active[active.length - 1]
      const adjustedLength = segmentLength + (isLast ? 0 : 0.5)

      arcs.push({
        key: seg.label,
        colorClass: seg.color,
        dashArray: `${adjustedLength} ${circumference - adjustedLength}`,
        dashOffset: -cumulativeLength
      })

      tooltipLines.push(`${seg.value} ${seg.label}`)
      cumulativeLength += segmentLength // advance by exact length, not adjusted
    }

    const ariaLabel = tooltipLines.join(', ')
    return { arcs, tooltipLines, ariaLabel }
  }, [segments, circumference])

  if (!computed) return null

  return (
    <span
      className={cn(
        'group/ring relative inline-flex items-center justify-center shrink-0 cursor-default',
        className
      )}
      role="img"
      aria-label={computed.ariaLabel}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90"
        aria-hidden="true"
      >
        {/* Background track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          className="stroke-[hsl(var(--muted))]"
          strokeWidth={strokeWidth}
          opacity={0.3}
        />
        {/* Arc segments */}
        {computed.arcs.map((arc) => (
          <circle
            key={arc.key}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            className={arc.colorClass}
            strokeWidth={strokeWidth}
            strokeDasharray={arc.dashArray}
            strokeDashoffset={arc.dashOffset}
            strokeLinecap="butt"
          />
        ))}
      </svg>

      {/* Center content (e.g. total count) */}
      {children && (
        <span
          className="absolute inset-0 flex items-center justify-center leading-none"
          aria-hidden="true"
        >
          {children}
        </span>
      )}

      {/* Hover tooltip — follows project convention (see ContextWindowRing) */}
      <span
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[hsl(var(--popover))] px-2 py-1 text-[11px] leading-tight text-[hsl(var(--popover-foreground))] shadow-md border border-[hsl(var(--border))] opacity-0 scale-95 transition-all duration-150 group-hover/ring:opacity-100 group-hover/ring:scale-100"
        aria-hidden="true"
      >
        {computed.tooltipLines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </span>
    </span>
  )
})
