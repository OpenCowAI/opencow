// SPDX-License-Identifier: Apache-2.0

/**
 * fileStore — Open file editor state.
 *
 * Manages the open file tabs, active file selection, directory tree
 * expansion, file content tracking (dirty/saved), and the pending
 * file refresh queue used by useFileSync.
 *
 * Completely independent of all other stores — no cross-store reads
 * or writes.
 *
 * Populated by:
 *   - User interactions (open/close/edit files)
 *   - DataBus tool_use/tool_result correlation in useAppBootstrap
 *   - useFileSync effect cycle for auto-refresh
 */

import { create } from 'zustand'
import { getAppAPI } from '@/windowAPI'
import { normalizeFileContentReadResult } from '@/lib/fileContentReadResult'
import type { FileSearchRecentKind, FileSearchRecentSelection } from '@shared/types'

// ─── Types ────────────────────────────────────────────────────────────

export interface OpenFile {
  path: string
  name: string
  language: string
  content: string
  savedContent: string
  isDirty: boolean
  /** Rendering kind in IDE pane: plain text editor vs image preview. */
  viewKind: 'text' | 'image'
  /** Data URL for image preview files; null for text files. */
  imageDataUrl: string | null
}

export interface OpenFileParams {
  path: string
  name: string
  language: string
  content: string
  viewKind?: 'text' | 'image'
  imageDataUrl?: string | null
}

/** Parameters for refreshing an open file's content from disk. */
export interface RefreshFileParams {
  path: string
  content: string
  language: string
}

export interface PendingEditorJump {
  path: string
  line: number
}

interface PendingIntent<TPayload> {
  id: string
  payload: TPayload
  createdAt: number
}

export interface PendingTreeReveal {
  path: string
}

export interface PendingDeleteUndo {
  undoToken: string
  path: string
  createdAt: number
}

// ─── Store Interface ──────────────────────────────────────────────────

export interface FileStore {
  /** Open editor tabs per project. */
  openFilesByProject: Record<string, OpenFile[]>
  /** Active editor tab path per project. */
  activeFilePathByProject: Record<string, string | null>
  /** Expanded tree directories per project. */
  expandedTreeDirsByProject: Record<string, Set<string>>
  /** Per-project current directory for FileBrowser mode (relative path, '' = root). */
  browserSubPathByProject: Record<string, string>
  /** Incremented on file-structure mutations (create/rename/delete/restore) for view refresh. */
  fileStructureVersionByProject: Record<string, number>
  /** Last file-search query per project (for quick-open restore). */
  fileSearchQueryByProject: Record<string, string>
  /** Recent file-search selections (newest first). */
  recentFileSearchSelectionsByProject: Record<string, FileSearchRecentSelection[]>
  /**
   * Pending editor-jump intents queue per project.
   * Consumers ack by id after successful application to avoid drop-on-mismatch races.
   */
  pendingEditorJumpIntentsByProject: Record<string, PendingIntent<PendingEditorJump>[]>
  /**
   * Pending tree-reveal intents queue per project.
   * Consumers ack by id after successful application to avoid drop-on-mismatch races.
   */
  pendingTreeRevealIntentsByProject: Record<string, PendingIntent<PendingTreeReveal>[]>
  /** Per-project LIFO stack for delete undo tokens (Cmd/Ctrl+Z). */
  pendingDeleteUndosByProject: Record<string, PendingDeleteUndo[]>

