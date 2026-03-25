// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback } from 'react'
import { useAppStore } from '@/stores/appStore'
import { toast } from '@/lib/toast'

// ─── Public API ──────────────────────────────────────────────────────────────

export interface UseRenameProjectReturn {
  /** The project ID currently being renamed (null when idle). */
  renamingProjectId: string | null
  /** Enter inline-edit mode for the given project. */
  startRename: (projectId: string) => void
  /** Commit the rename. Returns true on success, false on error. */
  confirmRename: (newName: string) => Promise<boolean>
  /** Exit inline-edit mode without committing. */
  cancelRename: () => void
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Encapsulates the project rename interaction sequence:
 * inline-edit activation → IPC call → state sync → toast feedback.
 *
 * Follows the same SRP pattern as `useDeleteProject`: the hook owns
 * business logic; the UI component owns display.
 */
export function useRenameProject(): UseRenameProjectReturn {
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const renameProject = useAppStore((s) => s.renameProject)

  const startRename = useCallback((projectId: string) => {
    setRenamingProjectId(projectId)
  }, [])

  const confirmRename = useCallback(async (newName: string): Promise<boolean> => {
    if (!renamingProjectId) return false

    const trimmed = newName.trim()
    if (!trimmed) {
      setRenamingProjectId(null)
      return false
    }

    try {
      await renameProject(renamingProjectId, trimmed)
      setRenamingProjectId(null)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast(`Rename failed: ${message}`)
      return false
    }
  }, [renamingProjectId, renameProject])

  const cancelRename = useCallback(() => {
    setRenamingProjectId(null)
  }, [])

  return {
    renamingProjectId,
    startRename,
    confirmRename,
    cancelRename,
  }
}
