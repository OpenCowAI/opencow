// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileStore } from '@/stores/fileStore'
import { useGitStore } from '@/stores/gitStore'
import { useFocusableListNav } from '@/hooks/useFocusableListNav'
import { FileTreeNode } from './FileTreeNode'
import { getFileDecoration, getDirDecoration } from '@/lib/gitDecorations'
import { selectGitSnapshot } from '@/hooks/useGitStatus'
import { normalizeFileContentReadResult } from '@/lib/fileContentReadResult'
import type { FileEntry } from '@shared/types'
import { createLogger } from '@/lib/logger'
import { getAppAPI } from '@/windowAPI'

const log = createLogger('FileTree')

// ── Types ──────────────────────────────────────────────────────────

interface FileTreeProps {
  projectPath: string
  projectName: string
}

const EMPTY_FILE_ENTRIES: FileEntry[] = []
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico'])

function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return ''
  return name.slice(idx + 1).toLowerCase()
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Build a flat, ordered list of every tree node currently visible to the user.
 * Ordering matches the visual depth-first traversal, only descending into
 * directories that are both expanded **and** cached.
 */
function flattenVisibleEntries(
  entries: FileEntry[],
  dirCache: Record<string, FileEntry[]>,
  expandedDirs: Set<string>
): FileEntry[] {
  const result: FileEntry[] = []

  function walk(items: FileEntry[]): void {
    for (const item of items) {
      result.push(item)
      if (item.isDirectory && expandedDirs.has(item.path) && dirCache[item.path]) {
        walk(dirCache[item.path])
      }
    }
  }

  walk(entries)
  return result
}

/**
 * Derive the parent directory path from a file/directory path.
 * Returns `null` for root-level entries (no `/` separator).
 */
function parentPath(path: string): string | null {
  const idx = path.lastIndexOf('/')
  return idx > 0 ? path.slice(0, idx) : null
}

// ── Component ──────────────────────────────────────────────────────

