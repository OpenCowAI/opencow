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

  getOpenFiles: (projectId: string) => OpenFile[]
  getActiveFilePath: (projectId: string) => string | null
  openFile: (projectId: string, params: OpenFileParams) => void
  closeFile: (projectId: string, path: string) => void
  setActiveFile: (projectId: string, path: string) => void
  updateFileContent: (projectId: string, path: string, content: string) => void
  markFileSaved: (projectId: string, path: string) => void
  toggleTreeDir: (projectId: string, path: string) => void
  expandTreeDirs: (projectId: string, paths: string[]) => void
  setBrowserSubPath: (projectId: string, subPath: string) => void
  clearBrowserSubPath: (projectId: string) => void
  setFileSearchQuery: (projectId: string, query: string) => void
  recordFileSearchSelection: (projectId: string, selection: { path: string; name: string; kind: FileSearchRecentKind }) => void
  enqueueEditorJumpIntent: (projectId: string, jump: PendingEditorJump) => string
  peekEditorJumpIntent: (projectId: string) => PendingIntent<PendingEditorJump> | null
  ackEditorJumpIntent: (projectId: string, intentId: string) => void
  enqueueTreeRevealIntent: (projectId: string, reveal: PendingTreeReveal) => string
  peekTreeRevealIntent: (projectId: string) => PendingIntent<PendingTreeReveal> | null
  ackTreeRevealIntent: (projectId: string, intentId: string) => void

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
  fileSearchQueryByProject: {} as Record<string, string>,
  recentFileSearchSelectionsByProject: {} as Record<string, FileSearchRecentSelection[]>,
  pendingEditorJumpIntentsByProject: {} as Record<string, PendingIntent<PendingEditorJump>[]>,
  pendingTreeRevealIntentsByProject: {} as Record<string, PendingIntent<PendingTreeReveal>[]>,
  pendingFileWritesByToolId: {} as Record<string, { path: string; projectId: string | null }>,
  pendingFileRefreshPathsByProject: {} as Record<string, string[]>,
}

const MAX_RECENT_FILE_SEARCH_PATHS = 20

function createIntentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
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
