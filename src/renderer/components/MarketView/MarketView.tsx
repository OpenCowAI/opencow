// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Search, Loader2, Store } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useMarketSearch } from '@/hooks/useMarketSearch'
import { useMarketDetail } from '@/hooks/useMarketDetail'
import { useMarketInstall } from '@/hooks/useMarketInstall'
import { useMarketAnalysisSession } from '@/hooks/useMarketAnalysisSession'
import type { MarketSkillSummary, MarketplaceId, InstalledPackageInfo } from '@shared/types'
import { getAppAPI } from '@/windowAPI'
import { SkillDetailPanel } from './SkillDetailPanel'
import { DetailSkeleton } from './DetailSkeleton'
import { InstallDialog } from './InstallDialog'
import { MarketEmptyState } from './MarketEmptyState'
import { MarketGroupSection } from './MarketGroupSection'
import { SearchSkeleton } from './SearchSkeleton'
import { getProviderTheme } from './providerTheme'
import type { ProviderTheme } from './providerTheme'

/**
 * Skills Marketplace view.
 * Search results are grouped by marketplace, each with independent status.
 */
export function MarketView(): React.JSX.Element {
  const projectId = useAppStore(selectProjectId)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // ─── State ───────────────────────────────────────────────
  const [queryText, setQueryText] = useState('')
  const [providerFilter, setProviderFilter] = useState<'all' | MarketplaceId>('all')
  const [selectedSkill, setSelectedSkill] = useState<MarketSkillSummary | null>(null)
  const [installTarget, setInstallTarget] = useState<MarketSkillSummary | null>(null)
  const hasSearched = queryText.trim().length > 0

  // ─── Installed packages (for "already installed" detection) ──
  const [installedPackages, setInstalledPackages] = useState<InstalledPackageInfo[]>([])

  const fetchInstalledPackages = useCallback(async () => {
    try {
      const packages = await getAppAPI()['package:list']()
      setInstalledPackages(packages)
    } catch {
      // Non-critical — installed state is optional UI hint
    }
  }, [])

  useEffect(() => {
    fetchInstalledPackages()
  }, [fetchInstalledPackages])

  // ─── Hooks ───────────────────────────────────────────────
  const { groups, loading: searchLoading, error: searchError, search } = useMarketSearch()
  const {
    detail,
    loading: detailLoading,
    error: detailError,
    fetchDetail,
    clear: clearDetail,
  } = useMarketDetail()
  const {
    installing,
    result: installResult,
    error: installError,
    progress: installProgress,
    install,
    reset: resetInstall,
  } = useMarketInstall()
  const analysisSession = useMarketAnalysisSession()

  // ─── Derived ────────────────────────────────��──────────────
  // groups are normalised at the hook layer (useMarketSearch) — safe to trust here

  const filteredGroups = useMemo(
    () => providerFilter === 'all' ? groups : groups.filter((g) => g.marketplaceId === providerFilter),
    [groups, providerFilter],
  )

  // Per-provider result counts (for filter pill badges)
  const countByProvider = useMemo(() => {
    const map = new Map<string, number>()
    for (const g of groups) {
      if (g.status.state === 'ok') map.set(g.marketplaceId, g.results.length)
    }
    return map
  }, [groups])

  const totalResults = useMemo(
    () => groups.reduce((sum, g) => sum + (g.status.state === 'ok' ? g.results.length : 0), 0),
    [groups],
  )
  const filteredTotal = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + (g.status.state === 'ok' ? g.results.length : 0), 0),
    [filteredGroups],
  )
  const hasResults = totalResults > 0
  const hasStatusMessages = useMemo(
    () => filteredGroups.some((g) => g.status.state !== 'ok'),
    [filteredGroups],
  )

  // ─── Handlers ────────────────────────────────────────────
  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value
      setQueryText(q)
      search(q)
    },
    [search],
  )

  /** Triggered by quick-search category pills in the welcome state. */
  const handleQuickSearch = useCallback(
    (query: string) => {
      setQueryText(query)
      search(query)
      inputRef.current?.focus()
    },
    [search],
  )

  const handleSelectSkill = useCallback(
    (skill: MarketSkillSummary) => {
      setSelectedSkill(skill)
      fetchDetail(skill.slug, skill.marketplaceId)
    },
    [fetchDetail],
  )

  const handleBack = useCallback(() => {
    setSelectedSkill(null)
    clearDetail()
  }, [clearDetail])

  const handleOpenInstall = useCallback(() => {
    if (selectedSkill) {
      setInstallTarget(selectedSkill)
      resetInstall()
      analysisSession.reset()
    }
  }, [selectedSkill, resetInstall, analysisSession])

  const handleInstall = useCallback(
    async (scope: 'global' | 'project', namespacePrefix?: string) => {
      if (!installTarget) return
      await install({
        slug: installTarget.slug,
        marketplaceId: installTarget.marketplaceId,
        scope,
        projectId: scope === 'project' && projectId ? projectId : undefined,
        namespacePrefix,
      }).catch(() => {
        // Error is already captured in installError state — swallow the
        // re-thrown promise to avoid an unhandled rejection.
      })
    },
    [installTarget, install, projectId],
  )

  const handleCloseInstall = useCallback(() => {
    // Clean up the analysis session (stop + delete) before closing
    analysisSession.reset()
    setInstallTarget(null)
    resetInstall()
    // Refresh installed packages after install dialog closes (install may have completed)
    fetchInstalledPackages()
  }, [analysisSession, resetInstall, fetchInstalledPackages])

  const handleUninstalled = useCallback(() => {
    // Refresh installed packages after uninstall
    fetchInstalledPackages()
  }, [fetchInstalledPackages])

  // Find installed package matching the current detail (by slug within same marketplace)
  const installedPackage = useMemo(() => {
    if (!selectedSkill) return null
    return installedPackages.find(
      (p) => p.slug === selectedSkill.slug && p.marketplaceId === selectedSkill.marketplaceId,
    ) ?? null
  }, [selectedSkill, installedPackages])

  // Focus search input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(timer)
  }, [])

  // ─── View content ───────────────────────────────────────
  // Renders the active view (detail / loading / error / list).
  // InstallDialog is rendered ONCE below, outside all branches — single source of truth.
  const viewContent = (() => {
    // Detail view
    if (selectedSkill && detail) {
      return (
        <SkillDetailPanel
          detail={detail}
          loading={detailLoading}
          installing={installing}
          onBack={handleBack}
          onInstall={handleOpenInstall}
          installedPackage={installedPackage}
          onUninstalled={handleUninstalled}
        />
      )
    }

    // Loading detail — full-page skeleton that mirrors SkillDetailPanel layout
    if (selectedSkill && detailLoading) {
      return <DetailSkeleton onBack={handleBack} />
    }

    // Detail error
    if (selectedSkill && detailError) {
      return (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-3 border-b border-[hsl(var(--border)/0.4)]">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors rounded-md px-2 py-1"
            >
              ← Back
            </button>
          </div>
          <MarketEmptyState mode="error" error={detailError} />
        </div>
      )
    }

    // List view (default)
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search header */}
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <Store className="h-4 w-4 text-amber-500 shrink-0" aria-hidden="true" />
            <h1 className="text-sm font-semibold">Skills Market</h1>
          </div>

          {/* Search input */}
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground)/0.4)]"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              type="text"
              value={queryText}
              placeholder="Search skills across marketplaces…"
              onChange={handleSearch}
              className={cn(
                'w-full h-9 pl-9 pr-3 rounded-xl text-sm',
                'bg-[hsl(var(--foreground)/0.02)] border border-[hsl(var(--border)/0.35)]',
                'hover:border-[hsl(var(--border)/0.6)] hover:bg-[hsl(var(--foreground)/0.03)]',
                'focus:border-[hsl(var(--primary)/0.5)] focus:bg-[hsl(var(--background))]',
                'focus:ring-1 focus:ring-[hsl(var(--primary)/0.2)]',
                'outline-none transition-all placeholder:text-[hsl(var(--muted-foreground)/0.4)]',
              )}
            />
            {searchLoading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[hsl(var(--muted-foreground)/0.4)]" />
            )}
          </div>
        </div>

        {/* Provider filter pills — visible only when results exist */}
        {hasSearched && hasResults && (
          <div className="flex items-center gap-1.5 px-6 pb-3">
            <FilterPill
              label="All"
              count={totalResults}
              active={providerFilter === 'all'}
              onClick={() => { setProviderFilter('all'); resultsRef.current?.scrollTo({ top: 0 }) }}
            />
            {groups.map((g) => (
              <FilterPill
                key={g.marketplaceId}
                label={g.displayName}
                count={countByProvider.get(g.marketplaceId) ?? 0}
                active={providerFilter === g.marketplaceId}
                pill={getProviderTheme(g.marketplaceId).pill}
                onClick={() => { setProviderFilter(g.marketplaceId); resultsRef.current?.scrollTo({ top: 0 }) }}
              />
            ))}
          </div>
        )}

        {/* Results area */}
        <div ref={resultsRef} className="flex-1 overflow-y-auto px-6 pb-6">
          {!hasSearched && !searchLoading && (
            <MarketEmptyState mode="initial" onQuickSearch={handleQuickSearch} />
          )}

          {/* Skeleton — only while loading AND no results have arrived yet */}
          {hasSearched && searchLoading && groups.length === 0 && <SearchSkeleton />}

          {searchError && !searchLoading && <MarketEmptyState mode="error" error={searchError} />}

          {/* Results render progressively — as soon as the first provider
              responds, its group appears. Remaining providers fill in as
              they complete. No need to wait for all providers. */}
          {hasSearched && !searchError && (hasResults || hasStatusMessages) && (
            <div className="market-results-enter">
              {filteredGroups.map((group) => (
                <MarketGroupSection
                  key={group.marketplaceId}
                  group={group}
                  selectedSlug={selectedSkill?.slug ?? null}
                  onSelect={handleSelectSkill}
                />
              ))}
            </div>
          )}

          {/* "No results" — must wait for ALL providers to finish */}
          {hasSearched && !searchLoading && !searchError && !hasResults && !hasStatusMessages && (
            <MarketEmptyState mode="no-results" query={queryText} />
          )}

          {/* Result count — updates incrementally as groups arrive */}
          {hasSearched && filteredTotal > 0 && (
            <p className="text-[11px] text-[hsl(var(--muted-foreground)/0.4)] mt-3 text-center market-results-enter">
              {filteredTotal} skill{filteredTotal !== 1 ? 's' : ''} found
              {searchLoading && '…'}
            </p>
          )}
        </div>
      </div>
    )
  })()

  // ─── Render ────────────────────────────────────────────────
  return (
    <>
      {viewContent}

      {/* Single InstallDialog instance — shared across all views */}
      <InstallDialog
        open={installTarget !== null}
        skill={installTarget}
        installing={installing}
        result={installResult}
        error={installError}
        progress={installProgress}
        analysis={analysisSession}
        onInstall={handleInstall}
        onClose={handleCloseInstall}
      />
    </>
  )
}

// ─── Filter Pill ──────────────────────────────────────────
// Pill styles come from `providerTheme.ts` — no duplicated color map here.

function FilterPill({
  label,
  count,
  active,
  pill,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  /** Provider-specific pill styles. Omit for the neutral "All" pill. */
  pill?: ProviderTheme['pill']
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium',
        'border transition-all duration-150 outline-none',
        'focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
        active
          ? pill
            ? pill.active
            : 'bg-[hsl(var(--foreground)/0.06)] text-[hsl(var(--foreground))] border-[hsl(var(--border)/0.5)]'
          : 'bg-transparent text-[hsl(var(--muted-foreground)/0.5)] border-transparent hover:text-[hsl(var(--muted-foreground)/0.8)] hover:bg-[hsl(var(--foreground)/0.03)]',
      )}
    >
      {label}
      {count > 0 && (
        <span
          className={cn(
            'text-[10px] tabular-nums leading-none px-1.5 py-0.5 rounded-md',
            active && pill
              ? pill.badge
              : active
                ? 'bg-[hsl(var(--foreground)/0.08)] text-[hsl(var(--foreground)/0.7)]'
                : 'bg-[hsl(var(--foreground)/0.04)] text-[hsl(var(--muted-foreground)/0.4)]',
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}