  getOpenFiles: (projectId: string) => OpenFile[]
  getActiveFilePath: (projectId: string) => string | null
  openFile: (projectId: string, params: OpenFileParams) => void
  closeFile: (projectId: string, path: string) => void
  closeOtherFiles: (projectId: string, keepPath: string) => void
  closeAllFiles: (projectId: string) => void
  closeFilesToRight: (projectId: string, path: string) => void
  setActiveFile: (projectId: string, path: string) => void
  updateFileContent: (projectId: string, path: string, content: string) => void
  markFileSaved: (projectId: string, path: string) => void
  remapPath: (projectId: string, oldPath: string, newPath: string) => void
  remapPathPrefix: (projectId: string, oldPrefix: string, newPrefix: string) => void
  removePath: (projectId: string, targetPath: string) => void
  removePathPrefix: (projectId: string, targetPrefix: string) => void
  toggleTreeDir: (projectId: string, path: string) => void
  expandTreeDirs: (projectId: string, paths: string[]) => void
  setBrowserSubPath: (projectId: string, subPath: string) => void
  clearBrowserSubPath: (projectId: string) => void
  bumpFileStructureVersion: (projectId: string) => void
  setFileSearchQuery: (projectId: string, query: string) => void
  recordFileSearchSelection: (projectId: string, selection: { path: string; name: string; kind: FileSearchRecentKind }) => void
  enqueueEditorJumpIntent: (projectId: string, jump: PendingEditorJump) => string
  peekEditorJumpIntent: (projectId: string) => PendingIntent<PendingEditorJump> | null
  ackEditorJumpIntent: (projectId: string, intentId: string) => void
  enqueueTreeRevealIntent: (projectId: string, reveal: PendingTreeReveal) => string
  peekTreeRevealIntent: (projectId: string) => PendingIntent<PendingTreeReveal> | null
  ackTreeRevealIntent: (projectId: string, intentId: string) => void
  pushDeleteUndo: (projectId: string, entry: { undoToken: string; path: string }) => void
  peekLatestDeleteUndo: (projectId: string) => PendingDeleteUndo | null
  popLatestDeleteUndo: (projectId: string) => PendingDeleteUndo | null
  removeDeleteUndo: (projectId: string, undoToken: string) => void

  /** Refresh an open file's content from disk. Skips isDirty files and no-ops on same content. */
  refreshFile: (projectId: string, params: RefreshFileParams) => void
  /** Batch-refresh all open non-dirty files by reading from disk. */
  refreshOpenFiles: (projectId: string, projectPath: string) => Promise<void>

  /** tool_use → tool_result correlation: maps toolUseId to filePath for file-modifying tools. */
  pendingFileWritesByToolId: Record<string, { path: string; projectId: string | null }>
  trackPendingFileWrite: (toolUseId: string, filePath: string, projectId?: string | null) => void
  resolvePendingFileWrite: (toolUseId: string) => { path: string; projectId: string | null } | null

  /** File paths needing refresh per project (written by useAppBootstrap, consumed by useFileSync). */
  pendingFileRefreshPathsByProject: Record<string, string[]>
  markFileNeedsRefresh: (projectId: string, path: string) => void
  markAllOpenFilesNeedRefresh: (projectId: string) => void
  clearPendingFileRefresh: (projectId: string) => void
  /** Atomic swap: returns current pending paths for the project and clears its queue in one set(). */
  consumePendingFileRefresh: (projectId: string) => string[]

  reset: () => void
}

// ─── Initial State ────────────────────────────────────────────────────

const initialState = {
  openFilesByProject: {} as Record<string, OpenFile[]>,
  activeFilePathByProject: {} as Record<string, string | null>,
  expandedTreeDirsByProject: {} as Record<string, Set<string>>,
  browserSubPathByProject: {} as Record<string, string>,
  fileStructureVersionByProject: {} as Record<string, number>,
  fileSearchQueryByProject: {} as Record<string, string>,
  recentFileSearchSelectionsByProject: {} as Record<string, FileSearchRecentSelection[]>,
  pendingEditorJumpIntentsByProject: {} as Record<string, PendingIntent<PendingEditorJump>[]>,
  pendingTreeRevealIntentsByProject: {} as Record<string, PendingIntent<PendingTreeReveal>[]>,
  pendingDeleteUndosByProject: {} as Record<string, PendingDeleteUndo[]>,
  pendingFileWritesByToolId: {} as Record<string, { path: string; projectId: string | null }>,
  pendingFileRefreshPathsByProject: {} as Record<string, string[]>,
}

const MAX_RECENT_FILE_SEARCH_PATHS = 20
const MAX_PENDING_DELETE_UNDOS = 200

function createIntentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isSameOrChildPath(path: string, parentPath: string): boolean {
  return path === parentPath || path.startsWith(`${parentPath}/`)
}

function remapPathIfNeeded(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath
  if (path.startsWith(`${oldPath}/`)) return `${newPath}${path.slice(oldPath.length)}`
  return path
}

