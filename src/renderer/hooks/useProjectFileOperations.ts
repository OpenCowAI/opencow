// SPDX-License-Identifier: Apache-2.0

import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileStore } from '@/stores/fileStore'
import { getAppAPI } from '@/windowAPI'
import { toast } from '@/lib/toast'

interface UseProjectFileOperationsOptions {
  projectId: string
  projectPath: string
}

interface RenameProjectPathInput {
  targetPath: string
  nextName: string
  onRenamed?: (payload: { oldPath: string; newPath: string }) => void
}

interface CreateProjectPathInput {
  kind: 'file' | 'folder'
  parentPath: string
  name: string
  onCreated?: (payload: { path: string }) => void
}

interface DeleteProjectPathInput {
  targetPath: string
  onDeleted?: (payload: { path: string }) => void
  onRestored?: (payload: { path: string }) => void
}

interface UndoLatestDeleteInput {
  onRestored?: (payload: { path: string }) => void
}

function parentDirectoryOf(path: string): string {
  const slashIndex = path.lastIndexOf('/')
  return slashIndex >= 0 ? path.slice(0, slashIndex) : ''
}

function trimName(name: string): string {
  return typeof name === 'string' ? name.trim() : ''
}

export function resolveCreateParentPath(input: { path: string; isDirectory: boolean }): string {
  if (input.isDirectory) return input.path
  return parentDirectoryOf(input.path)
}

export function useProjectFileOperations({
  projectId,
  projectPath,
}: UseProjectFileOperationsOptions) {
  const { t } = useTranslation('files')
  const remapPath = useFileStore((s) => s.remapPath)
  const removePath = useFileStore((s) => s.removePath)
  const pushDeleteUndo = useFileStore((s) => s.pushDeleteUndo)
  const peekLatestDeleteUndo = useFileStore((s) => s.peekLatestDeleteUndo)
  const removeDeleteUndo = useFileStore((s) => s.removeDeleteUndo)
  const bumpFileStructureVersion = useFileStore((s) => s.bumpFileStructureVersion)
  const restoringUndoTokensRef = useRef<Set<string>>(new Set())

  const restoreByUndoToken = useCallback(async (
    undoToken: string,
    options?: { onRestored?: (payload: { path: string }) => void },
  ): Promise<boolean> => {
    if (!undoToken.trim()) return false
    if (restoringUndoTokensRef.current.has(undoToken)) return false
    restoringUndoTokensRef.current.add(undoToken)
    try {
      const restoreResult = await getAppAPI()['project-file:restore-delete'](projectPath, undoToken)
      if (!restoreResult.ok) {
        if (restoreResult.error.code === 'not_found') {
          removeDeleteUndo(projectId, undoToken)
        }
        toast(restoreResult.error.message || t('actions.undoDeleteFailed'))
        return false
      }

      removeDeleteUndo(projectId, undoToken)
      bumpFileStructureVersion(projectId)
      options?.onRestored?.({ path: restoreResult.data.restoredPath })
      toast(t('actions.undoDeleteSuccess'))
      return true
    } finally {
      restoringUndoTokensRef.current.delete(undoToken)
    }
  }, [bumpFileStructureVersion, projectId, projectPath, removeDeleteUndo, t])

  const renameProjectPath = useCallback(async ({
    targetPath,
    nextName,
    onRenamed,
  }: RenameProjectPathInput): Promise<boolean> => {
    const trimmedName = trimName(nextName)
    if (!trimmedName) {
      toast(t('actions.renameInvalidName'))
      return false
    }

    const parentPath = parentDirectoryOf(targetPath)
    const nextPath = parentPath ? `${parentPath}/${trimmedName}` : trimmedName
    if (nextPath === targetPath) {
      return true
    }
    const renameResult = await getAppAPI()['project-file:rename'](projectPath, targetPath, nextPath)
    if (!renameResult.ok) {
      toast(renameResult.error.message || t('actions.renameFailed'))
      return false
    }

    remapPath(projectId, targetPath, nextPath)
    bumpFileStructureVersion(projectId)
    onRenamed?.({ oldPath: targetPath, newPath: nextPath })
    toast(t('actions.renameSuccess'))
    return true
  }, [bumpFileStructureVersion, projectId, projectPath, remapPath, t])

  const createProjectPath = useCallback(async ({
    kind,
    parentPath,
    name,
    onCreated,
  }: CreateProjectPathInput): Promise<boolean> => {
    const trimmedName = trimName(name)
    if (!trimmedName) {
      toast(t('actions.createInvalidName'))
      return false
    }

    const targetPath = parentPath ? `${parentPath}/${trimmedName}` : trimmedName
    const createResult = kind === 'file'
      ? await getAppAPI()['project-file:create'](projectPath, targetPath)
      : await getAppAPI()['project-file:create-directory'](projectPath, targetPath)
    if (!createResult.ok) {
      toast(createResult.error.message || t('actions.createFailed'))
      return false
    }

    bumpFileStructureVersion(projectId)
    onCreated?.({ path: createResult.data.path })
    toast(kind === 'file' ? t('actions.createFileSuccess') : t('actions.createFolderSuccess'))
    return true
  }, [bumpFileStructureVersion, projectId, projectPath, t])

  const deleteProjectPath = useCallback(async ({
    targetPath,
    onDeleted,
    onRestored,
  }: DeleteProjectPathInput): Promise<boolean> => {
    const deleteResult = await getAppAPI()['project-file:delete'](projectPath, targetPath)
    if (!deleteResult.ok) {
      toast(deleteResult.error.message || t('actions.deleteFailed'))
      return false
    }

    removePath(projectId, targetPath)
    pushDeleteUndo(projectId, {
      undoToken: deleteResult.data.undoToken,
      path: targetPath,
    })
    bumpFileStructureVersion(projectId)
    onDeleted?.({ path: targetPath })

    toast(t('actions.deleteSuccess'), {
      action: {
        label: t('actions.undoDelete'),
        onClick: () => {
          void restoreByUndoToken(deleteResult.data.undoToken, { onRestored })
        },
      },
      duration: 8000,
    })
    return true
  }, [bumpFileStructureVersion, projectId, projectPath, pushDeleteUndo, removePath, restoreByUndoToken, t])

  const undoLatestDelete = useCallback(async ({
    onRestored,
  }: UndoLatestDeleteInput = {}): Promise<boolean> => {
    const latestUndo = peekLatestDeleteUndo(projectId)
    if (!latestUndo) return false
    return restoreByUndoToken(latestUndo.undoToken, { onRestored })
  }, [peekLatestDeleteUndo, projectId, restoreByUndoToken])

  return {
    renameProjectPath,
    createProjectPath,
    deleteProjectPath,
    undoLatestDelete,
  }
}
