// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback } from 'react'
import type { CapabilityImportableItem, CapabilityImportResult } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

interface UseImportExecuteResult {
  /** Execute import. Pass projectId to import into that project; omit for global scope. */
  execute: (items: CapabilityImportableItem[], projectId?: string) => Promise<CapabilityImportResult | null>
  importing: boolean
  result: CapabilityImportResult | null
  error: string | null
}

/**
 * Executes the import of selected capabilities into the Capability Center store.
 *
 * IPC: `capability:import:execute`
 */
export function useImportExecute(): UseImportExecuteResult {
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<CapabilityImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(async (items: CapabilityImportableItem[], projectId?: string) => {
    setImporting(true)
    setError(null)
    setResult(null)
    try {
      const res = await getAppAPI()['capability:import:execute']({
        items,
        projectId,
      })
      setResult(res)
      return res
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      return null
    } finally {
      setImporting(false)
    }
  }, [])

  return { execute, importing, result, error }
}
