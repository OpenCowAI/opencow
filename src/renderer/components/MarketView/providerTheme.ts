// SPDX-License-Identifier: Apache-2.0

/**
 * Shared marketplace provider theme configuration.
 *
 * Centralises display labels and color tokens for each provider —
 * eliminating hardcoded provider-specific conditionals across UI components.
 *
 * Usage:
 *   const theme = getProviderTheme(skill.marketplaceId)
 *   <span className={theme.badge}>{theme.label}</span>
 */

interface ProviderTheme {
  /** Human-readable label (e.g. "skills.sh", "ClawHub", "GitHub") */
  label: string
  /** Tailwind classes for the provider badge in cards/detail (background + text color) */
  badge: string
  /** Tailwind class for the small dot indicator */
  dot: string
  /** Filter pill styles when active */
  pill: { active: string; badge: string }
}

const PROVIDER_THEMES: Record<string, ProviderTheme> = {
  'skills.sh': {
    label: 'skills.sh',
    badge: 'bg-emerald-500/10 text-emerald-600',
    dot: 'bg-emerald-500',
    pill: {
      active: 'bg-emerald-500/12 text-emerald-600 border-emerald-500/25',
      badge: 'bg-emerald-500/15 text-emerald-600',
    },
  },
  clawhub: {
    label: 'ClawHub',
    badge: 'bg-violet-500/10 text-violet-600',
    dot: 'bg-violet-500',
    pill: {
      active: 'bg-violet-500/12 text-violet-600 border-violet-500/25',
      badge: 'bg-violet-500/15 text-violet-600',
    },
  },
  github: {
    label: 'GitHub',
    badge: 'bg-blue-500/10 text-blue-600',
    dot: 'bg-blue-500',
    pill: {
      active: 'bg-blue-500/12 text-blue-600 border-blue-500/25',
      badge: 'bg-blue-500/15 text-blue-600',
    },
  },
}

/** Fallback theme for unknown providers — neutral grey. */
const DEFAULT_THEME: ProviderTheme = {
  label: 'Unknown',
  badge: 'bg-[hsl(var(--foreground)/0.06)] text-[hsl(var(--muted-foreground)/0.7)]',
  dot: 'bg-[hsl(var(--muted-foreground)/0.4)]',
  pill: {
    active: 'bg-[hsl(var(--foreground)/0.06)] text-[hsl(var(--foreground))] border-[hsl(var(--border)/0.5)]',
    badge: 'bg-[hsl(var(--foreground)/0.08)] text-[hsl(var(--foreground)/0.7)]',
  },
}

/** Get the theme for a marketplace provider, with graceful fallback. */
export function getProviderTheme(marketplaceId: string): ProviderTheme {
  return PROVIDER_THEMES[marketplaceId] ?? DEFAULT_THEME
}

/** All known provider IDs — for rendering source indicators, etc. */
export const KNOWN_PROVIDERS = Object.keys(PROVIDER_THEMES)

export type { ProviderTheme }
