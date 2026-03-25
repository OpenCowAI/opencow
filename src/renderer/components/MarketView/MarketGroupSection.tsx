// SPDX-License-Identifier: Apache-2.0

import { memo } from 'react'
import { AlertCircle, Key, Clock, Loader2 } from 'lucide-react'
import type { MarketSearchGroup, MarketSkillSummary } from '@shared/types'
import { SkillCard } from './SkillCard'

interface MarketGroupSectionProps {
  group: MarketSearchGroup
  selectedSlug: string | null
  onSelect: (skill: MarketSkillSummary) => void
}

/**
 * A single marketplace group section in search results.
 * Renders: section header + status indicator + skill list (or status message).
 *
 * States:
 *   loading     → shimmer skeleton (search in progress)
 *   ok          → skill cards (or "no results" when empty)
 *   needs-key   → API key prompt
 *   rate-limited → rate-limit warning
 *   error       → error message
 */
export const MarketGroupSection = memo(function MarketGroupSection({
  group,
  selectedSlug,
  onSelect,
}: MarketGroupSectionProps): React.JSX.Element {
  // groups are normalised at the hook layer (useMarketSearch) — safe to destructure
  const { status, results, displayName, total } = group

  return (
    <div className="mb-4 last:mb-0">
      {/* Section header */}
      <div className="flex items-center gap-2 px-1 mb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.5)]">
          {displayName}
        </h3>

        {/* Result count for OK state */}
        {status.state === 'ok' && results.length > 0 && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.35)] tabular-nums">
            {total}
          </span>
        )}

        {/* Loading indicator */}
        {status.state === 'loading' && (
          <Loader2 className="h-3 w-3 animate-spin text-[hsl(var(--muted-foreground)/0.3)]" />
        )}

        {/* Status indicators for non-ok states */}
        {status.state === 'needs-key' && (
          <span className="flex items-center gap-1 text-[10px] text-amber-500/80">
            <Key className="h-3 w-3" />
            API Key
          </span>
        )}
        {status.state === 'rate-limited' && (
          <span className="flex items-center gap-1 text-[10px] text-orange-500/80">
            <Clock className="h-3 w-3" />
            Rate limited
          </span>
        )}
        {status.state === 'error' && (
          <span className="flex items-center gap-1 text-[10px] text-red-500/60">
            <AlertCircle className="h-3 w-3" />
            Error
          </span>
        )}
      </div>

      {/* Loading skeleton */}
      {status.state === 'loading' && <GroupSkeleton />}

      {/* Content based on status */}
      {status.state === 'ok' && results.length > 0 && (
        <div className="rounded-xl border border-[hsl(var(--border)/0.4)] divide-y divide-[hsl(var(--border)/0.25)] overflow-hidden">
          {results.map((skill) => (
            <SkillCard
              key={`${skill.marketplaceId}:${skill.slug}`}
              skill={skill}
              isSelected={selectedSlug === skill.slug}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}

      {/* OK but no results */}
      {status.state === 'ok' && results.length === 0 && (
        <div className="rounded-xl border border-[hsl(var(--border)/0.2)] px-4 py-3">
          <p className="text-xs text-[hsl(var(--muted-foreground)/0.4)]">
            No matching skills found
          </p>
        </div>
      )}

      {/* Needs API key */}
      {status.state === 'needs-key' && (
        <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.03] px-4 py-3">
          <p className="text-xs text-[hsl(var(--muted-foreground)/0.6)] leading-relaxed">
            {status.message}
          </p>
        </div>
      )}

      {/* Rate limited */}
      {status.state === 'rate-limited' && (
        <div className="rounded-xl border border-orange-500/15 bg-orange-500/[0.03] px-4 py-3">
          <p className="text-xs text-[hsl(var(--muted-foreground)/0.6)]">
            Too many requests. Please wait a moment and try again.
          </p>
        </div>
      )}

      {/* Error */}
      {status.state === 'error' && (
        <div className="rounded-xl border border-red-500/15 bg-red-500/[0.03] px-4 py-3">
          <p className="text-xs text-red-400/80 leading-relaxed">
            {status.message}
          </p>
        </div>
      )}
    </div>
  )
})

// ─── Skeleton ──────────────────────────────────────────────

/** Compact shimmer skeleton shown while a provider search is in-flight. */
function GroupSkeleton(): React.JSX.Element {
  return (
    <div className="rounded-xl border border-[hsl(var(--border)/0.2)] divide-y divide-[hsl(var(--border)/0.15)] overflow-hidden">
      {[0, 1, 2].map((i) => (
        <div key={i} className="px-4 py-3 flex items-center gap-3 animate-pulse">
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-28 rounded bg-[hsl(var(--foreground)/0.05)]" />
            <div className="h-2.5 w-48 rounded bg-[hsl(var(--foreground)/0.03)]" />
          </div>
        </div>
      ))}
    </div>
  )
}