function remapIntentQueue<TPayload extends { path: string }>(
  queue: PendingIntent<TPayload>[],
  oldPath: string,
  newPath: string,
): PendingIntent<TPayload>[] {
  let changed = false
  const next = queue.map((intent) => {
    const mapped = remapPathIfNeeded(intent.payload.path, oldPath, newPath)
    if (mapped === intent.payload.path) return intent
    changed = true
    return {
      ...intent,
      payload: {
        ...intent.payload,
        path: mapped,
      },
    }
  })
  return changed ? next : queue
}

// ─── Store Instance ───────────────────────────────────────────────────

export const useFileStore = create<FileStore>((set, get) => ({
  ...initialState,

  // ── Core file operations ──────────────────────────────────────

  getOpenFiles: (projectId) => get().openFilesByProject[projectId] ?? [],

  getActiveFilePath: (projectId) => get().activeFilePathByProject[projectId] ?? null,

  openFile: (projectId, { path, name, language, content, viewKind = 'text', imageDataUrl = null }) =>
    set((s) => {
      const normalizedImageDataUrl = viewKind === 'image' ? imageDataUrl : null
      const openFiles = s.openFilesByProject[projectId] ?? []
      const existing = openFiles.find((f) => f.path === path)
      if (existing) {
        // Already open → switch tab + refresh content (only when not dirty and content differs)
        if (
          existing.isDirty ||
          (
            existing.content === content &&
            existing.language === language &&
            existing.viewKind === viewKind &&
            existing.imageDataUrl === normalizedImageDataUrl
          )
        ) {
          return {
            activeFilePathByProject: {
              ...s.activeFilePathByProject,
              [projectId]: path,
            },
          }
        }
        return {
          openFilesByProject: {
            ...s.openFilesByProject,
            [projectId]: openFiles.map((f) =>
              f.path === path
                ? {
                    ...f,
                    content,
                    savedContent: content,
                    language,
                    isDirty: false,
                    viewKind,
                    imageDataUrl: normalizedImageDataUrl,
                  }
                : f
            ),
          },
          activeFilePathByProject: {
            ...s.activeFilePathByProject,
            [projectId]: path,
          },
        }
      }
      return {
        openFilesByProject: {
          ...s.openFilesByProject,
          [projectId]: [
            ...openFiles,
            {
              path,
              name,
              language,
              content,
              savedContent: content,
              isDirty: false,
              viewKind,
              imageDataUrl: normalizedImageDataUrl,
            },
          ],
        },
        activeFilePathByProject: {
          ...s.activeFilePathByProject,
          [projectId]: path,
        },
      }
    }),

  closeFile: (projectId, path) =>
    set((s) => {
      const openFiles = s.openFilesByProject[projectId] ?? []
      const idx = openFiles.findIndex((f) => f.path === path)
      if (idx < 0) return {}
      const newFiles = openFiles.filter((f) => f.path !== path)
      const currentActive = s.activeFilePathByProject[projectId] ?? null
      let newActive = currentActive
      if (currentActive === path) {
        if (newFiles.length === 0) {
          newActive = null
        } else {
          const nextIdx = Math.min(idx, newFiles.length - 1)
          newActive = newFiles[nextIdx].path
        }
      }
      return {
        openFilesByProject: {
          ...s.openFilesByProject,
          [projectId]: newFiles,
        },
        activeFilePathByProject: {
          ...s.activeFilePathByProject,
          [projectId]: newActive,
        },
      }
    }),

  closeOtherFiles: (projectId, keepPath) =>
    set((s) => {
      const openFiles = s.openFilesByProject[projectId] ?? []
      if (openFiles.length <= 1) return {}
      const keep = openFiles.find((f) => f.path === keepPath)
      if (!keep) return {}
      return {
        openFilesByProject: {
          ...s.openFilesByProject,
          [projectId]: [keep],
        },
        activeFilePathByProject: {
          ...s.activeFilePathByProject,
          [projectId]: keep.path,
        },
      }
    }),

  closeAllFiles: (projectId) =>
    set((s) => {
      const openFiles = s.openFilesByProject[projectId] ?? []
      if (openFiles.length === 0) return {}
      return {
        openFilesByProject: {
          ...s.openFilesByProject,
          [projectId]: [],
        },
        activeFilePathByProject: {
          ...s.activeFilePathByProject,
          [projectId]: null,
        },
      }
    }),

  closeFilesToRight: (projectId, path) =>
    set((s) => {
      const openFiles = s.openFilesByProject[projectId] ?? []
      const idx = openFiles.findIndex((f) => f.path === path)
      if (idx < 0 || idx === openFiles.length - 1) return {}
      const keepFiles = openFiles.slice(0, idx + 1)
      const currentActive = s.activeFilePathByProject[projectId] ?? null
      const nextActive = keepFiles.some((f) => f.path === currentActive)
        ? currentActive
        : keepFiles[keepFiles.length - 1]?.path ?? null
      return {
        openFilesByProject: {
          ...s.openFilesByProject,
          [projectId]: keepFiles,
        },
        activeFilePathByProject: {
          ...s.activeFilePathByProject,
          [projectId]: nextActive,
        },
      }
    }),

  setActiveFile: (projectId, path) =>
    set((s) => ({
      activeFilePathByProject: {
        ...s.activeFilePathByProject,
        [projectId]: path,
      },
    })),

  updateFileContent: (projectId, path, content) =>
    set((s) => {
      const openFiles = s.openFilesByProject[projectId] ?? []
      return {
        openFilesByProject: {
          ...s.openFilesByProject,
          [projectId]: openFiles.map((f) =>
            f.path === path && f.viewKind === 'text'
              ? { ...f, content, isDirty: content !== f.savedContent }
              : f
          ),
        },
      }
    }),

  markFileSaved: (projectId, path) =>
    set((s) => {
      const openFiles = s.openFilesByProject[projectId] ?? []
      return {
        openFilesByProject: {
          ...s.openFilesByProject,
          [projectId]: openFiles.map((f) =>
            f.path === path && f.viewKind === 'text'
              ? { ...f, savedContent: f.content, isDirty: false }
              : f
          ),
        },
      }
    }),

  remapPath: (projectId, oldPath, newPath) =>
    set((s) => {
      if (!oldPath || !newPath || oldPath === newPath) return {}

      const openFiles = s.openFilesByProject[projectId] ?? []
      let openFilesChanged = false
      const nextOpenFiles = openFiles.map((file) => {
        const mappedPath = remapPathIfNeeded(file.path, oldPath, newPath)
        if (mappedPath === file.path) return file
        openFilesChanged = true
        return {
          ...file,
          path: mappedPath,
          name: mappedPath.split('/').at(-1) ?? file.name,
        }
      })

      const activeFilePath = s.activeFilePathByProject[projectId] ?? null
      const nextActiveFilePath = activeFilePath ? remapPathIfNeeded(activeFilePath, oldPath, newPath) : null
      const activeChanged = nextActiveFilePath !== activeFilePath

      const expandedDirs = s.expandedTreeDirsByProject[projectId] ?? new Set<string>()
      let expandedChanged = false
      const nextExpandedDirs = new Set<string>()
      for (const dir of expandedDirs) {
        const mapped = remapPathIfNeeded(dir, oldPath, newPath)
        if (mapped !== dir) expandedChanged = true
        nextExpandedDirs.add(mapped)
      }

      const browserSubPath = s.browserSubPathByProject[projectId]
      const nextBrowserSubPath = browserSubPath != null ? remapPathIfNeeded(browserSubPath, oldPath, newPath) : browserSubPath
      const browserChanged = nextBrowserSubPath !== browserSubPath

      const recentSelections = s.recentFileSearchSelectionsByProject[projectId] ?? []
      let recentChanged = false
      const nextRecentSelections = recentSelections.map((selection) => {
        const mapped = remapPathIfNeeded(selection.path, oldPath, newPath)
        if (mapped === selection.path) return selection
        recentChanged = true
        return {
          ...selection,
          path: mapped,
          name: mapped.split('/').at(-1) ?? selection.name,
        }
      })

      const pendingEditor = s.pendingEditorJumpIntentsByProject[projectId] ?? []
      const nextPendingEditor = remapIntentQueue(pendingEditor, oldPath, newPath)
      const pendingEditorChanged = nextPendingEditor !== pendingEditor

      const pendingTree = s.pendingTreeRevealIntentsByProject[projectId] ?? []
      const nextPendingTree = remapIntentQueue(pendingTree, oldPath, newPath)
      const pendingTreeChanged = nextPendingTree !== pendingTree

      const pendingRefresh = s.pendingFileRefreshPathsByProject[projectId] ?? []
      let pendingRefreshChanged = false
      const nextPendingRefresh = pendingRefresh.map((p) => {
        const mapped = remapPathIfNeeded(p, oldPath, newPath)
        if (mapped !== p) pendingRefreshChanged = true
        return mapped
      })

      if (
        !openFilesChanged &&
        !activeChanged &&
        !expandedChanged &&
        !browserChanged &&
        !recentChanged &&
        !pendingEditorChanged &&
        !pendingTreeChanged &&
        !pendingRefreshChanged
      ) {
        return {}
      }

      return {
        openFilesByProject: {
          ...s.openFilesByProject,
          [projectId]: nextOpenFiles,
        },
        activeFilePathByProject: {
          ...s.activeFilePathByProject,
          [projectId]: nextActiveFilePath,
        },
        expandedTreeDirsByProject: {
          ...s.expandedTreeDirsByProject,
          [projectId]: nextExpandedDirs,
        },
        browserSubPathByProject: {
          ...s.browserSubPathByProject,
          [projectId]: nextBrowserSubPath ?? '',
        },
        recentFileSearchSelectionsByProject: {
          ...s.recentFileSearchSelectionsByProject,
          [projectId]: nextRecentSelections,
        },
        pendingEditorJumpIntentsByProject: {
          ...s.pendingEditorJumpIntentsByProject,
          [projectId]: nextPendingEditor,
        },
        pendingTreeRevealIntentsByProject: {
          ...s.pendingTreeRevealIntentsByProject,
          [projectId]: nextPendingTree,
        },
        pendingFileRefreshPathsByProject: {
          ...s.pendingFileRefreshPathsByProject,
          [projectId]: nextPendingRefresh,
        },
      }
    }),

  remapPathPrefix: (projectId, oldPrefix, newPrefix) =>
    get().remapPath(projectId, oldPrefix, newPrefix),

  removePath: (projectId, targetPath) =>
    set((s) => {
      if (!targetPath) return {}
      const openFiles = s.openFilesByProject[projectId] ?? []
      const nextOpenFiles = openFiles.filter((file) => !isSameOrChildPath(file.path, targetPath))
      const openFilesChanged = nextOpenFiles.length !== openFiles.length

      const activeFilePath = s.activeFilePathByProject[projectId] ?? null
      const activeRemoved = activeFilePath ? isSameOrChildPath(activeFilePath, targetPath) : false
      const nextActiveFilePath = activeRemoved
        ? (nextOpenFiles[nextOpenFiles.length - 1]?.path ?? null)
        : activeFilePath
      const activeChanged = nextActiveFilePath !== activeFilePath

      const expandedDirs = s.expandedTreeDirsByProject[projectId] ?? new Set<string>()
      const nextExpandedDirs = new Set<string>()
      let expandedChanged = false
      for (const dir of expandedDirs) {
        if (isSameOrChildPath(dir, targetPath)) {
          expandedChanged = true
          continue
        }
        nextExpandedDirs.add(dir)
      }

      const browserSubPath = s.browserSubPathByProject[projectId] ?? ''
      let nextBrowserSubPath = browserSubPath
      if (browserSubPath && isSameOrChildPath(browserSubPath, targetPath)) {
        nextBrowserSubPath = ''
      }
      const browserChanged = nextBrowserSubPath !== browserSubPath

      const recentSelections = s.recentFileSearchSelectionsByProject[projectId] ?? []
      const nextRecentSelections = recentSelections.filter((selection) => !isSameOrChildPath(selection.path, targetPath))
      const recentChanged = nextRecentSelections.length !== recentSelections.length

      const pendingEditor = s.pendingEditorJumpIntentsByProject[projectId] ?? []
      const nextPendingEditor = pendingEditor.filter((intent) => !isSameOrChildPath(intent.payload.path, targetPath))
      const pendingEditorChanged = nextPendingEditor.length !== pendingEditor.length

      const pendingTree = s.pendingTreeRevealIntentsByProject[projectId] ?? []
      const nextPendingTree = pendingTree.filter((intent) => !isSameOrChildPath(intent.payload.path, targetPath))
      const pendingTreeChanged = nextPendingTree.length !== pendingTree.length

      const pendingRefresh = s.pendingFileRefreshPathsByProject[projectId] ?? []
      const nextPendingRefresh = pendingRefresh.filter((p) => !isSameOrChildPath(p, targetPath))
      const pendingRefreshChanged = nextPendingRefresh.length !== pendingRefresh.length

      if (
        !openFilesChanged &&
        !activeChanged &&
        !expandedChanged &&
        !browserChanged &&
        !recentChanged &&
        !pendingEditorChanged &&
        !pendingTreeChanged &&
        !pendingRefreshChanged
      ) {
        return {}
      }

      return {
        openFilesByProject: {
          ...s.openFilesByProject,
          [projectId]: nextOpenFiles,
        },
        activeFilePathByProject: {
          ...s.activeFilePathByProject,
          [projectId]: nextActiveFilePath,
        },
        expandedTreeDirsByProject: {
          ...s.expandedTreeDirsByProject,
          [projectId]: nextExpandedDirs,
        },
        browserSubPathByProject: {
          ...s.browserSubPathByProject,
          [projectId]: nextBrowserSubPath,
        },
        recentFileSearchSelectionsByProject: {
          ...s.recentFileSearchSelectionsByProject,
          [projectId]: nextRecentSelections,
        },
        pendingEditorJumpIntentsByProject: {
          ...s.pendingEditorJumpIntentsByProject,
          [projectId]: nextPendingEditor,
        },
        pendingTreeRevealIntentsByProject: {
          ...s.pendingTreeRevealIntentsByProject,
          [projectId]: nextPendingTree,
        },
        pendingFileRefreshPathsByProject: {
          ...s.pendingFileRefreshPathsByProject,
          [projectId]: nextPendingRefresh,
        },
      }
    }),

  removePathPrefix: (projectId, targetPrefix) =>
    get().removePath(projectId, targetPrefix),

  toggleTreeDir: (projectId, path) =>
    set((s) => {
      const current = s.expandedTreeDirsByProject[projectId] ?? new Set<string>()
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return {
        expandedTreeDirsByProject: {
          ...s.expandedTreeDirsByProject,
          [projectId]: next,
        },
      }
    }),

  expandTreeDirs: (projectId, paths) =>
    set((s) => {
      if (paths.length === 0) return {}
      const current = s.expandedTreeDirsByProject[projectId] ?? new Set<string>()
      const next = new Set(current)
      let changed = false
      for (const path of paths) {
        if (next.has(path)) continue
        next.add(path)
        changed = true
      }
      if (!changed) return {}
      return {
        expandedTreeDirsByProject: {
          ...s.expandedTreeDirsByProject,
          [projectId]: next,
        },
      }
    }),

  setBrowserSubPath: (projectId, subPath) =>
    set((s) => {
      const current = s.browserSubPathByProject[projectId]
      if (current === subPath) return {}
      return {
        browserSubPathByProject: {
          ...s.browserSubPathByProject,
          [projectId]: subPath,
        },
      }
    }),

  clearBrowserSubPath: (projectId) =>
    set((s) => {
      if (!(projectId in s.browserSubPathByProject)) return {}
      const { [projectId]: _dropped, ...rest } = s.browserSubPathByProject
      return { browserSubPathByProject: rest }
    }),

  bumpFileStructureVersion: (projectId) =>
    set((s) => {
      const current = s.fileStructureVersionByProject[projectId] ?? 0
      return {
        fileStructureVersionByProject: {
          ...s.fileStructureVersionByProject,
          [projectId]: current + 1,
        },
      }
    }),

  setFileSearchQuery: (projectId, query) =>
    set((s) => {
      const current = s.fileSearchQueryByProject[projectId] ?? ''
      if (current === query) return {}
      return {
        fileSearchQueryByProject: {
          ...s.fileSearchQueryByProject,
          [projectId]: query,
        },
      }
    }),

  recordFileSearchSelection: (projectId, selection) =>
    set((s) => {
      const prev = s.recentFileSearchSelectionsByProject[projectId] ?? []
      const nextSelection: FileSearchRecentSelection = {
        path: selection.path,
        name: selection.name,
        kind: selection.kind,
        selectedAt: Date.now(),
      }
      const next = [nextSelection, ...prev.filter((item) => item.path !== selection.path)]
        .slice(0, MAX_RECENT_FILE_SEARCH_PATHS)
      if (
        prev.length === next.length &&
        prev.every((value, idx) =>
          value.path === next[idx].path &&
          value.name === next[idx].name &&
          value.kind === next[idx].kind,
        )
      ) {
        return {}
      }
      return {
        recentFileSearchSelectionsByProject: {
          ...s.recentFileSearchSelectionsByProject,
          [projectId]: next,
        },
      }
    }),

  enqueueEditorJumpIntent: (projectId, jump) => {
    const id = createIntentId()
    set((s) => {
      const prev = s.pendingEditorJumpIntentsByProject[projectId] ?? []
      const next: PendingIntent<PendingEditorJump>[] = [
        ...prev,
        { id, payload: jump, createdAt: Date.now() },
      ]
      return {
        pendingEditorJumpIntentsByProject: {
          ...s.pendingEditorJumpIntentsByProject,
          [projectId]: next,
        },
      }
    })
    return id
  },

  peekEditorJumpIntent: (projectId) => {
    const intents = get().pendingEditorJumpIntentsByProject[projectId]
    return intents?.[0] ?? null
  },

  ackEditorJumpIntent: (projectId, intentId) =>
    set((s) => {
      const prev = s.pendingEditorJumpIntentsByProject[projectId] ?? []
      if (prev.length === 0) return {}
      const next = prev.filter((intent) => intent.id !== intentId)
      if (next.length === prev.length) return {}
      return {
        pendingEditorJumpIntentsByProject: {
          ...s.pendingEditorJumpIntentsByProject,
          [projectId]: next,
        },
      }
    }),

  enqueueTreeRevealIntent: (projectId, reveal) => {
    const id = createIntentId()
    set((s) => {
      const prev = s.pendingTreeRevealIntentsByProject[projectId] ?? []
      const next: PendingIntent<PendingTreeReveal>[] = [
        ...prev,
        { id, payload: reveal, createdAt: Date.now() },
      ]
      return {
        pendingTreeRevealIntentsByProject: {
          ...s.pendingTreeRevealIntentsByProject,
          [projectId]: next,
        },
      }
    })
    return id
  },

  peekTreeRevealIntent: (projectId) => {
    const intents = get().pendingTreeRevealIntentsByProject[projectId]
    return intents?.[0] ?? null
  },

  ackTreeRevealIntent: (projectId, intentId) =>
    set((s) => {
      const prev = s.pendingTreeRevealIntentsByProject[projectId] ?? []
      if (prev.length === 0) return {}
      const next = prev.filter((intent) => intent.id !== intentId)
      if (next.length === prev.length) return {}
      return {
        pendingTreeRevealIntentsByProject: {
          ...s.pendingTreeRevealIntentsByProject,
          [projectId]: next,
        },
      }
    }),

  pushDeleteUndo: (projectId, entry) =>
    set((s) => {
      if (!entry.undoToken.trim() || !entry.path.trim()) return {}
      const prev = s.pendingDeleteUndosByProject[projectId] ?? []
      const deduped = prev.filter((item) => item.undoToken !== entry.undoToken)
      const nextWithNew: PendingDeleteUndo[] = [
        ...deduped,
        {
          undoToken: entry.undoToken,
          path: entry.path,
          createdAt: Date.now(),
        },
      ]
      const next = nextWithNew.length > MAX_PENDING_DELETE_UNDOS
        ? nextWithNew.slice(nextWithNew.length - MAX_PENDING_DELETE_UNDOS)
        : nextWithNew
      return {
        pendingDeleteUndosByProject: {
          ...s.pendingDeleteUndosByProject,
          [projectId]: next,
        },
      }
    }),

  peekLatestDeleteUndo: (projectId) => {
    const stack = get().pendingDeleteUndosByProject[projectId] ?? []
    return stack[stack.length - 1] ?? null
  },

  popLatestDeleteUndo: (projectId) => {
    let popped: PendingDeleteUndo | null = null
    set((s) => {
      const prev = s.pendingDeleteUndosByProject[projectId] ?? []
      if (prev.length === 0) return {}
      popped = prev[prev.length - 1]
      return {
        pendingDeleteUndosByProject: {
          ...s.pendingDeleteUndosByProject,
          [projectId]: prev.slice(0, -1),
        },
      }
    })
    return popped
  },

  removeDeleteUndo: (projectId, undoToken) =>
    set((s) => {
      const prev = s.pendingDeleteUndosByProject[projectId] ?? []
      if (prev.length === 0) return {}
      const next = prev.filter((item) => item.undoToken !== undoToken)
      if (next.length === prev.length) return {}
      return {
        pendingDeleteUndosByProject: {
          ...s.pendingDeleteUndosByProject,
          [projectId]: next,
        },
      }
    }),

  // ── File refresh actions ──────────────────────────────────────

  refreshFile: (projectId, { path, content, language }) =>
    set((s) => {
      const openFiles = s.openFilesByProject[projectId] ?? []
      const file = openFiles.find((f) => f.path === path)
      if (!file) return {}
      if (file.viewKind !== 'text') return {}
      if (file.isDirty) return {}            // Has unsaved edits → don't overwrite
      if (file.content === content) return {} // Same content → no-op

      return {
        openFilesByProject: {
          ...s.openFilesByProject,
          [projectId]: openFiles.map((f) =>
            f.path === path
              ? { ...f, content, savedContent: content, language, isDirty: false, viewKind: 'text', imageDataUrl: null }
              : f
          ),
        },
      }
    }),

  refreshOpenFiles: async (projectId, projectPath) => {
    const openFiles = get().openFilesByProject[projectId] ?? []
    const filesToRefresh = openFiles.filter((f) => !f.isDirty && f.viewKind === 'text')
    if (filesToRefresh.length === 0) return

    const results = await Promise.allSettled(
      filesToRefresh.map(async (f) => {
        const rawResult = await getAppAPI()['read-file-content'](projectPath, f.path)
        const result = normalizeFileContentReadResult(rawResult)
        if (!result.ok) return null
        return { path: f.path, content: result.data.content, language: result.data.language }
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        get().refreshFile(projectId, result.value)
      }
    }
  },

  // ── tool_use → tool_result file write correlation ─────────────

  trackPendingFileWrite: (toolUseId, filePath, projectId = null) =>
    set((s) => ({
      pendingFileWritesByToolId: {
        ...s.pendingFileWritesByToolId,
        [toolUseId]: { path: filePath, projectId },
      },
    })),

  resolvePendingFileWrite: (toolUseId) => {
    // Atomic read-and-delete: single set() updater avoids TOCTOU race
    // between separate get() and set() calls.
    let resolved: { path: string; projectId: string | null } | null = null
    set((s) => {
      const p = s.pendingFileWritesByToolId[toolUseId]
      if (!p) return {}
      resolved = p
      const { [toolUseId]: _, ...rest } = s.pendingFileWritesByToolId
      return { pendingFileWritesByToolId: rest }
    })
    return resolved
  },

  // ── Pending file refresh paths ────────────────────────────────

  markFileNeedsRefresh: (projectId, path) =>
    set((s) => {
      const current = s.pendingFileRefreshPathsByProject[projectId] ?? []
      return {
        pendingFileRefreshPathsByProject: {
          ...s.pendingFileRefreshPathsByProject,
          [projectId]: current.includes(path) ? current : [...current, path],
        },
      }
    }),

  markAllOpenFilesNeedRefresh: (projectId) =>
    set((s) => {
      const current = s.pendingFileRefreshPathsByProject[projectId] ?? []
      const openFiles = s.openFilesByProject[projectId] ?? []
      return {
        pendingFileRefreshPathsByProject: {
          ...s.pendingFileRefreshPathsByProject,
          [projectId]: [
            ...new Set([
              ...current,
              ...openFiles.filter((f) => !f.isDirty && f.viewKind === 'text').map((f) => f.path),
            ]),
          ],
        },
      }
    }),

  clearPendingFileRefresh: (projectId) =>
    set((s) => ({
      pendingFileRefreshPathsByProject: {
        ...s.pendingFileRefreshPathsByProject,
        [projectId]: [],
      },
    })),

  consumePendingFileRefresh: (projectId) => {
    // Atomic swap: read current paths and clear in a single set() call.
    // Paths arriving AFTER this call won't be lost — they'll be written
    // to a fresh empty array and consumed by the next effect cycle.
    let consumed: string[] = []
    set((s) => {
      const current = s.pendingFileRefreshPathsByProject[projectId] ?? []
      if (current.length === 0) return {}
      consumed = current
      return {
        pendingFileRefreshPathsByProject: {
          ...s.pendingFileRefreshPathsByProject,
          [projectId]: [],
        },
      }
    })
    return consumed
  },

  reset: () => set(initialState),
}))
