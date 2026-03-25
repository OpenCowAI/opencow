// SPDX-License-Identifier: Apache-2.0

import { memo } from 'react'
import { Download, ExternalLink, Star, User, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MarketSkillSummary } from '@shared/types'
import { getProviderTheme } from './providerTheme'

interface SkillCardProps {
  skill: MarketSkillSummary
  isSelected: boolean
  onSelect: (skill: MarketSkillSummary) => void
}

/**
 * Row-style card for a marketplace skill.
 *
 * Two-line layout:
 *   Line 1 — Name · slug · version badge · Official tag
 *   Line 2 — Description
 *
 * Right-aligned metadata mirrors ClawHub.ai richness:
 *   author | 📦 installs | ★ stars | versions | provider badge
 */
export const SkillCard = memo(function SkillCard({
  skill,
  isSelected,
  onSelect,
}: SkillCardProps): React.JSX.Element {
  const theme = getProviderTheme(skill.marketplaceId)

  return (
    <button
      type="button"
      onClick={() => onSelect(skill)}
      className={cn(
        'group w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors outline-none',
        'hover:bg-[hsl(var(--foreground)/0.02)]',
        'focus-visible:bg-[hsl(var(--primary)/0.05)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]',
        isSelected && 'bg-[hsl(var(--primary)/0.04)]',
      )}
    >
      {/* Icon */}
      <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-amber-500/10 shrink-0">
        <Download className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
      </div>

      {/* Name + slug + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate text-[hsl(var(--foreground))]">
            {skill.name}
          </span>
          {/* Slug — like ClawHub's /deep-research-pro */}
          <span className="text-[11px] text-[hsl(var(--muted-foreground)/0.35)] truncate shrink-[2]">
            /{skill.slug.split('/').pop()}
          </span>
          {skill.version && (
            <span className="text-[10px] leading-none px-1.5 py-0.5 rounded-md bg-[hsl(var(--muted)/0.4)] text-[hsl(var(--muted-foreground)/0.8)] shrink-0">
              v{skill.version}
            </span>
          )}
        </div>
        {skill.description && (
          <p className="text-xs text-[hsl(var(--muted-foreground)/0.6)] truncate mt-0.5">
            {skill.description}
          </p>
        )}
      </div>

      {/* Metadata — right-aligned stats */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Author */}
        {skill.author && (
          <div className="flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground)/0.5)]">
            <User className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="max-w-[80px] truncate">
              {skill.author.startsWith('@') ? skill.author : `@${skill.author}`}
            </span>
          </div>
        )}

        {/* Installs (downloads) */}
        {skill.installs != null && (
          <span className="flex items-center gap-0.5 text-[11px] text-[hsl(var(--muted-foreground)/0.5)] tabular-nums">
            <Download className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            {formatCount(skill.installs)}
          </span>
        )}

        {/* Stars */}
        {skill.stars != null && skill.stars > 0 && (
          <span className="flex items-center gap-0.5 text-[11px] text-[hsl(var(--muted-foreground)/0.5)] tabular-nums">
            <Star className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            {formatCount(skill.stars)}
          </span>
        )}

        {/* Version count */}
        {skill.versionCount != null && skill.versionCount > 0 && (
          <span className="flex items-center gap-0.5 text-[11px] text-[hsl(var(--muted-foreground)/0.5)] tabular-nums">
            <GitBranch className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            {skill.versionCount}
          </span>
        )}

        {/* Provider badge */}
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md shrink-0', theme.badge)}>
          {theme.label}
        </span>

        {/* External link (hover) */}
        {skill.repoUrl && (
          <a
            href={skill.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[hsl(var(--muted-foreground)/0.4)] hover:text-[hsl(var(--foreground))]"
            aria-label="Open repository"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </button>
  )
})

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