export function FileTree({ projectPath, projectName }: FileTreeProps): React.JSX.Element {
  const { t } = useTranslation('files')
  const expandedDirs = useFileStore((s) => s.expandedDirs)
  const toggleDir = useFileStore((s) => s.toggleDir)
  const activeFilePath = useFileStore((s) => s.activeFilePath)
  const openFile = useFileStore((s) => s.openFile)
  const gitSnapshot = useGitStore((s) => selectGitSnapshot(s, projectPath))

  // Cache: directory path → entries
  const [dirCache, setDirCache] = useState<Record<string, FileEntry[]>>({})
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())

  const treeContainerRef = useRef<HTMLDivElement>(null)

  // ── Directory loading ──────────────────────────────────────────

  const loadDir = useCallback(async (subPath?: string) => {
    const key = subPath ?? ''
    if (dirCache[key] || loadingDirs.has(key)) return

    setLoadingDirs((prev) => new Set(prev).add(key))
    try {
      const entries = await getAppAPI()['list-project-files'](projectPath, subPath)
      setDirCache((prev) => ({ ...prev, [key]: entries }))
    } finally {
      setLoadingDirs((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }, [projectPath, dirCache, loadingDirs])

  // Load root on mount or project change
  useEffect(() => {
    setDirCache({})
    setLoadingDirs(new Set())
    const load = async (): Promise<void> => {
      setLoadingDirs(new Set(['']))
      try {
        const entries = await getAppAPI()['list-project-files'](projectPath)
        setDirCache({ '': entries })
      } finally {
        setLoadingDirs(new Set())
      }
    }
    load()
  }, [projectPath])

  // Load expanded directories that aren't cached yet
  useEffect(() => {
    for (const dirPath of expandedDirs) {
      if (!dirCache[dirPath] && !loadingDirs.has(dirPath)) {
        loadDir(dirPath)
      }
    }
  }, [expandedDirs, dirCache, loadingDirs, loadDir])

  // ── File actions ───────────────────────────────────────────────

  const handleFileClick = useCallback(async (entry: FileEntry) => {
    try {
      const ext = extensionOf(entry.name)
      if (IMAGE_EXTS.has(ext)) {
        const imageResult = await getAppAPI()['read-image-preview'](projectPath, entry.path)
        if (!imageResult.ok) {
          log.error('Failed to open image file', imageResult.error)
          return
        }
        openFile({
          path: entry.path,
          name: entry.name,
          language: imageResult.data.mimeType,
          content: '',
          viewKind: 'image',
          imageDataUrl: imageResult.data.dataUrl,
        })
        return
      }

      const rawResult = await getAppAPI()['read-file-content'](projectPath, entry.path)
      const result = normalizeFileContentReadResult(rawResult)
      if (!result.ok) {
        log.error('Failed to open file', result.error)
        return
      }
      openFile({
        path: entry.path,
        name: entry.name,
        language: result.data.language,
        content: result.data.content,
        viewKind: 'text',
        imageDataUrl: null,
      })
    } catch (err) {
      log.error('Failed to open file', err)
    }
  }, [projectPath, openFile])

  // ── Keyboard navigation ────────────────────────────────────────

  const rootEntries = dirCache[''] ?? EMPTY_FILE_ENTRIES

  // Memoised flat list of visible node keys for keyboard navigation.
  // Only recomputed when the tree structure actually changes.
  const visibleEntries = useMemo(
    () => flattenVisibleEntries(rootEntries, dirCache, expandedDirs),
    [rootEntries, dirCache, expandedDirs]
  )

  const visibleKeys = useMemo(
    () => visibleEntries.map((e) => e.path),
    [visibleEntries]
  )

  // Build a lookup map for O(1) entry access by path
  const entryByPath = useMemo(() => {
    const map = new Map<string, FileEntry>()
    for (const entry of visibleEntries) {
      map.set(entry.path, entry)
    }
    return map
  }, [visibleEntries])

  const handleActivate = useCallback(
    (key: string) => {
      const entry = entryByPath.get(key)
      if (!entry) return
      if (entry.isDirectory) {
        toggleDir(entry.path)
      } else {
        handleFileClick(entry)
      }
    },
    [entryByPath, toggleDir, handleFileClick]
  )

  const { focusedKey, setFocusedKey, handleKeyDown: baseHandleKeyDown, getTabIndex } =
    useFocusableListNav({
      keys: visibleKeys,
      onActivate: handleActivate,
      containerRef: treeContainerRef,
      itemAttribute: 'data-tree-path'
    })

  // Tree-specific keyboard: ArrowLeft/Right for expand/collapse
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (!focusedKey) {
          baseHandleKeyDown(e)
          return
        }

        const entry = entryByPath.get(focusedKey)
        if (!entry) {
          baseHandleKeyDown(e)
          return
        }

        if (e.key === 'ArrowRight') {
          e.preventDefault()
          if (!entry.isDirectory) return
          if (!expandedDirs.has(entry.path)) {
            // Expand collapsed directory
            toggleDir(entry.path)
          } else {
            // Already expanded → step into first child
            const children = dirCache[entry.path]
            if (children && children.length > 0) {
              setFocusedKey(children[0].path)
            }
          }
        } else {
          // ArrowLeft
          e.preventDefault()
          if (entry.isDirectory && expandedDirs.has(entry.path)) {
            // Collapse expanded directory
            toggleDir(entry.path)
          } else {
            // Jump to parent directory
            const parent = parentPath(entry.path)
            if (parent !== null) {
              setFocusedKey(parent)
            }
          }
        }
        return
      }

      // All other keys → delegate to generic list nav
      baseHandleKeyDown(e)
    },
    [focusedKey, entryByPath, expandedDirs, dirCache, toggleDir, setFocusedKey, baseHandleKeyDown]
  )

  // ── Click handler ──────────────────────────────────────────────

  /** Sync keyboard focus on mouse click, then perform the action. */
  const handleNodeClick = useCallback(
    (entry: FileEntry) => {
      setFocusedKey(entry.path)
      if (entry.isDirectory) {
        toggleDir(entry.path)
      } else {
        handleFileClick(entry)
      }
    },
    [setFocusedKey, toggleDir, handleFileClick]
  )

  // ── Render ─────────────────────────────────────────────────────

  const renderEntries = (entries: FileEntry[], depth: number): React.JSX.Element[] => {
    return entries.map((entry) => {
      const decoration = entry.isDirectory
        ? getDirDecoration(gitSnapshot, entry.path)
        : getFileDecoration(gitSnapshot, entry.path)
      return (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          depth={depth}
          isExpanded={expandedDirs.has(entry.path)}
          isActive={activeFilePath === entry.path}
          tabIndex={getTabIndex(entry.path)}
          onClick={handleNodeClick}
          decoration={decoration}
        >
          {entry.isDirectory && expandedDirs.has(entry.path) && dirCache[entry.path]
            ? renderEntries(dirCache[entry.path], depth + 1)
            : null}
        </FileTreeNode>
      )
    })
  }

  return (
    <div className="h-full flex flex-col min-w-0">
      <div className="px-3 h-9 flex items-center text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))]">
        {projectName}
      </div>
      <div
        ref={treeContainerRef}
        className="flex-1 overflow-y-auto"
        role="tree"
        aria-label={t('tree.aria')}
        onKeyDown={handleKeyDown}
      >
        {rootEntries.length === 0 ? (
          <div className="px-3 py-4 text-xs text-[hsl(var(--muted-foreground))]">
            {t('browser.loading')}
          </div>
        ) : (
          renderEntries(rootEntries, 0)
        )}
      </div>
    </div>
  )
}
