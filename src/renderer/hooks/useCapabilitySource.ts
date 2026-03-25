// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect } from 'react'
import { parseSourceForForm } from '@shared/capabilityParsers'
import type {
  CapabilityIdentifier,
  CapabilityCategory,
  CapabilitySourceResult
} from '@shared/types'
import { getAppAPI } from '@/windowAPI'

interface UseCapabilitySourceResult {
  data: Record<string, unknown> | null
  loading: boolean
  error: string | null
}

export function useCapabilitySource(
  identifier: CapabilityIdentifier | undefined,
  category: CapabilityCategory,
  projectPath?: string
): UseCapabilitySourceResult {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(!!identifier)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!identifier) return
    let cancelled = false
    setLoading(true)
    setError(null)

    getAppAPI()['read-capability-source'](identifier.source.sourcePath, projectPath)
      .then((result: CapabilitySourceResult) => {
        if (!cancelled) {
          setData(parseSourceForForm(category, result.content, identifier.name))
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [identifier?.source.sourcePath, identifier?.name, category, projectPath])

  return { data, loading, error }
}
