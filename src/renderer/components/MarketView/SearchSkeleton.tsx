// SPDX-License-Identifier: Apache-2.0

import { cn } from '@/lib/utils'

/**
 * Shimmer-animated skeleton shown while marketplace search is in-flight.
 * Mimics the real grouped-results layout (3 groups × 3 cards each)
 * so the transition from skeleton → real content feels seamless.
 */
export function SearchSkeleton(): React.JSX.Element {
  return (
    <div className="market-skeleton-enter">
      <SkeletonGroup delay={0} rows={3} />
      <SkeletonGroup delay={80} rows={3} />
      <SkeletonGroup delay={160} rows={3} />
    </div>
  )
}

// ─── Internals ─────────────────────────────────────────────

function SkeletonGroup({ delay, rows }: { delay: number; rows: number }): React.JSX.Element {
  return (
    <div
      className="mb-4 last:mb-0 opacity-0 market-skeleton-enter"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'forwards' }}
    >
      {/* Group header — mimics MarketGroupSection header */}
      <div className="flex items-center gap-2 px-1 mb-2">
        <div className={cn(BAR, 'h-2.5')} style={{ width: 64 }} />
        <div className={cn(BAR, 'h-2.5')} style={{ width: 20 }} />
      </div>

      {/* Card rows — mimics SkillCard list in a bordered container */}
      <div className="rounded-xl border border-[hsl(var(--border)/0.4)] divide-y divide-[hsl(var(--border)/0.25)] overflow-hidden">
        {Array.from({ length: rows }, (_, i) => (
          <SkeletonRow key={i} index={i} />
        ))}
      </div>
    </div>
  )
}

function SkeletonRow({ index }: { index: number }): React.JSX.Element {
  // Stagger each row slightly for a wave-like shimmer entrance
  const stagger = index * 50

  return (
    <div className="flex items-center gap-3 px-4 h-12">
      {/* Icon placeholder (7×7 rounded-lg — matches SkillCard) */}
      <div
        className={cn(BAR, 'h-7 w-7 rounded-lg shrink-0')}
        style={{ animationDelay: `${stagger}ms` }}
      />

      {/* Text lines */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        {/* Name line */}
        <div
          className={cn(BAR, 'h-3 rounded-md')}
          style={{ width: NAME_WIDTHS[index % NAME_WIDTHS.length], animationDelay: `${stagger + 30}ms` }}
        />
        {/* Description line */}
        <div
          className={cn(BAR, 'h-2 rounded-md')}
          style={{ width: DESC_WIDTHS[index % DESC_WIDTHS.length], animationDelay: `${stagger + 60}ms` }}
        />
      </div>

      {/* Metadata placeholders */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Author */}
        <div
          className={cn(BAR, 'h-2.5 w-12 rounded-md')}
          style={{ animationDelay: `${stagger + 40}ms` }}
        />
        {/* Provider badge */}
        <div
          className={cn(BAR, 'h-4 w-14 rounded-md')}
          style={{ animationDelay: `${stagger + 60}ms` }}
        />
      </div>
    </div>
  )
}

// Shimmer bar — uses the `market-skeleton-bar` class defined in globals.css
const BAR = 'market-skeleton-bar rounded-md'

// Vary widths so the skeleton doesn't look too uniform / robotic
const NAME_WIDTHS = ['40%', '55%', '35%', '48%', '60%']
const DESC_WIDTHS = ['65%', '50%', '70%', '55%', '45%']
