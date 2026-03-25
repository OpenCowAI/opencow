// SPDX-License-Identifier: Apache-2.0

/**
 * Pure service hook for file search — manages file indexing, fuzzy search, and directory navigation.
 *
 * Design constraints:
 * - Uses only refs (no React state) — consumed by a closure-based TipTap suggestion renderer
 *   that manages its own imperative render cycle.
 * - All exported functions are stable across renders (wrapped in useCallback with [] deps).
 * - The projectPath changes are tracked via a ref that the caller keeps in sync.
 *
 * @module useFileSearch
 */

import { useCallback, useRef, useEffect } from 'react'
import type { FileEntry } from '@shared/types'
import { useProjectScope } from '../contexts/ProjectScopeContext'
import { createLogger } from '@/lib/logger'
import { getAppAPI } from '@/windowAPI'

const log = createLogger('FileSearch')

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface UseFileSearchResult {
  /** Ref holding the pre-loaded flat file list (root + shallow children) */
  fileItemsRef: React.RefObject<FileEntry[]>
  /** Trigger async loading of the file index (idempotent) */
  loadFileItems: () => Promise<void>
  /**
   * Fuzzy-search files by query.
   *
   * Three modes:
   * 1. Empty query → return pre-loaded items (fast, synchronous subset)
   * 2. Path query (contains '/') → directory navigation via list-project-files
   * 3. Name query → recursive fuzzy search via search-project-files
   */
  filterFileItems: (query: string) => Promise<FileEntry[]>
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useFileSearch(): UseFileSearchResult {
  const { projectPath } = useProjectScope()
  const projectPathRef = useRef(projectPath)
  projectPathRef.current = projectPath

  /** Flat file list: root entries + one level of sub-entries for common dirs */
  const fileItemsRef = useRef<FileEntry[]>([])
  const fileItemsLoadedRef = useRef(false)

  /* -- Load file index (idempotent) -- */

  const loadFileItems = useCallback(async () => {
    const pp = projectPathRef.current
    if (!pp || fileItemsLoadedRef.current) return
    fileItemsLoadedRef.current = true
    try {
      const entries = await getAppAPI()['list-project-files'](pp)
      // Flatten: include root entries and one level of sub-entries for common dirs
      const flat: FileEntry[] = [...entries]
      const commonDirs = entries.filter((e) => e.isDirectory).slice(0, 8)
      await Promise.all(
        commonDirs.map(async (dir) => {
          try {
            const children = await getAppAPI()['list-project-files'](pp, dir.path)
            flat.push(...children)
          } catch { /* ignore */ }
        }),
      )
      fileItemsRef.current = flat
    } catch (err) {
      log.error('Failed to load project files for @ mention', err)
    }
  }, [])

  /* -- Reset & eager preload on project change -- */

  useEffect(() => {
    fileItemsLoadedRef.current = false
    fileItemsRef.current = []
    if (projectPath) loadFileItems()
  }, [projectPath, loadFileItems])

  /* -- Filter / search -- */

  // Generation counter — prevents stale IPC results from overwriting newer ones.
  // TipTap's suggestion plugin calls items() on every keystroke; without this
  // guard a slow IPC response for "fo" could overwrite the faster result for "foo".
  const searchGenerationRef = useRef(0)

  const filterFileItems = useCallback(async (query: string): Promise<FileEntry[]> => {
    const pp = projectPathRef.current
    if (!pp) return []

    // Empty query: show pre-loaded items (root + shallow children) — no IPC needed
    if (!query) return fileItemsRef.current.slice(0, 20)

    const generation = ++searchGenerationRef.current

    // Path-based query (contains '/') → directory navigation mode
    if (query.includes('/')) {
      const lastSlash = query.lastIndexOf('/')
      const dirPath = query.substring(0, lastSlash) || ''
      const nameFilter = query.substring(lastSlash + 1).toLowerCase()

      try {
        const entries = await getAppAPI()['list-project-files'](pp, dirPath || undefined)
        if (generation !== searchGenerationRef.current) return [] // stale
        if (!nameFilter) return entries.slice(0, 30)
        return entries
          .filter((e) => e.name.toLowerCase().includes(nameFilter))
          .slice(0, 30)
      } catch {
        return []
      }
    }

    // Name-based query → recursive fuzzy search via IPC (uses cached index + fuzzyMatch on main process)
    try {
      const results = await getAppAPI()['search-project-files'](pp, query)
      if (generation !== searchGenerationRef.current) return [] // stale
      return results
    } catch {
      // Fallback to local filter on the pre-loaded flat list
      const q = query.toLowerCase()
      return fileItemsRef.current
        .filter((e) => e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q))
        .slice(0, 20)
    }
  }, [])

  return {
    fileItemsRef,
    loadFileItems,
    filterFileItems,
  }
}
