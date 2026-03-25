// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useRef } from 'react'
import type { CapabilitySnapshot } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

interface UseCapabilitySnapshotResult {
  snapshot: CapabilitySnapshot | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

/** Debounce delay for rapid `capabilities:changed` events (ms) */
const REFRESH_DEBOUNCE_MS = 150

/**
 * Fetches and auto-refreshes the Capability Center snapshot.
 *
 * Subscribes to `capabilities:changed` DataBus events so the UI stays
 * in sync after save / delete / toggle / publish operations.
 *
 * Loading semantics:
 * - `loading` is true ONLY until the first successful fetch completes.
 * - Subsequent refreshes (event-driven or manual) update data silently
 *   in the background — the existing snapshot stays visible, no flash.
 *
 * Safety:
 * - Debounces rapid change events to avoid redundant IPC calls.
 * - Tracks a request generation counter to discard stale responses
 *   when projectId changes mid-flight.
 */
export function useCapabilitySnapshot(projectId?: string): UseCapabilitySnapshotResult {
  const [snapshot, setSnapshot] = useState<CapabilitySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Generation counter: incremented on every request, responses from older
  // generations are discarded to prevent race conditions.
  const generationRef = useRef(0)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Tracks whether we've successfully loaded at least once.
  // Once true, subsequent fetches are "background refreshes" — no loading state.
  const hasLoadedRef = useRef(false)

  const fetchSnapshot = useCallback(
    async (generation: number) => {
      // Only show loading indicator until first successful load.
      // Background refreshes keep existing snapshot visible — no flash.
      const isInitialLoad = !hasLoadedRef.current
      if (isInitialLoad) {
        setLoading(true)
        setError(null)
      }
      try {
        const result = await getAppAPI()['capability:snapshot'](projectId)
        // Only apply if this is still the latest generation
        if (generation === generationRef.current) {
          setSnapshot(result)
          hasLoadedRef.current = true
        }
      } catch (err) {
        if (generation === generationRef.current) {
          // Only surface errors on initial load — background failures are silent
          // (user keeps seeing the last good snapshot)
          if (isInitialLoad) {
            setError(err instanceof Error ? err.message : 'Failed to load capabilities')
          }
        }
      } finally {
        if (generation === generationRef.current) {
          setLoading(false)
        }
      }
    },
    [projectId],
  )

  const refresh = useCallback(async () => {
    const gen = ++generationRef.current
    await fetchSnapshot(gen)
  }, [fetchSnapshot])

  // Initial fetch + re-fetch when projectId changes
  useEffect(() => {
    const gen = ++generationRef.current
    fetchSnapshot(gen)
  }, [fetchSnapshot])

  // Auto-refresh on capabilities:changed event (debounced)
  useEffect(() => {
    const unsub = getAppAPI()['on:opencow:event']((event) => {
      if (event.type === 'capabilities:changed') {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = setTimeout(() => {
          const gen = ++generationRef.current
          fetchSnapshot(gen)
        }, REFRESH_DEBOUNCE_MS)
      }
    })
    return () => {
      unsub()
      clearTimeout(debounceTimerRef.current)
    }
  }, [fetchSnapshot])

  return { snapshot, loading, error, refresh }
}
