// SPDX-License-Identifier: Apache-2.0

/**
 * useCapabilityFilters — Encapsulates scope & origin filter logic.
 *
 * Design decisions:
 *   - **Effective filters via useMemo** (not useEffect + setState): eliminates
 *     the extra render cycle that "sync state" effects would cause. The user's
 *     filter intent (`scopeFilter`, `originFilter`) is preserved across category
 *     switches; the effective value auto-falls back to 'all' when no items match.
 *   - **resolveOrigin() single call-site**: all origin resolution flows through
 *     the centralized `resolveOrigin()` function, avoiding scattered capMap
 *     lookups with subtly different null-handling.
 *   - **Typed origin counts**: uses `Partial<Record<ResolvedOrigin, number>>`
 *     instead of `Record<string, number>` for compile-time safety.
 */
import { useState, useMemo } from 'react'
import type { CapabilityEntryBase, CapabilityEntry } from '@shared/types'
import type { CategoryConfig } from '../components/ChatView/categoryRegistry'
import { capabilityKey } from '@/lib/capabilityAdapter'
import { resolveOrigin } from '@/lib/originConfig'
import type { OriginFilterValue, ResolvedOrigin, SourceOrigin } from '@/lib/originConfig'

// ── Types ───────────────────────────────────────────────────────────

export type ScopeFilterValue = 'all' | 'project' | 'global'

export interface OriginFilterOption {
  id: OriginFilterValue
  count: number
}

interface ScopeCounts {
  all: number
  project: number
  global: number
}

export interface CapabilityFiltersInput {
  activeConfig: CategoryConfig
  activeItems: CapabilityEntryBase[]
  capMap: ReadonlyMap<string, CapabilityEntry>
}

export interface CapabilityFiltersResult {
  /** User's scope filter intent (may not match effective if no items). */
  scopeFilter: ScopeFilterValue
  setScopeFilter: (value: ScopeFilterValue) => void
  /** User's origin filter intent. */
  originFilter: OriginFilterValue
  setOriginFilter: (value: OriginFilterValue) => void
  /** Effective scope filter after auto-fallback (use this for UI highlight + filtering). */
  effectiveScopeFilter: ScopeFilterValue
  /** Effective origin filter after auto-fallback. */
  effectiveOriginFilter: OriginFilterValue
  /** Item counts per scope. */
  scopeCounts: ScopeCounts
  /** Whether scope filter pills should be shown. */
  hasMultipleScopes: boolean
  /** Item counts per origin (null for non-managed categories). */
  originCounts: Partial<Record<ResolvedOrigin, number>> | null
  /** Whether origin filter pills should be shown. */
  hasMultipleOrigins: boolean
  /** Origin filter options with counts (only origins that have items). */
  originFilterOptions: OriginFilterOption[]
  /** Final filtered items — ready for rendering. */
  visibleItems: CapabilityEntryBase[]
}

// ── Hook ────────────────────────────────────────────────────────────

export function useCapabilityFilters({
  activeConfig,
  activeItems,
  capMap,
}: CapabilityFiltersInput): CapabilityFiltersResult {
  // ── User intent state ─────────────────────────────────────────────

  const [scopeFilter, setScopeFilter] = useState<ScopeFilterValue>('all')
  const [originFilter, setOriginFilter] = useState<OriginFilterValue>('all')

  // ── Scope counts ──────────────────────────────────────────────────

  const scopeCounts = useMemo<ScopeCounts>(() => {
    let project = 0
    let global = 0
    for (const item of activeItems) {
      if (item.source.scope === 'project') project++
      else global++
    }
    return { all: activeItems.length, project, global }
  }, [activeItems])

  const hasMultipleScopes = scopeCounts.project > 0 && scopeCounts.global > 0

  // ── Origin counts (managed categories only) ───────────────────────

  const originCounts = useMemo<Partial<Record<ResolvedOrigin, number>> | null>(() => {
    if (!activeConfig.managed) return null
    const counts: Partial<Record<ResolvedOrigin, number>> = {}
    for (const item of activeItems) {
      const key = capabilityKey(activeConfig.id, item.source.scope, item.name)
      const origin = resolveOrigin(capMap, key)
      counts[origin] = (counts[origin] ?? 0) + 1
    }
    return counts
  }, [activeItems, activeConfig.id, activeConfig.managed, capMap])

  const hasMultipleOrigins = useMemo(
    () =>
      originCounts
        ? Object.values(originCounts).filter((c) => (c ?? 0) > 0).length > 1
        : false,
    [originCounts],
  )

  // ── Effective filters (derived — zero extra render cycles) ────────

  const effectiveScopeFilter = useMemo<ScopeFilterValue>(() => {
    if (scopeFilter === 'all') return 'all'
    const count =
      scopeFilter === 'project' ? scopeCounts.project : scopeCounts.global
    return count > 0 ? scopeFilter : 'all'
  }, [scopeFilter, scopeCounts])

  const effectiveOriginFilter = useMemo<OriginFilterValue>(() => {
    if (originFilter === 'all' || !activeConfig.managed || !originCounts)
      return 'all'
    const count = originCounts[originFilter as ResolvedOrigin] ?? 0
    return count > 0 ? originFilter : 'all'
  }, [originFilter, activeConfig.managed, originCounts])

  // ── Origin filter options (only origins with count > 0) ───────────

  const originFilterOptions = useMemo<OriginFilterOption[]>(() => {
    if (!originCounts) return []
    const options: OriginFilterOption[] = [
      { id: 'all', count: activeItems.length },
    ]
    for (const [key, count] of Object.entries(originCounts)) {
      if ((count ?? 0) > 0) {
        options.push({ id: key as OriginFilterValue, count: count ?? 0 })
      }
    }
    return options
  }, [originCounts, activeItems.length])

  // ── Visible items (combined filtering) ────────────────────────────

  const visibleItems = useMemo(() => {
    let items = activeItems

    if (effectiveScopeFilter !== 'all') {
      items = items.filter((i) =>
        effectiveScopeFilter === 'project'
          ? i.source.scope === 'project'
          : i.source.scope !== 'project',
      )
    }

    if (effectiveOriginFilter !== 'all' && activeConfig.managed) {
      items = items.filter((i) => {
        const key = capabilityKey(activeConfig.id, i.source.scope, i.name)
        return resolveOrigin(capMap, key) === effectiveOriginFilter
      })
    }

    return items
  }, [
    activeItems,
    effectiveScopeFilter,
    effectiveOriginFilter,
    activeConfig.id,
    activeConfig.managed,
    capMap,
  ])

  return {
    scopeFilter,
    setScopeFilter,
    originFilter,
    setOriginFilter,
    effectiveScopeFilter,
    effectiveOriginFilter,
    scopeCounts,
    hasMultipleScopes,
    originCounts,
    hasMultipleOrigins,
    originFilterOptions,
    visibleItems,
  }
}
