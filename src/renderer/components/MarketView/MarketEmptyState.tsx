// SPDX-License-Identifier: Apache-2.0

import { memo, useCallback } from 'react'
import {
  Search,
  Globe,
  Sparkles,
  GitBranch,
  Code2,
  TestTube2,
  FileText,
  Shield,
  Zap,
  Terminal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { KNOWN_PROVIDERS, getProviderTheme } from './providerTheme'

/** Suggested quick-search categories for the initial welcome state. */
const QUICK_SEARCHES = [
  { label: 'Git & Commits', query: 'git', icon: GitBranch },
  { label: 'Code Review', query: 'review', icon: Code2 },
  { label: 'Testing', query: 'test', icon: TestTube2 },
  { label: 'Documentation', query: 'docs', icon: FileText },
  { label: 'Security', query: 'security', icon: Shield },
  { label: 'DevOps', query: 'deploy', icon: Zap },
  { label: 'CLI Tools', query: 'cli', icon: Terminal },
] as const

interface MarketEmptyStateProps {
  mode: 'initial' | 'no-results' | 'error'
  query?: string
  error?: string | null
  /** Callback when user clicks a quick-search category pill. */
  onQuickSearch?: (query: string) => void
}

/**
 * Empty state shown in the market view.
 * - `initial`: Rich welcome state with quick-search categories
 * - `no-results`: Minimal "try again" state
 * - `error`: Connection error state
 */
export const MarketEmptyState = memo(function MarketEmptyState({
  mode,
  query,
  error,
  onQuickSearch,
}: MarketEmptyStateProps): React.JSX.Element {
  if (mode === 'initial') {
    return <WelcomeState onQuickSearch={onQuickSearch} />
  }

  return (
    <div className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="text-center max-w-xs">
        <div className="flex items-center justify-center mb-4">
          <div
            className={cn(
              'h-12 w-12 rounded-2xl flex items-center justify-center',
              mode === 'error' ? 'bg-red-500/10' : 'bg-[hsl(var(--foreground)/0.04)]',
            )}
          >
            {mode === 'no-results' && (
              <Search className="h-6 w-6 text-[hsl(var(--muted-foreground)/0.4)]" />
            )}
            {mode === 'error' && <Globe className="h-6 w-6 text-red-500" />}
          </div>
        </div>

        <h3 className="text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
          {mode === 'no-results' && 'No results found'}
          {mode === 'error' && 'Connection error'}
        </h3>

        <p className="text-xs text-[hsl(var(--muted-foreground)/0.6)] leading-relaxed">
          {mode === 'no-results' && (
            <>
              No skills matched{' '}
              <strong className="text-[hsl(var(--foreground))]">
                &ldquo;{query}&rdquo;
              </strong>
              . Try a different search term.
            </>
          )}
          {mode === 'error' &&
            (error ||
              'Failed to connect to marketplace providers. Please check your network and try again.')}
        </p>
      </div>
    </div>
  )
})

// ─── Welcome State ───────────────────────────────────────────

function WelcomeState({
  onQuickSearch,
}: {
  onQuickSearch?: (query: string) => void
}): React.JSX.Element {
  const handlePillClick = useCallback(
    (query: string) => {
      onQuickSearch?.(query)
    },
    [onQuickSearch],
  )

  return (
    <div className="flex-1 flex flex-col items-center pt-8 pb-6 px-6">
      {/* Hero glow */}
      <div className="relative mb-6">
        {/* Ambient glow */}
        <div className="absolute inset-0 -m-4 rounded-full bg-gradient-to-br from-amber-500/15 via-orange-500/10 to-rose-500/5 blur-2xl" />
        <div className="relative flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/15">
          <Sparkles className="h-7 w-7 text-amber-500" />
        </div>
      </div>

      {/* Title */}
      <h2 className="text-base font-semibold text-[hsl(var(--foreground))] mb-1.5">
        Discover Agent Skills
      </h2>
      <p className="text-[13px] text-[hsl(var(--muted-foreground)/0.5)] mb-8 text-center max-w-[280px] leading-relaxed">
        Extend your agent with skills from the community
      </p>

      {/* Quick search categories */}
      <div className="w-full max-w-[380px] mb-8">
        <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground)/0.35)] uppercase tracking-wider mb-3 px-1">
          Explore by category
        </p>
        <div className="flex flex-wrap gap-2">
          {QUICK_SEARCHES.map(({ label, query, icon: Icon }) => (
            <button
              key={query}
              type="button"
              onClick={() => handlePillClick(query)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs',
                'bg-[hsl(var(--foreground)/0.03)] border border-[hsl(var(--border)/0.3)]',
                'text-[hsl(var(--muted-foreground)/0.7)]',
                'hover:bg-[hsl(var(--foreground)/0.06)] hover:border-[hsl(var(--border)/0.5)]',
                'hover:text-[hsl(var(--foreground))]',
                'active:scale-[0.97]',
                'transition-all duration-150 outline-none',
                'focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
              )}
            >
              <Icon className="h-3 w-3 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Marketplace sources */}
      <div className="flex items-center gap-4">
        {KNOWN_PROVIDERS.map((id) => {
          const t = getProviderTheme(id)
          return (
            <div key={id} className="flex items-center gap-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full', t.dot)} />
              <span className="text-[11px] text-[hsl(var(--muted-foreground)/0.4)]">{t.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
