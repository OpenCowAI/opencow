// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileAccessSuccess } from '@shared/fileAccess'
import type {
  ProjectFileCreateDirectoryResult,
  ProjectFileCreateResult,
  ProjectFileDeleteResult,
  ProjectFileRestoreDeleteResult,
  ProjectFileRenameResult,
} from '@shared/types'
import { isPathWithinBase } from '../../security/pathBounds'
import { asFileAccessFailure, FileAccessServiceError } from './fileAccessError'
import { FileAccessPolicyService } from './fileAccessPolicyService'

const PROJECT_TRASH_DIRNAME = '.opencow-trash'
const MAX_PENDING_DELETE_UNDOS = 500

interface PendingDeleteUndo {
  projectBase: string
  trashPath: string
  originalPath: string
}

function requireNonEmpty(value: string, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    throw new FileAccessServiceError('invalid_input', `Invalid ${fieldName}`)
  }
  return normalized
}

function normalizeRelativePathInput(value: string, fieldName: string): string {
  const normalized = requireNonEmpty(value, fieldName)
  if (path.isAbsolute(normalized)) {
    throw new FileAccessServiceError('invalid_input', `${fieldName} must be relative`)
  }
  if (normalized === '.' || normalized === '..') {
    throw new FileAccessServiceError('invalid_input', `Invalid ${fieldName}`)
  }
  return normalized
}

function validateLeafName(relativePath: string, fieldName: string): void {
  const base = path.basename(relativePath).trim()
  if (!base || base === '.' || base === '..') {
    throw new FileAccessServiceError('invalid_name', `Invalid ${fieldName}`)
  }
  if (base.includes('/') || base.includes('\\')) {
    throw new FileAccessServiceError('invalid_name', `Invalid ${fieldName}`)
  }
}

function splitPathSegments(value: string): string[] {
  return value.split(/[\\/]+/).filter(Boolean)
}

function isInternalTrashPath(relativePath: string): boolean {
  return splitPathSegments(relativePath).includes(PROJECT_TRASH_DIRNAME)
}

function toRelativeProjectPath(projectBase: string, absolutePath: string): string {
  return path.relative(projectBase, absolutePath).split(path.sep).join('/')
}

export class ProjectFileOperationService {
  private readonly pendingDeleteUndos = new Map<string, PendingDeleteUndo>()

  constructor(
    private readonly policy = new FileAccessPolicyService(),
  ) {}

  private rememberPendingDeleteUndo(token: string, payload: PendingDeleteUndo): void {
    this.pendingDeleteUndos.set(token, payload)
    if (this.pendingDeleteUndos.size <= MAX_PENDING_DELETE_UNDOS) return
    const oldestToken = this.pendingDeleteUndos.keys().next().value
    if (typeof oldestToken === 'string') {
      this.pendingDeleteUndos.delete(oldestToken)
    }
  }

  private async assertPathWithinProjectBaseAllowMissing(
    resolvedPath: string,
    resolvedBase: string,
  ): Promise<void> {
    if (!isPathWithinBase(resolvedPath, resolvedBase)) {
      throw new FileAccessServiceError('access_denied', 'Access denied: path outside project directory')
    }

    const realBase = await fs.realpath(resolvedBase)
    let cursor = resolvedPath

    while (true) {
      try {
        const stat = await fs.lstat(cursor)
        if (stat.isSymbolicLink()) {
          throw new FileAccessServiceError('symlink_blocked', 'Cannot operate through symbolic link')
        }
        if (!stat.isDirectory()) {
          throw new FileAccessServiceError('access_denied', 'Access denied: path outside project directory')
        }
        const realCursor = await fs.realpath(cursor)
        if (!isPathWithinBase(realCursor, realBase)) {
          throw new FileAccessServiceError('access_denied', 'Access denied: path outside project directory')
        }
        return
      } catch (error) {
        if (error instanceof FileAccessServiceError) throw error
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') {
          const parent = path.dirname(cursor)
          if (parent === cursor) break
          cursor = parent
          continue
        }
        throw error
      }
    }

