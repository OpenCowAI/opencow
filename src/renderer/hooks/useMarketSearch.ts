// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useRef, useEffect } from 'react'
import type {
  MarketSearchParams,
  MarketSearchGroup,
  MarketProviderStatus,
  MarketProviderInfo,
} from '@shared/types'
import { getAppAPI } from '@/windowAPI'

/**
 * Normalise IPC-serialised search groups.
 *
 * Electron IPC uses structured clone — the data arrives as plain objects
 * without runtime type guarantees. This is the SINGLE normalisation point
 * so downstream components can trust the shape unconditionally.
 */
function normaliseGroups(raw: unknown): MarketSearchGroup[] {
  if (!Array.isArray(raw)) return []
  return raw.map((g: Record<string, unknown>) => ({
    marketplaceId: (g.marketplaceId ?? 'unknown') as string,
    displayName: (g.displayName ?? 'Unknown') as string,
    status: normaliseStatus(g.status),
    results: Array.isArray(g.results) ? g.results : [],
    total: typeof g.total === 'number' ? g.total : 0,
    hasMore: typeof g.hasMore === 'boolean' ? g.hasMore : false,
  }))
}

function normaliseStatus(raw: unknown): MarketProviderStatus {
  if (raw && typeof raw === 'object' && 'state' in raw) return raw as MarketProviderStatus
  return { state: 'error', message: 'Invalid provider status' }
}

/** Canonical display order — fast providers first, heavy providers last. */
const PROVIDER_ORDER: string[] = ['skills.sh', 'github', 'clawhub']

function providerIndex(id: string): number {
  const idx = PROVIDER_ORDER.indexOf(id)
  return idx >= 0 ? idx : PROVIDER_ORDER.length // unknown → end
}

/**
 * Merge incoming groups into existing state.
 * Replaces groups with the same marketplaceId, appends new ones.
 * Result is always sorted in PROVIDER_ORDER regardless of arrival time.
 */
function mergeGroups(
  existing: MarketSearchGroup[],
  incoming: MarketSearchGroup[],
): MarketSearchGroup[] {
  const result = [...existing]
  for (const group of incoming) {
    const idx = result.findIndex((g) => g.marketplaceId === group.marketplaceId)
    if (idx >= 0) result[idx] = group
    else result.push(group)
  }
  return result.sort((a, b) => providerIndex(a.marketplaceId) - providerIndex(b.marketplaceId))
}

/**
 * Create loading placeholder groups for all providers.
 * Renders immediately as skeletons — each provider fills in its slot
 * when its search completes. Guarantees every provider is always visible.
 */
function buildLoadingGroups(providers: MarketProviderInfo[]): MarketSearchGroup[] {
  return providers
    .map((p) => ({
      marketplaceId: p.id,
      displayName: p.displayName,
      status: { state: 'loading' } as const,
      results: [],
      total: 0,
      hasMore: false,
    }))
    .sort((a, b) => providerIndex(a.marketplaceId) - providerIndex(b.marketplaceId))
}

interface UseMarketSearchResult {
  /** Grouped results — each marketplace has its own status + items */
  groups: MarketSearchGroup[]
  /** Whether any search request is in-flight */
  loading: boolean
  /** Global error (e.g. IPC disconnection) — per-provider errors live in group.status */
  error: string | null
  /** Trigger a search (debounced internally) */
  search: (query: string) => void
}

/**
 * Progressive search across all enabled marketplace providers.
 *
 * Instead of waiting for ALL providers to respond before showing results,
 * each provider's search runs as an independent IPC call. Results are
 * merged into state as they arrive — fast providers render instantly while
 * slower ones fill in progressively.
 *
 * Architecture:
 *   1. Search starts → all provider groups pre-populated in `loading` state.
 *   2. Each provider responds → its group is replaced with real results.
 *   3. Provider fails → its group shows `error` state (never silently dropped).
 *
 * Debounced internally (default 350ms) with generation-token anti-race
 * protection to prevent stale results from overwriting newer ones.
 */
export function useMarketSearch(initialQuery = '', debounceMs = 350): UseMarketSearchResult {
  const [groups, setGroups] = useState<MarketSearchGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generationRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const providersRef = useRef<MarketProviderInfo[]>([])

  // Pre-fetch enabled providers on mount (non-blocking).
  // This runs in the background — the 350ms debounce gives it time to resolve
  // before the first search fires.
  //
  // NOTE: We intentionally do NOT filter by `available`. All enabled providers
  // are always included in search. If a provider is temporarily unreachable,
  // its search will fail and show an error state — which is far better than
  // silently hiding the entire group from the user.
  useEffect(() => {
    getAppAPI()['market:providers']()
      .then((providers) => {
        providersRef.current = providers
      })
      .catch(() => {})
  }, [])

  const executeSearch = useCallback(async (q: string, generation: number) => {
    if (!q.trim()) {
      if (generation === generationRef.current) {
        setGroups([])
        setLoading(false)
      }
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Ensure providers list is loaded
      let providers = providersRef.current
      if (providers.length === 0) {
        try {
          const fetched = await getAppAPI()['market:providers']()
          providers = fetched
          providersRef.current = providers
        } catch {
          providers = []
        }
      }

      if (generation !== generationRef.current) return

      if (providers.length === 0) {
        // Fallback: no provider info → single aggregated call (old behaviour)
        const result = await getAppAPI()['market:search']({ query: q.trim(), limit: 30 })
        if (generation === generationRef.current) {
          setGroups(normaliseGroups(result))
        }
        return
      }

      // ─── Pre-populate loading placeholders for ALL providers ────
      // This guarantees every provider group is always visible. No more
      // "sometimes missing" — groups start as skeletons and fill in.
      setGroups(buildLoadingGroups(providers))

      // ─── Progressive: parallel per-provider searches ─────────
      // Each provider resolves independently. As soon as a provider
      // returns, its group replaces the loading placeholder.
      const params: MarketSearchParams = { query: q.trim(), limit: 30 }

      await Promise.allSettled(
        providers.map(async (provider) => {
          try {
            const result = await getAppAPI()['market:search']({
              ...params,
              marketplaceId: provider.id,
            })
            if (generation === generationRef.current) {
              setGroups((prev) => mergeGroups(prev, normaliseGroups(result)))
            }
          } catch (err) {
            // IPC/transport errors → show error state for this provider
            // (never silently drop a group)
            if (generation === generationRef.current) {
              const message = err instanceof Error ? err.message : 'Search failed'
              setGroups((prev) => mergeGroups(prev, [{
                marketplaceId: provider.id,
                displayName: provider.displayName,
                status: { state: 'error', message },
                results: [],
                total: 0,
                hasMore: false,
              }]))
            }
          }
        }),
      )
    } catch (err) {
      if (generation === generationRef.current) {
        setError(err instanceof Error ? err.message : 'Search failed')
      }
    } finally {
      if (generation === generationRef.current) {
        setLoading(false)
      }
    }
  }, [])

  // Debounced search trigger
  const search = useCallback(
    (q: string) => {
      clearTimeout(debounceRef.current)
      const gen = ++generationRef.current
      debounceRef.current = setTimeout(() => executeSearch(q, gen), debounceMs)
    },
    [executeSearch, debounceMs],
  )

  // Initial search if query is provided
  useEffect(() => {
    if (initialQuery) {
      const gen = ++generationRef.current
      executeSearch(initialQuery, gen)
    }
    return () => clearTimeout(debounceRef.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { groups, loading, error, search }
}
