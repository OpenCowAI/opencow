// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { APP_NAME } from '@shared/appIdentity'
import type { Project } from '@shared/types'

// ─── Props ───────────────────────────────────────────────────────────────────

interface DeleteProjectDialogProps {
  /** Project awaiting deletion. Null when no deletion is pending. */
  project: Project | null
  /** Whether the dialog should be visible (drives ConfirmDialog animation). */
  open: boolean
  /** Called after the user clicks the destructive confirm button. */
  onConfirm: () => Promise<void>
  /** Called when the user cancels or dismisses the dialog. */
  onCancel: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Project-deletion confirmation dialog.
 *
 * Rendered via Portal to document.body so the modal sits at the top of the
 * stacking context regardless of where in the component tree it is mounted.
 * This mirrors the pattern used by Toaster — the dialog is logically a child
 * of Sidebar (for prop/state flow) but physically lives outside it in the DOM.
 *
 * All business logic (IPC call, toast, state cleanup) lives in `useDeleteProject`.
 */
export function DeleteProjectDialog({
  project,
  open,
  onConfirm,
  onCancel,
}: DeleteProjectDialogProps): React.JSX.Element | null {
  const { t } = useTranslation('navigation')
  if (!project) return null

  return createPortal(
    <ConfirmDialog
      open={open}
      title={t('projectActions.removeProject')}
      message={t('projectActions.removeConfirmMessage', { projectName: project.name, appName: APP_NAME })}
      detail={t('projectActions.removeConfirmDetail')}
      confirmLabel={t('projectActions.remove')}
      cancelLabel={t('cancel', { ns: 'common' })}
      variant="destructive"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
    document.body,
  )
}
