// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useMemo, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ChevronRight, Home, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFocusableListNav } from '@/hooks/useFocusableListNav'
import { useDialogState } from '@/hooks/useModalAnimation'
import { normalizeFileContentReadResult } from '@/lib/fileContentReadResult'
import { FileIcon } from './FileIcon'
import { FileViewerStarButton } from '../ui/FileViewerStarButton'
import { Dialog } from '../ui/Dialog'
import type { FileEntry } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

interface FileBrowserProps {
  projectPath: string
  projectName: string
  projectId: string
}

// ── Formatters ─────────────────────────────────────────────────────

/** Format file size to human-readable string */
function formatSize(bytes: number): string {
  if (bytes === 0) return '\u2014'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Format timestamp to relative date */
function formatDate(ts: number, t: TFunction): string {
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return t('common:today')
  if (days === 1) return t('common:yesterday')
  if (days < 7) return t('common:daysAgoShort', { count: days })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── State management ───────────────────────────────────────────────

interface FilePreview {
  fileName: string
  /** Absolute filesystem path — used as artifact dedup key. */
  absolutePath: string
  content: string
  language: string
}

interface BrowserState {
  currentSubPath: string
  entries: FileEntry[]
  loading: boolean
}

type BrowserAction =
  | { type: 'navigate'; subPath: string }
  | { type: 'load-start' }
  | { type: 'load-success'; entries: FileEntry[] }
  | { type: 'load-error' }

const initialBrowserState: BrowserState = {
  currentSubPath: '',
  entries: [],
  loading: false
}

function browserReducer(state: BrowserState, action: BrowserAction): BrowserState {
  switch (action.type) {
    case 'navigate':
      return { ...state, currentSubPath: action.subPath }
    case 'load-start':
      return { ...state, loading: true }
    case 'load-success':
      return { ...state, loading: false, entries: action.entries }
    case 'load-error':
      return { ...state, loading: false, entries: [] }
  }
}

// ── Component ──────────────────────────────────────────────────────

export function FileBrowser({ projectPath, projectName, projectId }: FileBrowserProps): React.JSX.Element {
  const { t } = useTranslation('files')
  const [state, dispatch] = useReducer(browserReducer, initialBrowserState)
  const { currentSubPath, entries, loading } = state
  const previewDialog = useDialogState<FilePreview>()

  const listContainerRef = useRef<HTMLDivElement>(null)

  // ── Directory loading ──────────────────────────────────────────

  const loadDirectory = useCallback(
    async (subPath: string) => {
      dispatch({ type: 'load-start' })
      try {
        const result = await getAppAPI()['list-project-files'](
          projectPath,
          subPath || undefined
        )
        // Sort: directories first, then alphabetically
        const sorted = [...result].sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        dispatch({ type: 'load-success', entries: sorted })
      } catch {
        dispatch({ type: 'load-error' })
      }
    },
    [projectPath]
  )

  useEffect(() => {
    loadDirectory(currentSubPath)
  }, [currentSubPath, loadDirectory])

  // ── Entry actions ──────────────────────────────────────────────

  const handleEntryClick = useCallback(
    async (entry: FileEntry) => {
      if (entry.isDirectory) {
        previewDialog.close()
        dispatch({ type: 'navigate', subPath: entry.path })
      } else {
        // Preview file content
        try {
          const rawResult = await getAppAPI()['read-file-content'](projectPath, entry.path)
          const result = normalizeFileContentReadResult(rawResult)
          if (!result.ok) {
            previewDialog.show({
              fileName: entry.name,
              absolutePath: `${projectPath}/${entry.path}`,
              content: result.error.message || t('browser.unableToRead'),
              language: 'plaintext',
            })
            return
          }
          previewDialog.show({
            fileName: entry.name,
            absolutePath: `${projectPath}/${entry.path}`,
            content: result.data.content,
            language: result.data.language,
          })
        } catch {
          previewDialog.show({
            fileName: entry.name,
            absolutePath: `${projectPath}/${entry.path}`,
            content: t('browser.unableToRead'),
            language: 'plaintext',
          })
        }
      }
    },
    [previewDialog, projectPath, t]
  )

  // ── Keyboard navigation ────────────────────────────────────────

  const entryKeys = useMemo(() => entries.map((e) => e.path), [entries])

  const entryByPath = useMemo(() => {
    const map = new Map<string, FileEntry>()
    for (const entry of entries) {
      map.set(entry.path, entry)
    }
    return map
  }, [entries])

  const handleActivate = useCallback(
    (key: string) => {
      const entry = entryByPath.get(key)
      if (entry) handleEntryClick(entry)
    },
    [entryByPath, handleEntryClick]
  )

  const { setFocusedKey, handleKeyDown, getTabIndex } = useFocusableListNav({
    keys: entryKeys,
    onActivate: handleActivate,
    containerRef: listContainerRef,
    itemAttribute: 'data-nav-key'
  })

  // ── Breadcrumb ─────────────────────────────────────────────────

  const segments = currentSubPath ? currentSubPath.split('/').filter(Boolean) : []

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-[hsl(var(--border))] text-xs">
        <button
          onClick={() => dispatch({ type: 'navigate', subPath: '' })}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors',
            'hover:bg-[hsl(var(--foreground)/0.04)] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
            segments.length === 0 && 'text-[hsl(var(--foreground))] font-medium'
          )}
        >
          <Home className="h-3 w-3" aria-hidden="true" />
          {projectName}
        </button>
        {segments.map((seg, i) => {
          const path = segments.slice(0, i + 1).join('/')
          const isLast = i === segments.length - 1
          return (
            <span key={path} className="flex items-center gap-1">
              <ChevronRight
                className="h-3 w-3 text-[hsl(var(--muted-foreground))]"
                aria-hidden="true"
              />
              <button
                onClick={() => dispatch({ type: 'navigate', subPath: path })}
                className={cn(
                  'px-1.5 py-0.5 rounded transition-colors',
                  'hover:bg-[hsl(var(--foreground)/0.04)]',
                  isLast
                    ? 'text-[hsl(var(--foreground))] font-medium'
                    : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
                )}
              >
                {seg}
              </button>
            </span>
          )
        })}
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* File list */}
        <div
          ref={listContainerRef}
          className="h-full overflow-y-auto"
          onKeyDown={handleKeyDown}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full text-[hsl(var(--muted-foreground))] text-sm">
              {t('browser.loading')}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[hsl(var(--muted-foreground))] text-sm">
              {t('browser.emptyDirectory')}
            </div>
          ) : (
            <div
              className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-3 gap-y-4 p-4"
              role="grid"
              aria-label={t('browser.fileGridAria')}
            >
              {entries.map((entry) => {
                const isSelected = previewDialog.data?.absolutePath === `${projectPath}/${entry.path}`
                const meta = entry.isDirectory
                  ? t('browser.folderMeta', { modified: formatDate(entry.modifiedAt, t) })
                  : t('browser.fileMeta', {
                      size: formatSize(entry.size),
                      modified: formatDate(entry.modifiedAt, t),
                    })

                return (
                  <button
                    key={entry.path}
                    type="button"
                    data-nav-key={entry.path}
                    tabIndex={getTabIndex(entry.path)}
                    className={cn(
                      'group rounded-lg p-2 text-left transition-colors',
                      'hover:bg-[hsl(var(--foreground)/0.04)]',
                      'outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-inset',
                      isSelected && 'bg-[hsl(var(--primary)/0.1)]'
                    )}
                    onClick={() => {
                      setFocusedKey(entry.path)
                      handleEntryClick(entry)
                    }}
                    role="gridcell"
                    aria-label={
                      entry.isDirectory
                        ? t('browser.openFolderAria', { name: entry.name })
                        : t('browser.openFileAria', { name: entry.name })
                    }
                    title={entry.name}
                  >
                    <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-md bg-[hsl(var(--muted)/0.25)]">
                      <FileIcon
                        filename={entry.name}
                        isDirectory={entry.isDirectory}
                        className={cn('h-7 w-7', entry.isDirectory && 'text-[hsl(var(--primary))]')}
                      />
                    </div>
                    <p className={cn('line-clamp-2 text-center text-[11px] leading-4 break-all', entry.isDirectory && 'font-medium')}>
                      {entry.name}
                    </p>
                    <p className="mt-1 line-clamp-2 text-center text-[10px] leading-3.5 text-[hsl(var(--muted-foreground))]">
                      {meta}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Preview modal */}
      {previewDialog.data !== null && (
        <Dialog
          open={previewDialog.open}
          onClose={previewDialog.close}
          title={previewDialog.data.fileName}
          size="3xl"
          className="!max-w-6xl"
        >
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[hsl(var(--border))]">
            <FileIcon filename={previewDialog.data.fileName} className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs font-medium truncate">{previewDialog.data.fileName}</span>
            <FileViewerStarButton
              filePath={previewDialog.data.absolutePath}
              content={previewDialog.data.content}
              starContext={{ type: 'project', projectId }}
            />
            <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))] truncate">
              {previewDialog.data.language}
            </span>
            <button
              onClick={previewDialog.close}
              className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
              aria-label={t('browser.closePreview')}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <p className="px-4 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border)/0.6)] truncate">
            {previewDialog.data.absolutePath}
          </p>
          <pre className="max-h-[78vh] overflow-auto p-4 text-xs font-mono text-[hsl(var(--foreground))] whitespace-pre-wrap break-words bg-[hsl(var(--muted)/0.15)]">
            {previewDialog.data.content}
          </pre>
        </Dialog>
      )}
    </div>
  )
}
