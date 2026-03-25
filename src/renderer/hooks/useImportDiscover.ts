// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback } from 'react'
import type { CapabilityImportableItem, CapabilityDiscoverParams } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

interface UseImportDiscoverResult {
  items: CapabilityImportableItem[]
  loading: boolean
  error: string | null
  /** Discover importable items. Accepts a discriminated union — each sourceType carries only its own params. */
  discover: (params: CapabilityDiscoverParams) => Promise<CapabilityImportableItem[]>
}

/**
 * Discovers importable capabilities from external sources (Claude Code CLI, files, etc.).
 *
 * IPC: `capability:import:discover`
 */
export function useImportDiscover(): UseImportDiscoverResult {
  const [items, setItems] = useState<CapabilityImportableItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const discover = useCallback(async (params: CapabilityDiscoverParams): Promise<CapabilityImportableItem[]> => {
    setLoading(true)
    setError(null)
    setItems([])
    try {
      const result = await getAppAPI()['capability:import:discover'](params)
      setItems(result)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discovery failed')
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  return { items, loading, error, discover }
}
