// SPDX-License-Identifier: Apache-2.0

import { useCallback } from 'react'
import { useAppStore } from '@/stores/appStore'
import { toast } from '@/lib/toast'
import { useDialogState } from '@/hooks/useModalAnimation'
import type { Project } from '@shared/types'

// ─── Public API ──────────────────────────────────────────────────────────────

export interface UseDeleteProjectReturn {
  /** The project awaiting deletion confirmation (persists during exit animation). */
  pendingProject: Project | null
  /** Whether the confirmation dialog should be visible (drives `open` prop). */
  dialogOpen: boolean
  /** Open the confirmation dialog for the given project. */
  requestDelete: (project: Project) => void
  /** Execute the deletion after user confirmation. Handles errors with toast feedback. */
  confirmDelete: () => Promise<void>
  /** Dismiss the confirmation dialog without deleting. */
  cancelDelete: () => void
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Encapsulates the full project-deletion interaction sequence:
 * confirmation state → IPC call → state cleanup → toast feedback.
 *
 * Uses `useDialogState` internally so the confirmation dialog receives a
 * proper `open` toggle (enabling exit animation) rather than being
 * conditionally unmounted.
 */
export function useDeleteProject(): UseDeleteProjectReturn {
  const dialog = useDialogState<Project>()
  const deleteProject = useAppStore((s) => s.deleteProject)

  const confirmDelete = useCallback(async () => {
    if (!dialog.data) return
    const { id, name } = dialog.data

    try {
      const success = await deleteProject(id)
      if (success) {
        // Close the dialog only on confirmed success
        dialog.close()
        toast(`"${name}" removed`)
      } else {
        // IPC returned false (e.g. project not found) — keep dialog open so
        // the user knows something went wrong and can retry or cancel manually.
        toast(`Failed to remove "${name}"`)
      }
    } catch (err) {
      // IPC / DB exception — keep dialog open so the user can retry.
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast(`Error removing "${name}": ${message}`)
    }
  }, [dialog.data, dialog.close, deleteProject])

  return {
    pendingProject: dialog.data,
    dialogOpen: dialog.open,
    requestDelete: dialog.show,
    confirmDelete,
    cancelDelete: dialog.close,
  }
}
