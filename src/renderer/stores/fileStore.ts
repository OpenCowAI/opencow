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

// ─── Store Interface ──────────────────────────────────────────────────

export interface FileStore {
  openFiles: OpenFile[]
  activeFilePath: string | null
  expandedDirs: Set<string>
  /** Per-project current directory for FileBrowser mode (relative path, '' = root). */
  browserSubPathByProject: Record<string, string>

  openFile: (params: OpenFileParams) => void
  closeFile: (path: string) => void
  setActiveFile: (path: string) => void
  updateFileContent: (path: string, content: string) => void
  markFileSaved: (path: string) => void
  toggleDir: (path: string) => void
  setBrowserSubPath: (projectId: string, subPath: string) => void
  clearBrowserSubPath: (projectId: string) => void

  /** Refresh an open file's content from disk. Skips isDirty files and no-ops on same content. */
  refreshFile: (params: RefreshFileParams) => void
  /** Batch-refresh all open non-dirty files by reading from disk. */
  refreshOpenFiles: (projectPath: string) => Promise<void>

  /** tool_use → tool_result correlation: maps toolUseId to filePath for file-modifying tools. */
  pendingFileWritesByToolId: Record<string, string>
  trackPendingFileWrite: (toolUseId: string, filePath: string) => void
  resolvePendingFileWrite: (toolUseId: string) => string | null

  /** File paths needing refresh (written by useAppBootstrap, consumed by useFileSync). */
  pendingFileRefreshPaths: string[]
  markFileNeedsRefresh: (path: string) => void
  markAllOpenFilesNeedRefresh: () => void
  clearPendingFileRefresh: () => void
  /** Atomic swap: returns current pending paths and clears the queue in one set(). */
  consumePendingFileRefresh: () => string[]

  reset: () => void
}

// ─── Initial State ────────────────────────────────────────────────────

const initialState = {
  openFiles: [] as OpenFile[],
  activeFilePath: null as string | null,
  expandedDirs: new Set<string>(),
  browserSubPathByProject: {} as Record<string, string>,
  pendingFileWritesByToolId: {} as Record<string, string>,
  pendingFileRefreshPaths: [] as string[],
}

// ─── Store Instance ───────────────────────────────────────────────────

export const useFileStore = create<FileStore>((set, get) => ({
  ...initialState,

  // ── Core file operations ──────────────────────────────────────

  openFile: ({ path, name, language, content, viewKind = 'text', imageDataUrl = null }) =>
    set((s) => {
      const normalizedImageDataUrl = viewKind === 'image' ? imageDataUrl : null
      const existing = s.openFiles.find((f) => f.path === path)
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
          return { activeFilePath: path }
        }
        return {
          openFiles: s.openFiles.map((f) =>
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
          activeFilePath: path
        }
      }
      return {
        openFiles: [
          ...s.openFiles,
          {
            path,
            name,
            language,
            content,
            savedContent: content,
            isDirty: false,
            viewKind,
            imageDataUrl: normalizedImageDataUrl,
          }
        ],
        activeFilePath: path
      }
    }),

  closeFile: (path) =>
    set((s) => {
      const idx = s.openFiles.findIndex((f) => f.path === path)
      const newFiles = s.openFiles.filter((f) => f.path !== path)
      let newActive = s.activeFilePath
      if (s.activeFilePath === path) {
        if (newFiles.length === 0) {
          newActive = null
        } else {
          const nextIdx = Math.min(idx, newFiles.length - 1)
          newActive = newFiles[nextIdx].path
        }
      }
      return { openFiles: newFiles, activeFilePath: newActive }
    }),

  setActiveFile: (path) => set({ activeFilePath: path }),

  updateFileContent: (path, content) =>
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path && f.viewKind === 'text'
          ? { ...f, content, isDirty: content !== f.savedContent }
          : f
      )
    })),

  markFileSaved: (path) =>
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path && f.viewKind === 'text'
          ? { ...f, savedContent: f.content, isDirty: false }
          : f
      )
    })),

  toggleDir: (path) =>
    set((s) => {
      const next = new Set(s.expandedDirs)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return { expandedDirs: next }
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

  // ── File refresh actions ──────────────────────────────────────

  refreshFile: ({ path, content, language }) =>
    set((s) => {
      const file = s.openFiles.find((f) => f.path === path)
      if (!file) return {}
      if (file.viewKind !== 'text') return {}
      if (file.isDirty) return {}            // Has unsaved edits → don't overwrite
      if (file.content === content) return {} // Same content → no-op

      return {
        openFiles: s.openFiles.map((f) =>
          f.path === path
            ? { ...f, content, savedContent: content, language, isDirty: false, viewKind: 'text', imageDataUrl: null }
            : f
        )
      }
    }),

  refreshOpenFiles: async (projectPath) => {
    const { openFiles } = get()
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
        get().refreshFile(result.value)
      }
    }
  },

  // ── tool_use → tool_result file write correlation ─────────────

  trackPendingFileWrite: (toolUseId, filePath) =>
    set((s) => ({
      pendingFileWritesByToolId: { ...s.pendingFileWritesByToolId, [toolUseId]: filePath }
    })),

  resolvePendingFileWrite: (toolUseId) => {
    // Atomic read-and-delete: single set() updater avoids TOCTOU race
    // between separate get() and set() calls.
    let filePath: string | null = null
    set((s) => {
      const p = s.pendingFileWritesByToolId[toolUseId]
      if (!p) return {}
      filePath = p
      const { [toolUseId]: _, ...rest } = s.pendingFileWritesByToolId
      return { pendingFileWritesByToolId: rest }
    })
    return filePath
  },

  // ── Pending file refresh paths ────────────────────────────────

  markFileNeedsRefresh: (path) =>
    set((s) => ({
      pendingFileRefreshPaths: s.pendingFileRefreshPaths.includes(path)
        ? s.pendingFileRefreshPaths
        : [...s.pendingFileRefreshPaths, path]
    })),

  markAllOpenFilesNeedRefresh: () =>
    set((s) => ({
      pendingFileRefreshPaths: [
        ...new Set([
          ...s.pendingFileRefreshPaths,
          ...s.openFiles.filter((f) => !f.isDirty && f.viewKind === 'text').map((f) => f.path)
        ])
      ]
    })),

  clearPendingFileRefresh: () =>
    set({ pendingFileRefreshPaths: [] }),

  consumePendingFileRefresh: () => {
    // Atomic swap: read current paths and clear in a single set() call.
    // Paths arriving AFTER this call won't be lost — they'll be written
    // to a fresh empty array and consumed by the next effect cycle.
    let consumed: string[] = []
    set((s) => {
      if (s.pendingFileRefreshPaths.length === 0) return {}
      consumed = s.pendingFileRefreshPaths
      return { pendingFileRefreshPaths: [] }
    })
    return consumed
  },

  reset: () => set(initialState),
}))
