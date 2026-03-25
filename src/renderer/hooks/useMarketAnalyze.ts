// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useRef } from 'react'
import type { MarketInstallPreview, MarketplaceId } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

export interface UseMarketAnalyzeResult {
  preview: MarketInstallPreview | null
  loading: boolean
  error: string | null
  analyze: (slug: string, marketplaceId: MarketplaceId) => Promise<void>
  reset: () => void
}

/**
 * Lightweight pre-install analysis hook.
 *
 * Calls `market:analyze` to probe a repo's capability structure via the
 * GitHub Contents API — no tarball download, typically < 1s.
 *
 * Uses a generation counter to discard stale responses when the user
 * triggers a new analysis before the previous one completes.
 */
export function useMarketAnalyze(): UseMarketAnalyzeResult {
  const [preview, setPreview] = useState<MarketInstallPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const genRef = useRef(0)

  const analyze = useCallback(async (slug: string, marketplaceId: MarketplaceId) => {
    const gen = ++genRef.current
    setLoading(true)
    setError(null)
    setPreview(null)
    try {
      const result = await getAppAPI()['market:analyze'](slug, marketplaceId)
      if (gen === genRef.current) {
        setPreview(result)
      }
    } catch (err) {
      if (gen === genRef.current) {
        setError(err instanceof Error ? err.message : 'Analysis failed')
      }
    } finally {
      if (gen === genRef.current) setLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    genRef.current++
    setPreview(null)
    setLoading(false)
    setError(null)
  }, [])

  return { preview, loading, error, analyze, reset }
}