    throw new FileAccessServiceError('access_denied', 'Access denied: path outside project directory')
  }

  async renameProjectPath(
    projectPath: string,
    oldPath: string,
    newPath: string,
  ): Promise<ProjectFileRenameResult> {
    try {
      const normalizedProjectPath = requireNonEmpty(projectPath, 'projectPath')
      const normalizedOldPath = normalizeRelativePathInput(oldPath, 'oldPath')
      const normalizedNewPath = normalizeRelativePathInput(newPath, 'newPath')
      validateLeafName(normalizedNewPath, 'newPath')
      if (isInternalTrashPath(normalizedOldPath) || isInternalTrashPath(normalizedNewPath)) {
        throw new FileAccessServiceError('access_denied', 'Access denied: internal path is reserved')
      }

      if (normalizedOldPath === normalizedNewPath) {
        return fileAccessSuccess({ oldPath: normalizedOldPath, newPath: normalizedNewPath })
      }

      const resolvedBase = path.resolve(normalizedProjectPath)
      const resolvedOldPath = path.resolve(resolvedBase, normalizedOldPath)
      const resolvedNewPath = path.resolve(resolvedBase, normalizedNewPath)
      const resolvedNewParent = path.dirname(resolvedNewPath)

      await this.policy.assertResolvedPathWithinBase({
        resolvedPath: resolvedOldPath,
        resolvedBase,
        deniedMessage: 'Access denied: path outside project directory',
      })
      await this.assertPathWithinProjectBaseAllowMissing(resolvedNewParent, resolvedBase)

      const oldStat = await fs.lstat(resolvedOldPath)
      if (oldStat.isSymbolicLink()) {
        throw new FileAccessServiceError('symlink_blocked', 'Cannot rename symbolic link')
      }

      const existsNewPath = await fs.lstat(resolvedNewPath)
        .then(() => true)
        .catch((error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
          throw error
        })
      if (existsNewPath) {
        throw new FileAccessServiceError('already_exists', 'A file or folder with this name already exists')
      }

      await fs.mkdir(resolvedNewParent, { recursive: true })
      await fs.rename(resolvedOldPath, resolvedNewPath)
      return fileAccessSuccess({
        oldPath: normalizedOldPath,
        newPath: normalizedNewPath,
      })
    } catch (error) {
      return asFileAccessFailure(error)
    }
  }

  async deleteProjectPath(
    projectPath: string,
    targetPath: string,
  ): Promise<ProjectFileDeleteResult> {
    try {
      const normalizedProjectPath = requireNonEmpty(projectPath, 'projectPath')
      const normalizedTargetPath = normalizeRelativePathInput(targetPath, 'targetPath')
      if (isInternalTrashPath(normalizedTargetPath)) {
        throw new FileAccessServiceError('access_denied', 'Access denied: internal path is reserved')
      }

      const resolvedBase = path.resolve(normalizedProjectPath)
      const resolvedTargetPath = path.resolve(resolvedBase, normalizedTargetPath)
      const resolvedTrashDir = path.resolve(resolvedBase, PROJECT_TRASH_DIRNAME)

      await this.policy.assertResolvedPathWithinBase({
        resolvedPath: resolvedTargetPath,
        resolvedBase,
        deniedMessage: 'Access denied: path outside project directory',
      })
      await this.assertPathWithinProjectBaseAllowMissing(resolvedTrashDir, resolvedBase)

      const targetStat = await fs.lstat(resolvedTargetPath)
      if (targetStat.isSymbolicLink()) {
        throw new FileAccessServiceError('symlink_blocked', 'Cannot delete symbolic link')
      }

      await fs.mkdir(resolvedTrashDir, { recursive: true })
      const undoToken = randomUUID()
      const trashName = `${Date.now()}-${undoToken}-${path.basename(normalizedTargetPath)}`
      const resolvedTrashPath = path.join(resolvedTrashDir, trashName)

      await fs.rename(resolvedTargetPath, resolvedTrashPath)
      this.rememberPendingDeleteUndo(undoToken, {
        projectBase: resolvedBase,
        trashPath: resolvedTrashPath,
        originalPath: resolvedTargetPath,
      })

      return fileAccessSuccess({
        deletedPath: normalizedTargetPath,
        undoToken,
      })
    } catch (error) {
      return asFileAccessFailure(error)
    }
  }

  async restoreDeletedProjectPath(
    projectPath: string,
    undoToken: string,
  ): Promise<ProjectFileRestoreDeleteResult> {
    try {
      const normalizedProjectPath = requireNonEmpty(projectPath, 'projectPath')
      const normalizedUndoToken = requireNonEmpty(undoToken, 'undoToken')
      const undoRecord = this.pendingDeleteUndos.get(normalizedUndoToken)
      if (!undoRecord) {
        throw new FileAccessServiceError('not_found', 'Undo is no longer available')
      }

      const resolvedBase = path.resolve(normalizedProjectPath)
      if (resolvedBase !== undoRecord.projectBase) {
        throw new FileAccessServiceError('access_denied', 'Access denied: undo token does not match project')
      }

      await this.policy.assertResolvedPathWithinBase({
        resolvedPath: undoRecord.trashPath,
        resolvedBase,
        deniedMessage: 'Access denied: path outside project directory',
      })

      const restoreParent = path.dirname(undoRecord.originalPath)
      await this.assertPathWithinProjectBaseAllowMissing(restoreParent, resolvedBase)

      const trashStat = await fs.lstat(undoRecord.trashPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      })
      if (!trashStat) {
        this.pendingDeleteUndos.delete(normalizedUndoToken)
        throw new FileAccessServiceError('not_found', 'Undo is no longer available')
      }
      if (trashStat.isSymbolicLink()) {
        throw new FileAccessServiceError('symlink_blocked', 'Cannot restore symbolic link')
      }

      const targetExists = await fs.lstat(undoRecord.originalPath)
        .then(() => true)
        .catch((error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
          throw error
        })
      if (targetExists) {
        throw new FileAccessServiceError('already_exists', 'A file or folder with this name already exists')
      }

      await fs.rename(undoRecord.trashPath, undoRecord.originalPath)
      this.pendingDeleteUndos.delete(normalizedUndoToken)

      return fileAccessSuccess({
        restoredPath: toRelativeProjectPath(resolvedBase, undoRecord.originalPath),
      })
    } catch (error) {
      return asFileAccessFailure(error)
    }
  }

  async createProjectFile(
    projectPath: string,
    filePath: string,
  ): Promise<ProjectFileCreateResult> {
    try {
      const normalizedProjectPath = requireNonEmpty(projectPath, 'projectPath')
      const normalizedFilePath = normalizeRelativePathInput(filePath, 'filePath')
      validateLeafName(normalizedFilePath, 'filePath')
      if (isInternalTrashPath(normalizedFilePath)) {
        throw new FileAccessServiceError('access_denied', 'Access denied: internal path is reserved')
      }

      const resolvedBase = path.resolve(normalizedProjectPath)
      const resolvedFilePath = path.resolve(resolvedBase, normalizedFilePath)
      const resolvedParent = path.dirname(resolvedFilePath)

      await this.assertPathWithinProjectBaseAllowMissing(resolvedParent, resolvedBase)

      await fs.mkdir(resolvedParent, { recursive: true })
      const handle = await fs.open(resolvedFilePath, 'wx')
      await handle.close()

      return fileAccessSuccess({
        path: normalizedFilePath,
      })
    } catch (error) {
      return asFileAccessFailure(error)
    }
  }

  async createProjectDirectory(
    projectPath: string,
    directoryPath: string,
  ): Promise<ProjectFileCreateDirectoryResult> {
    try {
      const normalizedProjectPath = requireNonEmpty(projectPath, 'projectPath')
      const normalizedDirectoryPath = normalizeRelativePathInput(directoryPath, 'directoryPath')
      validateLeafName(normalizedDirectoryPath, 'directoryPath')
      if (isInternalTrashPath(normalizedDirectoryPath)) {
        throw new FileAccessServiceError('access_denied', 'Access denied: internal path is reserved')
      }

      const resolvedBase = path.resolve(normalizedProjectPath)
      const resolvedDirectoryPath = path.resolve(resolvedBase, normalizedDirectoryPath)

      await this.assertPathWithinProjectBaseAllowMissing(resolvedDirectoryPath, resolvedBase)

      const existsTarget = await fs.lstat(resolvedDirectoryPath)
        .then(() => true)
        .catch((error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
          throw error
        })
      if (existsTarget) {
        throw new FileAccessServiceError('already_exists', 'A file or folder with this name already exists')
      }

      await fs.mkdir(resolvedDirectoryPath, { recursive: false })
      return fileAccessSuccess({
        path: normalizedDirectoryPath,
      })
    } catch (error) {
      return asFileAccessFailure(error)
    }
  }
}
