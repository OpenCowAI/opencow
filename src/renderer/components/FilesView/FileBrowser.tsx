// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useMemo, useState, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ChevronRight, Home, X, FileText, Globe, ImageIcon, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFocusableListNav } from '@/hooks/useFocusableListNav'
import {
  resolveCreateParentPath,
  useProjectFileOperations,
} from '@/hooks/useProjectFileOperations'
import { useDialogState } from '@/hooks/useModalAnimation'
import { normalizeFileContentReadResult } from '@/lib/fileContentReadResult'
import { FileIcon } from './FileIcon'
import { FileViewerStarButton } from '../ui/FileViewerStarButton'
import { Dialog } from '../ui/Dialog'
import { CodeViewer } from '../ui/code-viewer'
import { MarkdownPreviewWithToc } from '../ui/MarkdownPreviewWithToc'
import { wrapHtmlForSafePreview } from '@/lib/htmlSandbox'
import { ImageLightbox } from '../DetailPanel/ImageLightbox'
import type { FileEntry } from '@shared/types'
import { getAppAPI } from '@/windowAPI'
import { writeContextFileDrag } from '@/lib/contextFileDnd'
import { setContextFileDragPreview } from '@/lib/contextFileDragPreview'
import { useFileStore } from '@/stores/fileStore'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  FilesItemContextMenu,
  type FilesItemContextMenuState,
} from './FilesItemContextMenu'

interface FileBrowserProps {
  projectPath: string
  projectName: string
  projectId: string
  onOpenSearch?: () => void
  /** Optional external open request (e.g. quick-open result) */
  externalOpenPath?: string | null
  onExternalOpenConsumed?: () => void
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
  entryPath: string
  content: string | null
  language: string
  kind: 'markdown' | 'html' | 'image' | 'code' | 'error'
  imageDataUrl?: string
}

interface BrowserState {
  entries: FileEntry[]
  loading: boolean
}

type BrowserAction =
  | { type: 'load-start' }
  | { type: 'load-success'; entries: FileEntry[] }
  | { type: 'load-error' }

const initialBrowserState: BrowserState = {
  entries: [],
  loading: false
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico'])
const THUMBNAIL_FETCH_CONCURRENCY = 4
const MAX_THUMBNAILS_PER_DIRECTORY = 60

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0) return ''
  return name.slice(i + 1).toLowerCase()
}

function inferPreviewKind(name: string, language: string): FilePreview['kind'] {
  const ext = extensionOf(name)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (language === 'markdown' || ext === 'md') return 'markdown'
  if (language === 'html' || ext === 'html' || ext === 'htm') return 'html'
  return 'code'
}

function imageMimeFromExt(ext: string): string {
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'avif') return 'image/avif'
  if (ext === 'bmp') return 'image/bmp'
  if (ext === 'ico') return 'image/x-icon'
  return 'image/*'
}

type PreviewMode = 'preview' | 'source'

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return
  const limit = Math.max(1, Math.min(concurrency, items.length))
  let nextIndex = 0

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (nextIndex < items.length) {
        const current = items[nextIndex]
        nextIndex += 1
        await worker(current)
      }
    }),
  )
}

function browserReducer(state: BrowserState, action: BrowserAction): BrowserState {
  switch (action.type) {
    case 'load-start':
      return { ...state, loading: true }
    case 'load-success':
      return { ...state, loading: false, entries: action.entries }
    case 'load-error':
      return { ...state, loading: false, entries: [] }
  }
}

// ── Component ──────────────────────────────────────────────────────

