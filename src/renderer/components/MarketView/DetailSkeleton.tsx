// SPDX-License-Identifier: Apache-2.0

import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DetailSkeletonProps {
  onBack: () => void
}

/**
 * Shimmer-animated skeleton shown while marketplace detail is loading.
 * Layout precisely mirrors SkillDetailPanel so the transition from
 * skeleton → real content feels seamless — no layout shifts.
 */
export function DetailSkeleton({ onBack }: DetailSkeletonProps): React.JSX.Element {
  return (
    <div className="flex-1 flex flex-col overflow-hidden market-skeleton-enter">
      {/* ── Header bar — matches SkillDetailPanel header ── */}
      <div className="flex items-center gap-3 pl-6 pr-12 py-3 border-b border-[hsl(var(--border)/0.4)]">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] rounded-md px-2 py-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>

        <div className="flex-1 min-w-0 flex items-center gap-2">
          {/* Title */}
          <Bar className="h-4 w-36" delay={0} />
          {/* Slug */}
          <Bar className="h-3 w-20 opacity-60" delay={40} />
        </div>

        {/* Install button placeholder */}
        <Bar className="h-7 w-[76px] rounded-lg" delay={60} />
      </div>

      {/* ── Content area ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6">
          {/* ── Metadata strip ── */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            {/* Author */}
            <Bar className="h-3.5 w-16" delay={80} />
            {/* Version badge */}
            <Bar className="h-4 w-10 rounded-md" delay={120} />
            {/* Provider badge */}
            <Bar className="h-4 w-14 rounded-md" delay={160} />
            {/* License */}
            <Bar className="h-3.5 w-12" delay={200} />
            {/* Installs */}
            <Bar className="h-3.5 w-20" delay={240} />
            {/* Stars */}
            <Bar className="h-3.5 w-10" delay={280} />
          </div>

          {/* ── Description (2 lines) ── */}
          <div className="mb-6 space-y-2">
            <Bar className="h-3.5 w-full" delay={100} />
            <Bar className="h-3.5 w-3/4" delay={150} />
          </div>

          {/* ── Tags ── */}
          <div className="flex flex-wrap gap-1.5 mb-6">
            {TAG_WIDTHS.map((w, i) => (
              <Bar key={i} className="h-5 rounded-full" style={{ width: w }} delay={200 + i * 40} />
            ))}
          </div>

          {/* ── Bundle contents card ── */}
          <div className="mb-6 p-3 rounded-xl border border-[hsl(var(--border)/0.3)] bg-[hsl(var(--foreground)/0.01)]">
            {/* Section heading */}
            <Bar className="h-3 w-28 mb-3" delay={300} />
            <div className="space-y-2">
              {FILE_WIDTHS.map((w, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Bar className="h-4 w-10 rounded" delay={320 + i * 50} />
                  <Bar className="h-3" style={{ width: w }} delay={340 + i * 50} />
                </div>
              ))}
            </div>
          </div>

          {/* ── SKILL.md content skeleton ── */}
          <hr className="border-t border-[hsl(var(--border)/0.2)] mb-6" />

          <div className="space-y-5">
            {/* Heading 1 */}
            <Bar className="h-5 w-48" delay={400} />

            {/* Paragraph */}
            <div className="space-y-2">
              <Bar className="h-3 w-full" delay={440} />
              <Bar className="h-3 w-11/12" delay={470} />
              <Bar className="h-3 w-4/5" delay={500} />
            </div>

            {/* Heading 2 */}
            <Bar className="h-5 w-32 mt-2" delay={540} />

            {/* Paragraph */}
            <div className="space-y-2">
              <Bar className="h-3 w-full" delay={570} />
              <Bar className="h-3 w-3/4" delay={600} />
              <Bar className="h-3 w-5/6" delay={630} />
              <Bar className="h-3 w-2/3" delay={660} />
            </div>

            {/* Code block placeholder */}
            <div className="rounded-lg border border-[hsl(var(--border)/0.2)] p-4 space-y-2">
              <Bar className="h-3 w-5/6" delay={700} />
              <Bar className="h-3 w-3/5" delay={730} />
              <Bar className="h-3 w-4/5" delay={760} />
            </div>

            {/* Heading 3 */}
            <Bar className="h-5 w-40 mt-2" delay={800} />

            {/* Paragraph */}
            <div className="space-y-2">
              <Bar className="h-3 w-full" delay={830} />
              <Bar className="h-3 w-5/6" delay={860} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Internals ─────────────────────────────────────────────

/** Single shimmer bar — reuses the market-skeleton-bar animation from globals.css */
function Bar({
  className,
  delay = 0,
  style,
}: {
  className?: string
  delay?: number
  style?: React.CSSProperties
}): React.JSX.Element {
  return (
    <div
      className={cn('market-skeleton-bar rounded-md', className)}
      style={{ animationDelay: `${delay}ms`, ...style }}
    />
  )
}

// Vary widths so the skeleton doesn't look robotic
const TAG_WIDTHS = [40, 56, 48, 36, 52]
const FILE_WIDTHS = ['45%', '60%', '35%']
