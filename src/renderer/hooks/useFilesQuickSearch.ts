// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileSearchMatch, FileSearchRecentSelection } from '@shared/types'
import { getAppAPI } from '@/windowAPI'
import { useFileStore } from '@/stores/fileStore'

export interface FilesQuickSearchItem {
  path: string
  name: string
  isDirectory: boolean
  score: number
  nameHighlights: number[]
  pathHighlights: number[]
  source: 'search' | 'recent' | 'open'
}

interface UseFilesQuickSearchInput {
  projectId: string
  projectPath: string
  openFiles: readonly { path: string; name: string }[]
  query: string
  isOpen: boolean
}

interface UseFilesQuickSearchResult {
  items: FilesQuickSearchItem[]
  loading: boolean
}

const EMPTY_RECENT_SELECTIONS: readonly FileSearchRecentSelection[] = []

function mapMatch(match: FileSearchMatch): FilesQuickSearchItem {
  return {
    path: match.entry.path,
    name: match.entry.name,
    isDirectory: match.entry.isDirectory,
    score: match.score,
    nameHighlights: match.nameHighlights,
    pathHighlights: match.pathHighlights,
    source: 'search',
  }
}

function dedupeByPath(items: readonly FilesQuickSearchItem[]): FilesQuickSearchItem[] {
  const seen = new Set<string>()
  const result: FilesQuickSearchItem[] = []
  for (const item of items) {
    if (seen.has(item.path)) continue
    seen.add(item.path)
    result.push(item)
  }
  return result
}

export function useFilesQuickSearch({
  projectId,
  projectPath,
  openFiles,
  query,
  isOpen,
}: UseFilesQuickSearchInput): UseFilesQuickSearchResult {
  const recentSelections = useFileStore(
    (s) => s.recentFileSearchSelectionsByProject[projectId] ?? EMPTY_RECENT_SELECTIONS
  )

  const [items, setItems] = useState<FilesQuickSearchItem[]>([])
  const [loading, setLoading] = useState(false)

  const requestSeqRef = useRef(0)

  const openFileItems = useMemo<FilesQuickSearchItem[]>(() => {
    return openFiles.map((file, idx) => ({
      path: file.path,
      name: file.name,
      isDirectory: false,
      score: 10_000 - idx,
      nameHighlights: [],
      pathHighlights: [],
      source: 'open',
    }))
  }, [openFiles])

  useEffect(() => {
    if (!isOpen) return

    const q = query.trim()

    if (q.length === 0) {
      const recentItems = recentSelections.map((selection, idx) => {
        const openFile = openFiles.find((f) => f.path === selection.path)
        return {
          path: selection.path,
          name: openFile?.name ?? selection.name ?? selection.path.split('/').at(-1) ?? selection.path,
          isDirectory: selection.kind === 'directory',
          score: 9_000 - idx,
          nameHighlights: [],
          pathHighlights: [],
          source: 'recent' as const,
        }
      })
      setLoading(false)
      setItems(dedupeByPath([...openFileItems, ...recentItems]))
      return
    }

    const seq = ++requestSeqRef.current
    setLoading(true)

    const timer = setTimeout(async () => {
      try {
        const matches = await getAppAPI()['search-project-files'](projectPath, q)
        if (seq !== requestSeqRef.current) return
        setItems(matches.map(mapMatch))
      } catch {
        if (seq !== requestSeqRef.current) return
        setItems([])
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false)
        }
      }
    }, 120)

    return () => {
      clearTimeout(timer)
    }
  }, [isOpen, projectPath, query, recentSelections, openFileItems, openFiles])

  return { items, loading }
}
