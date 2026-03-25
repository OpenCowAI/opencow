// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback } from 'react'
import type { MarketProviderInfo } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

interface UseMarketProvidersResult {
  providers: MarketProviderInfo[]
  loading: boolean
  error: string | null
  refresh: () => void
}

/**
 * Fetches available marketplace providers and their connectivity status.
 */
export function useMarketProviders(): UseMarketProvidersResult {
  const [providers, setProviders] = useState<MarketProviderInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getAppAPI()['market:providers']()
      setProviders(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load providers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch()
  }, [fetch])

  return { providers, loading, error, refresh: fetch }
}
