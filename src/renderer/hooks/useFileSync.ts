// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react'
import { useFileStore } from '@/stores/fileStore'
import { getAppAPI } from '@/windowAPI'
import { normalizeFileContentReadResult } from '@/lib/fileContentReadResult'

// ════════════════════════════════════════════════════════════════════
// useFileSync — Coordinates file content synchronisation between disk
// and the editor store.
//
// Responsibility boundaries:
//   useAppBootstrap → detects change events → writes pendingFileRefreshPaths
//   useFileSync  → consumes store → IPC reads → calls refreshFile
//   EditorPane   → pure rendering (value prop auto-syncs via library)
//
// Trigger sources:
//   1. pendingFileRefreshPaths — Agent tool_result / session idle
//   2. window 'focus' event — user returns from external editor
//   3. Component mount — view mode switch or project switch
// ════════════════════════════════════════════════════════════════════

/**
 * Coordinates file content sync. Place in FilesView — NOT in EditorPane.
 *
 * @param projectId    Current project ID; no-ops when undefined.
 * @param projectPath  Current project path; no-ops when undefined.
 */
const EMPTY_PENDING_REFRESH_PATHS: readonly string[] = []
const EMPTY_OPEN_FILES: readonly { path: string; isDirty: boolean; viewKind: 'text' | 'image' }[] = []

export function useFileSync(projectId: string | undefined, projectPath: string | undefined): void {
  const refreshOpenFiles = useFileStore((s) => s.refreshOpenFiles)
  const refreshFile = useFileStore((s) => s.refreshFile)
  const pendingRefreshPaths = useFileStore((s) =>
    projectId
      ? (s.pendingFileRefreshPathsByProject[projectId] ?? EMPTY_PENDING_REFRESH_PATHS)
      : EMPTY_PENDING_REFRESH_PATHS
  )
  const consumePendingRefresh = useFileStore((s) => s.consumePendingFileRefresh)

  // Track whether the mount effect has fired to avoid duplicate IPC
  // reads when both mount and pending effects trigger on first render.
  const mountedRef = useRef(false)

  // ── Consume pendingRefreshPaths (Agent tool_result / session idle) ──
  //
  // Design notes:
  //   - `openFiles` is NOT in the deps array. Reading it via
  //     useFileStore.getState() inside the callback avoids re-triggering
  //     this effect on every keystroke (updateFileContent creates a new
  //     openFiles reference).
  //   - `consumePendingRefresh()` is an atomic swap: it returns the
  //     current paths and clears the queue in a single set() call,
  //     so paths arriving during IPC won't be lost.
  //   - On first mount, skip if mountedRef is false — the mount effect
  //     (below) already does a full refreshOpenFiles that covers these.

  useEffect(() => {
    if (!projectId || !projectPath || pendingRefreshPaths.length === 0) return

    // On first mount, the mount effect (below) already triggers
    // refreshOpenFiles for ALL open files. Avoid duplicate IPC reads.
    if (!mountedRef.current) return

    // Atomic swap — paths arriving after this call won't be lost
    const paths = consumePendingRefresh(projectId)
    if (paths.length === 0) return

    // Read openFiles at call time (not from deps) to avoid keystroke churn
    const currentOpenFiles = useFileStore.getState().openFilesByProject[projectId] ?? EMPTY_OPEN_FILES
    const toRefresh = paths.filter((p) =>
      currentOpenFiles.some((f) => f.path === p && !f.isDirty && f.viewKind === 'text')
    )
    if (toRefresh.length === 0) return

    Promise.allSettled(
      toRefresh.map(async (p) => {
        const rawResult = await getAppAPI()['read-file-content'](projectPath, p)
        const result = normalizeFileContentReadResult(rawResult)
        if (!result.ok) return
        refreshFile(projectId, { path: p, content: result.data.content, language: result.data.language })
      })
    )
  }, [consumePendingRefresh, pendingRefreshPaths, projectId, projectPath, refreshFile])

  // ── Window focus (user returns from external editor) ──

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!projectId || !projectPath) return

    const handleFocus = (): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        refreshOpenFiles(projectId, projectPath)
      }, 300)
    }

    window.addEventListener('focus', handleFocus)
    return () => {
      window.removeEventListener('focus', handleFocus)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [projectId, projectPath, refreshOpenFiles])

  // ── Mount refresh (view mode switch / project switch) ──
  //
  // Also clears any pending paths accumulated before mount — the full
  // refreshOpenFiles covers them, avoiding duplicate IPC reads.

  useEffect(() => {
    if (projectId && projectPath) {
      // Clear accumulated pending paths — this full refresh covers them
      consumePendingRefresh(projectId)
      refreshOpenFiles(projectId, projectPath)
    }
    mountedRef.current = true
  }, [consumePendingRefresh, projectId, projectPath, refreshOpenFiles])
}
