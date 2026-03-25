// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, ChevronRight, ChevronDown, Check, FolderOpen } from 'lucide-react'
import { FileIcon } from '../../FilesView/FileIcon'
import { cn } from '@/lib/utils'
import { useProjectScope } from '@/contexts/ProjectScopeContext'
import { useContextFiles, type ContextFile } from '@/contexts/ContextFilesContext'
import { getAppAPI } from '@/windowAPI'
import type { FileEntry } from '@shared/types'

/* ------------------------------------------------------------------ */
/*  ContextMentionPopover                                              */
/*                                                                     */
/*  Project directory tree with search/filter, shown when the user     */
/*  clicks the @ icon in the session input bar. Positioned on the      */
/*  left side of the Issue detail panel.                               */
/* ------------------------------------------------------------------ */

interface ContextMentionPopoverProps {
  onClose: () => void
  /** Called when the user selects a file — inserts a fileMention node into the editor. */
  onSelectFile?: (entry: FileEntry) => void
}

export function ContextMentionPopover({ onClose, onSelectFile }: ContextMentionPopoverProps): React.JSX.Element | null {
  const { t } = useTranslation('sessions')
  const { projectPath } = useProjectScope()
  const { files: contextFiles, addFile, removeFile } = useContextFiles()

  const [searchQuery, setSearchQuery] = useState('')
  const [dirCache, setDirCache] = useState<Record<string, FileEntry[]>>({})
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  const [flatSearchResults, setFlatSearchResults] = useState<FileEntry[] | null>(null)
  const [isSearchLoading, setIsSearchLoading] = useState(false)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedPaths = useMemo(() => new Set(contextFiles.map((f) => f.path)), [contextFiles])

  // Focus search input on mount
  useEffect(() => {
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay to avoid immediate close from the trigger click
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onClose])

  // Load root directory on mount
  useEffect(() => {
    if (!projectPath) return
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

  // Load expanded directory contents
  const loadDir = useCallback(
    async (subPath: string) => {
      if (!projectPath || dirCache[subPath] || loadingDirs.has(subPath)) return
      setLoadingDirs((prev) => new Set(prev).add(subPath))
      try {
        const entries = await getAppAPI()['list-project-files'](projectPath, subPath)
        setDirCache((prev) => ({ ...prev, [subPath]: entries }))
      } finally {
        setLoadingDirs((prev) => {
          const next = new Set(prev)
          next.delete(subPath)
          return next
        })
      }
    },
    [projectPath, dirCache, loadingDirs],
  )

  // Toggle directory expansion
  const toggleDir = useCallback(
    (path: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev)
        if (next.has(path)) {
          next.delete(path)
        } else {
          next.add(path)
          // Load children if not cached
          if (!dirCache[path]) loadDir(path)
        }
        return next
      })
    },
    [dirCache, loadDir],
  )

  // Handle file/dir click — insert into editor directly (no context tracking)
  const handleEntryClick = useCallback(
    (entry: FileEntry) => {
      if (onSelectFile) {
        // Direct editor insertion path — skip ContextFiles context to avoid double-insert
        onSelectFile(entry)
      } else {
        // Fallback: context-based path (used by drag-drop flow)
        const file: ContextFile = {
          path: entry.path,
          name: entry.name,
          isDirectory: entry.isDirectory,
        }
        if (selectedPaths.has(entry.path)) {
          removeFile(entry.path)
        } else {
          addFile(file)
        }
      }
    },
    [selectedPaths, addFile, removeFile, onSelectFile],
  )

  // Fuzzy search via IPC (same search-project-files as inline @ suggestion)
  // Debounced to avoid IPC spam while typing; falls back to local cache on error.
  useEffect(() => {
    if (!searchQuery.trim() || !projectPath) {
      setFlatSearchResults(null)
      setIsSearchLoading(false)
      return
    }

    let cancelled = false
    const query = searchQuery.trim()
    setIsSearchLoading(true)

    const timer = setTimeout(async () => {
      try {
        const results = await getAppAPI()['search-project-files'](projectPath, query)
        if (!cancelled) {
          setFlatSearchResults(results.slice(0, 50))
          setIsSearchLoading(false)
        }
      } catch {
        if (cancelled) return
        // Fallback: local cache substring search
        const q = query.toLowerCase()
        const seen = new Set<string>()
        const localResults: FileEntry[] = []
        for (const entries of Object.values(dirCache)) {
          for (const entry of entries) {
            if (!seen.has(entry.path) && entry.name.toLowerCase().includes(q)) {
              seen.add(entry.path)
              localResults.push(entry)
            }
          }
        }
        setFlatSearchResults(localResults.slice(0, 50))
        setIsSearchLoading(false)
      }
    }, 150) // 150ms debounce — responsive yet avoids excessive IPC calls

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [searchQuery, projectPath, dirCache])

  if (!projectPath) return null

  const rootEntries = dirCache[''] ?? []
  const isSearching = searchQuery.trim().length > 0

  return (
    <div
      ref={containerRef}
      className="w-[280px] max-h-[420px] flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-lg overflow-hidden"
      role="dialog"
      aria-label={t('contextMention.popoverAria', { defaultValue: 'Add file context' })}
    >
      {/* Search input */}
      <div className="shrink-0 px-2.5 py-2 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[hsl(var(--muted))]">
          <Search className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('contextMention.searchPlaceholder', { defaultValue: 'Search files...' })}
            className="flex-1 bg-transparent text-xs text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none"
            aria-label={t('contextMention.searchAria', { defaultValue: 'Search project files' })}
          />
        </div>
      </div>

      {/* File tree / Search results */}
      <div className="flex-1 overflow-y-auto py-1" role="tree" aria-label="Project files">
        {rootEntries.length === 0 && !isSearching ? (
          <div className="px-3 py-4 text-xs text-[hsl(var(--muted-foreground))] text-center">
            {t('contextMention.loading', { defaultValue: 'Loading...' })}
          </div>
        ) : isSearching ? (
          isSearchLoading ? (
            <div className="px-3 py-4 text-xs text-[hsl(var(--muted-foreground))] text-center">
              {t('contextMention.searching', { defaultValue: 'Searching...' })}
            </div>
          ) : flatSearchResults && flatSearchResults.length > 0 ? (
            flatSearchResults.map((entry) => (
              <ContextFileNode
                key={entry.path}
                entry={entry}
                depth={0}
                isSelected={selectedPaths.has(entry.path)}
                onClick={handleEntryClick}
                showFullPath
              />
            ))
          ) : (
            <div className="px-3 py-4 text-xs text-[hsl(var(--muted-foreground))] text-center">
              {t('contextMention.noResults', { defaultValue: 'No matching files' })}
            </div>
          )
        ) : (
          rootEntries.map((entry) => (
            <ContextTreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              dirCache={dirCache}
              expandedDirs={expandedDirs}
              selectedPaths={selectedPaths}
              onToggleDir={toggleDir}
              onSelect={handleEntryClick}
            />
          ))
        )}
      </div>

      {/* Selected count footer */}
      {contextFiles.length > 0 && (
        <div className="shrink-0 px-3 py-1.5 border-t border-[hsl(var(--border))] text-[10px] text-[hsl(var(--muted-foreground))]">
          {t('contextMention.selectedCount', {
            count: contextFiles.length,
            defaultValue: '{{count}} selected',
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Tree node (recursive, for browse mode)                             */
/* ------------------------------------------------------------------ */

interface ContextTreeNodeProps {
  entry: FileEntry
  depth: number
  dirCache: Record<string, FileEntry[]>
  expandedDirs: Set<string>
  selectedPaths: Set<string>
  onToggleDir: (path: string) => void
  onSelect: (entry: FileEntry) => void
}

function ContextTreeNode({
  entry,
  depth,
  dirCache,
  expandedDirs,
  selectedPaths,
  onToggleDir,
  onSelect,
}: ContextTreeNodeProps): React.JSX.Element {
  const isExpanded = expandedDirs.has(entry.path)
  const isSelected = selectedPaths.has(entry.path)
  const children = entry.isDirectory && isExpanded ? dirCache[entry.path] : undefined

  return (
    <>
      <ContextFileNode
        entry={entry}
        depth={depth}
        isSelected={isSelected}
        isExpanded={isExpanded}
        onClick={() => onSelect(entry)}
        onChevronClick={(e) => {
          e.stopPropagation()
          onToggleDir(entry.path)
        }}
      />
      {children &&
        children.map((child) => (
          <ContextTreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            dirCache={dirCache}
            expandedDirs={expandedDirs}
            selectedPaths={selectedPaths}
            onToggleDir={onToggleDir}
            onSelect={onSelect}
          />
        ))}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Individual file/dir row                                            */
/* ------------------------------------------------------------------ */

interface ContextFileNodeProps {
  entry: FileEntry
  depth: number
  isSelected: boolean
  isExpanded?: boolean
  onClick: (entry: FileEntry) => void
  onChevronClick?: (e: React.MouseEvent) => void
  showFullPath?: boolean
}

function ContextFileNode({
  entry,
  depth,
  isSelected,
  isExpanded,
  onClick,
  onChevronClick,
  showFullPath,
}: ContextFileNodeProps): React.JSX.Element {
  const paddingLeft = 8 + depth * 14

  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={isSelected}
      className={cn(
        'w-full flex items-center gap-1 py-[3px] pr-2 text-xs cursor-pointer select-none',
        'hover:bg-[hsl(var(--foreground)/0.04)] transition-colors',
        isSelected && 'bg-[hsl(var(--primary)/0.06)]',
      )}
      style={{ paddingLeft }}
      onClick={() => onClick(entry)}
    >
      {/* Directory chevron */}
      {entry.isDirectory ? (
        <span
          onClick={onChevronClick}
          className="shrink-0 flex items-center justify-center w-3.5 h-3.5"
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-3 h-3 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          )}
        </span>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}

      {/* File icon */}
      {entry.isDirectory ? (
        <FolderOpen className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      ) : (
        <FileIcon filename={entry.name} className="w-3.5 h-3.5 shrink-0" />
      )}

      {/* Name or path */}
      <span className="truncate text-[hsl(var(--foreground))]">
        {showFullPath ? entry.path : entry.name}
      </span>

      {/* Selected indicator */}
      {isSelected && (
        <Check className="w-3 h-3 shrink-0 ml-auto text-[hsl(var(--primary))]" aria-hidden="true" />
      )}
    </button>
  )
}
