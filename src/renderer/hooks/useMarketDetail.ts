// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useRef } from 'react'
import type { MarketSkillDetail, MarketplaceId } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

interface UseMarketDetailResult {
  detail: MarketSkillDetail | null
  loading: boolean
  error: string | null
  fetchDetail: (slug: string, marketplaceId: MarketplaceId) => void
  clear: () => void
}

/**
 * Fetches full skill detail from a marketplace provider.
 * Supports generation-based cancellation for rapid navigation.
 */
export function useMarketDetail(): UseMarketDetailResult {
  const [detail, setDetail] = useState<MarketSkillDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generationRef = useRef(0)

  const fetchDetail = useCallback(async (slug: string, marketplaceId: MarketplaceId) => {
    const gen = ++generationRef.current
    setLoading(true)
    setError(null)
    setDetail(null)

    try {
      const result = await getAppAPI()['market:detail'](slug, marketplaceId)
      if (gen === generationRef.current) {
        setDetail(result)
      }
    } catch (err) {
      if (gen === generationRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load skill details')
      }
    } finally {
      if (gen === generationRef.current) {
        setLoading(false)
      }
    }
  }, [])

  const clear = useCallback(() => {
    ++generationRef.current
    setDetail(null)
    setLoading(false)
    setError(null)
  }, [])

  return { detail, loading, error, fetchDetail, clear }
}
