// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback } from 'react'
import type { CapabilitySaveFormParams } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

/** Save result — always returns, never throws. Error is communicated via the `error` field. */
interface SaveResult {
  success: boolean
  filePath: string
  error?: string
}

interface UseCapabilitySaveResult {
  save: (params: CapabilitySaveFormParams) => Promise<SaveResult>
  saving: boolean
  error: string | null
}

/**
 * Saves a capability via the Capability Center `capability:save-form` IPC.
 *
 * Single error channel: errors are returned in the result AND set on the
 * `error` state. The save function never throws — callers can safely `await`
 * without try/catch and check `result.success`.
 */
export function useCapabilitySave(): UseCapabilitySaveResult {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(
    async (params: CapabilitySaveFormParams): Promise<SaveResult> => {
      setSaving(true)
      setError(null)
      try {
        const result = await getAppAPI()['capability:save-form'](params)
        return { success: result.success, filePath: result.filePath }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save'
        setError(message)
        return { success: false, filePath: '', error: message }
      } finally {
        setSaving(false)
      }
    },
    [],
  )

  return { save, saving, error }
}
