// SPDX-License-Identifier: Apache-2.0

/**
 * React hook for managing user-registered repository sources.
 *
 * Provides CRUD operations, connection testing, and sync functionality
 * via typed IPC channels to the RepoSourceRegistry backend.
 */

import { useState, useCallback, useEffect } from 'react'
import type { RepoSource, RepoSourceInput, RepoSourceUpdateInput, RepoSourceBrowseResult } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

export interface UseRepoSourcesReturn {
  sources: RepoSource[]
  loading: boolean
  /** Refresh the source list from the backend. */
  refresh: () => Promise<void>
  /** Create a new repo source. */
  create: (input: RepoSourceInput) => Promise<RepoSource>
  /** Update an existing repo source. */
  update: (id: string, input: RepoSourceUpdateInput) => Promise<RepoSource>
  /** Remove a repo source. */
  remove: (id: string) => Promise<void>
  /** Test connectivity for a repo source. */
  testConnection: (id: string) => Promise<{ ok: boolean; error?: string }>
  /** Sync (fetch latest commit) for a repo source. */
  sync: (id: string) => Promise<RepoSource>
  /** Browse capabilities discovered in a repo source. */
  browse: (id: string) => Promise<RepoSourceBrowseResult>
}

export function useRepoSources(): UseRepoSourcesReturn {
  const [sources, setSources] = useState<RepoSource[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const result = await getAppAPI()['repo-source:list']()
      setSources(result)
    } catch (err) {
      console.error('Failed to load repo sources:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    refresh()
  }, [refresh])

  const create = useCallback(async (input: RepoSourceInput) => {
    const source = await getAppAPI()['repo-source:create'](input)
    await refresh()
    return source
  }, [refresh])

  const update = useCallback(async (id: string, input: RepoSourceUpdateInput) => {
    const source = await getAppAPI()['repo-source:update'](id, input)
    await refresh()
    return source
  }, [refresh])

  const remove = useCallback(async (id: string) => {
    await getAppAPI()['repo-source:delete'](id)
    await refresh()
  }, [refresh])

  const testConnection = useCallback(async (id: string) => {
    return getAppAPI()['repo-source:test-connection'](id)
  }, [])

  const sync = useCallback(async (id: string) => {
    const source = await getAppAPI()['repo-source:sync'](id)
    await refresh()
    return source
  }, [refresh])

  const browse = useCallback(async (id: string) => {
    return getAppAPI()['repo-source:browse'](id)
  }, [])

  return { sources, loading, refresh, create, update, remove, testConnection, sync, browse }
}