export function FileBrowser({
  projectPath,
  projectName,
  projectId,
  onOpenSearch,
  externalOpenPath,
  onExternalOpenConsumed,
}: FileBrowserProps): React.JSX.Element {
  const { t } = useTranslation('files')
  const [state, dispatch] = useReducer(browserReducer, initialBrowserState)
  const { entries, loading } = state
  const currentSubPath =
    useFileStore((s) => s.browserSubPathByProject[projectId] ?? '')
  const fileStructureVersion = useFileStore((s) => s.fileStructureVersionByProject[projectId] ?? 0)
  const setBrowserSubPath = useFileStore((s) => s.setBrowserSubPath)
  const previewDialog = useDialogState<FilePreview>()
  const {
    renameProjectPath,
    createProjectPath,
    deleteProjectPath,
  } = useProjectFileOperations({
    projectId,
    projectPath,
  })
  const [previewMode, setPreviewMode] = useState<PreviewMode>('preview')
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null)
  const [imageThumbs, setImageThumbs] = useState<Record<string, string>>({})
  const [contextMenu, setContextMenu] = useState<FilesItemContextMenuState | null>(null)
  const [renameTargetPath, setRenameTargetPath] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string; isDirectory: boolean } | null>(null)
  const [createDialog, setCreateDialog] = useState<{ kind: 'file' | 'folder'; parentPath: string } | null>(null)
  const [createName, setCreateName] = useState('')

  const listContainerRef = useRef<HTMLDivElement>(null)
  const skipSubmitOnBlurRef = useRef(false)
  const createInputRef = useRef<HTMLInputElement>(null)

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
    void loadDirectory(currentSubPath)
  }, [currentSubPath, fileStructureVersion, loadDirectory])

  useEffect(() => {
    setPreviewMode('preview')
  }, [previewDialog.data?.absolutePath])

  useEffect(() => {
    // Keep thumbnail cache bounded to the active directory.
    setImageThumbs({})
  }, [projectPath, currentSubPath])

  useEffect(() => {
    let cancelled = false
    const imageEntries = entries.filter((entry) => {
      if (entry.isDirectory) return false
      return IMAGE_EXTS.has(extensionOf(entry.name))
    })
    if (imageEntries.length === 0) return

    const existingThumbCount = imageEntries.reduce(
      (count, entry) => (imageThumbs[entry.path] == null ? count : count + 1),
      0,
    )
    const remainingBudget = Math.max(0, MAX_THUMBNAILS_PER_DIRECTORY - existingThumbCount)
    if (remainingBudget === 0) return

    const pending = imageEntries
      .filter((entry) => imageThumbs[entry.path] == null)
      .slice(0, remainingBudget)
    if (pending.length === 0) return

    void (async () => {
      const updates: Record<string, string> = {}
      await runWithConcurrency(
        pending,
        THUMBNAIL_FETCH_CONCURRENCY,
        async (entry) => {
          try {
            const res = await getAppAPI()['read-image-preview'](projectPath, entry.path)
            if (res.ok) {
              updates[entry.path] = res.data.dataUrl
            }
          } catch {
            // Ignore thumbnail failures; grid falls back to icon.
          }
        },
      )
      if (cancelled || Object.keys(updates).length === 0) return
      setImageThumbs((prev) => ({ ...prev, ...updates }))
    })()

    return () => {
      cancelled = true
    }
  }, [entries, imageThumbs, projectPath])

  // ── Entry actions ──────────────────────────────────────────────

  const handleEntryClick = useCallback(
    async (entry: FileEntry) => {
      if (entry.isDirectory) {
        previewDialog.close()
        setBrowserSubPath(projectId, entry.path)
      } else {
        const absolutePath = `${projectPath}/${entry.path}`
        const ext = extensionOf(entry.name)
        if (IMAGE_EXTS.has(ext)) {
          try {
            const imageResult = await getAppAPI()['read-image-preview'](projectPath, entry.path)
            if (!imageResult.ok) {
              previewDialog.show({
                fileName: entry.name,
                absolutePath,
                entryPath: entry.path,
                content: imageResult.error.message || t('browser.unableToRead'),
                language: 'plaintext',
                kind: 'error',
              })
              return
            }
            setImageThumbs((prev) => (
              prev[entry.path] ? prev : { ...prev, [entry.path]: imageResult.data.dataUrl }
            ))
            previewDialog.show({
              fileName: entry.name,
              absolutePath,
              entryPath: entry.path,
              content: null,
              language: imageResult.data.mimeType,
              kind: 'image',
              imageDataUrl: imageResult.data.dataUrl,
            })
            return
          } catch {
            previewDialog.show({
              fileName: entry.name,
              absolutePath,
              entryPath: entry.path,
              content: t('browser.unableToRead'),
              language: 'plaintext',
              kind: 'error',
            })
            return
          }
        }

        // Preview text-like file content
        try {
          const rawResult = await getAppAPI()['read-file-content'](projectPath, entry.path)
          const result = normalizeFileContentReadResult(rawResult)
          if (!result.ok) {
            previewDialog.show({
              fileName: entry.name,
              absolutePath,
              entryPath: entry.path,
              content: result.error.message || t('browser.unableToRead'),
              language: 'plaintext',
              kind: 'error',
            })
            return
          }
          const kind = inferPreviewKind(entry.name, result.data.language)
          previewDialog.show({
            fileName: entry.name,
            absolutePath,
            entryPath: entry.path,
            content: result.data.content,
            language: result.data.language,
            kind,
          })
        } catch {
          previewDialog.show({
            fileName: entry.name,
            absolutePath,
            entryPath: entry.path,
            content: t('browser.unableToRead'),
            language: 'plaintext',
            kind: 'error',
          })
        }
      }
    },
    [previewDialog, projectPath, projectId, setBrowserSubPath, t]
  )

  const startRename = useCallback((entry: FileEntry) => {
    setRenameTargetPath(entry.path)
    setRenameDraft(entry.name)
  }, [])

  const cancelRename = useCallback(() => {
    setRenameTargetPath(null)
    setRenameDraft('')
  }, [])

  const confirmRename = useCallback(async () => {
    if (!renameTargetPath) return
    const targetPath = renameTargetPath
    const didRename = await renameProjectPath({
      targetPath,
      nextName: renameDraft,
      onRenamed: ({ oldPath }) => {
        if (previewDialog.data?.entryPath === oldPath) {
          previewDialog.close()
        }
      },
    })
    if (!didRename) return
    if (previewDialog.data?.entryPath === targetPath) {
      previewDialog.close()
    }
    setRenameTargetPath(null)
    setRenameDraft('')
  }, [previewDialog, renameDraft, renameProjectPath, renameTargetPath])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    const targetPath = deleteTarget.path
    const didDelete = await deleteProjectPath({
      targetPath,
      onDeleted: ({ path }) => {
        if (previewDialog.data?.entryPath && (
          previewDialog.data.entryPath === path ||
          previewDialog.data.entryPath.startsWith(`${path}/`)
        )) {
          previewDialog.close()
        }
      },
    })
    if (!didDelete) return
    setDeleteTarget(null)
  }, [deleteProjectPath, deleteTarget, previewDialog])

  const openCreateDialog = useCallback((kind: 'file' | 'folder', path: string, isDirectory: boolean) => {
    const parentPath = resolveCreateParentPath({ path, isDirectory })
    setCreateDialog({ kind, parentPath })
    setCreateName('')
  }, [])

  const confirmCreate = useCallback(async () => {
    if (!createDialog) return
    const didCreate = await createProjectPath({
      kind: createDialog.kind,
      parentPath: createDialog.parentPath,
      name: createName,
    })
    if (!didCreate) return
    setCreateDialog(null)
    setCreateName('')
  }, [createDialog, createName, createProjectPath])

  useEffect(() => {
    if (!createDialog) return
    const timer = window.setTimeout(() => {
      const input = createInputRef.current
      if (!input) return
      input.focus()
      input.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [createDialog])

  useEffect(() => {
    if (!externalOpenPath) return
    const entry = entries.find((e) => e.path === externalOpenPath)
    if (!entry) return
    void handleEntryClick(entry).finally(() => {
      onExternalOpenConsumed?.()
    })
  }, [entries, externalOpenPath, handleEntryClick, onExternalOpenConsumed])

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

  const activePreview = previewDialog.data
  const hasRichPreview =
    activePreview?.kind === 'markdown' ||
    activePreview?.kind === 'html'
  const showPreviewPane = activePreview != null && (
    activePreview.kind === 'image' ||
    hasRichPreview
  )

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-[hsl(var(--border))] text-xs">
        <button
          onClick={() => setBrowserSubPath(projectId, '')}
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
                onClick={() => setBrowserSubPath(projectId, path)}
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
        {onOpenSearch && (
          <button
            type="button"
            onClick={onOpenSearch}
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.05)] transition-colors"
            aria-label={t('search.openButtonAria', { defaultValue: 'Search files' })}
            title={t('search.shortcutHint', { defaultValue: 'Search files (⌘/Ctrl+G)' })}
          >
            <Search className="h-3 w-3" />
            <span>{t('search.openButton', { defaultValue: 'Search' })}</span>
            <kbd className="font-mono text-[9px]">⌘G</kbd>
          </button>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* File list */}
        <div
          ref={listContainerRef}
          className="h-full overflow-y-auto"
          onKeyDown={handleKeyDown}
          onContextMenu={(event) => {
            const target = event.target as HTMLElement | null
            if (target?.closest('[data-nav-key]')) return
            event.preventDefault()
            setFocusedKey(null)
            setContextMenu({
              x: event.clientX,
              y: event.clientY,
              path: currentSubPath,
              name: currentSubPath ? currentSubPath.split('/').at(-1) ?? projectName : projectName,
              isDirectory: true,
              scope: 'directory',
            })
          }}
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
                    draggable
                    onDragStart={(e) => {
                      writeContextFileDrag(e.dataTransfer, {
                        path: entry.path,
                        name: entry.name,
                        isDirectory: entry.isDirectory,
                      })
                      setContextFileDragPreview(e.dataTransfer, {
                        name: entry.name,
                        isDirectory: entry.isDirectory,
                        sourceElement: e.currentTarget,
                        pointerClient: { clientX: e.clientX, clientY: e.clientY },
                      })
                    }}
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
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setFocusedKey(entry.path)
                      setContextMenu({
                        x: event.clientX,
                        y: event.clientY,
                        path: entry.path,
                        name: entry.name,
                        isDirectory: entry.isDirectory,
                      })
                    }}
                    role="gridcell"
                    aria-label={
                      entry.isDirectory
                        ? t('browser.openFolderAria', { name: entry.name })
                        : t('browser.openFileAria', { name: entry.name })
                    }
                    title={entry.name}
                  >
                    <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-md bg-[hsl(var(--muted)/0.25)] overflow-hidden">
                      {!entry.isDirectory && imageThumbs[entry.path] ? (
                        <img
                          src={imageThumbs[entry.path]}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <FileIcon
                          filename={entry.name}
                          isDirectory={entry.isDirectory}
                          className={cn('h-7 w-7', entry.isDirectory && 'text-[hsl(var(--primary))]')}
                        />
                      )}
                    </div>
                    <p className={cn('line-clamp-2 text-center text-[11px] leading-4 break-all', entry.isDirectory && 'font-medium')}>
                      {renameTargetPath === entry.path ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void confirmRename()
                              return
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              skipSubmitOnBlurRef.current = true
                              cancelRename()
                            }
                          }}
                          onBlur={() => {
                            if (skipSubmitOnBlurRef.current) {
                              skipSubmitOnBlurRef.current = false
                              return
                            }
                            if (renameTargetPath !== entry.path) return
                            void confirmRename()
                          }}
                          className="w-full rounded border border-[hsl(var(--ring)/0.5)] bg-[hsl(var(--background))] px-1 py-0.5 text-[11px] text-left outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
                          aria-label={entry.isDirectory ? t('actions.renameFolder') : t('actions.renameFile')}
                        />
                      ) : (
                        entry.name
                      )}
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
      {activePreview !== null && (
        <Dialog
          open={previewDialog.open}
          onClose={previewDialog.close}
          title={activePreview.fileName}
          size="3xl"
          className="!max-w-6xl"
        >
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[hsl(var(--border))]">
            {activePreview.kind === 'markdown' ? (
              <FileText className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
            ) : activePreview.kind === 'html' ? (
              <Globe className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
            ) : activePreview.kind === 'image' ? (
              <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
            ) : (
              <FileIcon filename={activePreview.fileName} className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="text-xs font-medium truncate">{activePreview.fileName}</span>
            <FileViewerStarButton
              filePath={activePreview.absolutePath}
              content={activePreview.content ?? activePreview.imageDataUrl ?? ''}
              starContext={{ type: 'project', projectId }}
              metadata={{
                title: activePreview.fileName,
                mimeType:
                  activePreview.kind === 'image'
                    ? imageMimeFromExt(extensionOf(activePreview.fileName))
                    : activePreview.kind === 'html'
                    ? 'text/html'
                    : activePreview.kind === 'markdown'
                    ? 'text/markdown'
                    : 'text/plain',
                fileExtension: (() => {
                  const ext = extensionOf(activePreview.fileName)
                  return ext ? `.${ext}` : null
                })(),
              }}
            />
            <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))] truncate">
              {activePreview.language}
            </span>
            {showPreviewPane && (
              <div
                className="flex rounded-md border border-[hsl(var(--border))] overflow-hidden ml-2"
                role="tablist"
                aria-label={t('browser.previewModeAria')}
              >
                <button
                  role="tab"
                  aria-selected={previewMode === 'preview'}
                  onClick={() => setPreviewMode('preview')}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
                    previewMode === 'preview'
                      ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                      : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
                  )}
                >
                  {t('common:preview')}
                </button>
                {activePreview.kind !== 'image' && (
                  <button
                    role="tab"
                    aria-selected={previewMode === 'source'}
                    onClick={() => setPreviewMode('source')}
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
                      previewMode === 'source'
                        ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                        : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
                    )}
                  >
                    {t('browser.source')}
                  </button>
                )}
              </div>
            )}
            <button
              onClick={previewDialog.close}
              className="p-1 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
              aria-label={t('browser.closePreview')}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <p className="px-4 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border)/0.6)] truncate">
            {activePreview.absolutePath}
          </p>
          {activePreview.kind === 'image' && previewMode === 'preview' ? (
            <div className="max-h-[78vh] overflow-auto p-4 bg-[hsl(var(--muted)/0.15)]">
              {activePreview.imageDataUrl ? (
                <button
                  type="button"
                  className="mx-auto block rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 hover:border-[hsl(var(--primary)/0.5)] transition-colors"
                  onClick={() => setLightboxImage({ src: activePreview.imageDataUrl!, alt: activePreview.fileName })}
                >
                  <img
                    src={activePreview.imageDataUrl}
                    alt={activePreview.fileName}
                    className="max-h-[70vh] max-w-full object-contain"
                  />
                </button>
              ) : (
                <div className="h-[40vh] flex items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
                  {t('browser.unableToRead')}
                </div>
              )}
            </div>
          ) : activePreview.kind === 'markdown' && previewMode === 'preview' ? (
            <MarkdownPreviewWithToc content={activePreview.content ?? ''} className="h-[78vh]" />
          ) : activePreview.kind === 'html' && previewMode === 'preview' ? (
            <iframe
              srcDoc={wrapHtmlForSafePreview(activePreview.content ?? '')}
              sandbox="allow-scripts"
              title={`HTML preview: ${activePreview.fileName}`}
              className="w-full h-[78vh] border-0 bg-white"
            />
          ) : (
            <div className="h-[78vh]">
              <CodeViewer content={activePreview.content ?? ''} language={activePreview.language} />
            </div>
          )}
        </Dialog>
      )}
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
      {contextMenu && (
        <FilesItemContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onCreateFile={(path, isDirectory) => {
            openCreateDialog('file', path, isDirectory)
          }}
          onCreateFolder={(path, isDirectory) => {
            openCreateDialog('folder', path, isDirectory)
          }}
          onRename={(path) => {
            const entry = entries.find((item) => item.path === path)
            if (!entry) return
            startRename(entry)
          }}
          onDelete={(path, isDirectory, name) => {
            setDeleteTarget({ path, isDirectory, name })
          }}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          open={deleteTarget !== null}
          title={
            deleteTarget.isDirectory
              ? t('actions.deleteFolderConfirmTitle', { name: deleteTarget.name })
              : t('actions.deleteFileConfirmTitle', { name: deleteTarget.name })
          }
          message={
            deleteTarget.isDirectory
              ? t('actions.deleteFolderConfirmMessage')
              : t('actions.deleteFileConfirmMessage')
          }
          confirmLabel={t('actions.deleteConfirm')}
          cancelLabel={t('common:cancel')}
          variant="destructive"
          onConfirm={() => {
            void confirmDelete()
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {createDialog && (
        <Dialog
          open={createDialog !== null}
          onClose={() => {
            setCreateDialog(null)
            setCreateName('')
          }}
          title={createDialog.kind === 'file' ? t('actions.newFile') : t('actions.newFolder')}
          size="sm"
        >
          <div className="p-4 space-y-3">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {createDialog.parentPath
                ? `${t('actions.createIn')}: ${createDialog.parentPath}`
                : `${t('actions.createIn')}: /`}
            </p>
            <input
              ref={createInputRef}
              autoFocus
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void confirmCreate()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setCreateDialog(null)
                  setCreateName('')
                }
              }}
              className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              placeholder={createDialog.kind === 'file' ? t('actions.newFilePlaceholder') : t('actions.newFolderPlaceholder')}
              aria-label={createDialog.kind === 'file' ? t('actions.newFile') : t('actions.newFolder')}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreateDialog(null)
                  setCreateName('')
                }}
                className="px-3 py-1.5 text-sm rounded-lg border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
              >
                {t('common:cancel')}
              </button>
              <button
                type="button"
                onClick={() => { void confirmCreate() }}
                className="px-3 py-1.5 text-sm rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
              >
                {t('actions.createConfirm')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
