// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import nodeFs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { detectLanguage, isBinaryFile, MAX_FILE_SIZE_BYTES } from '@shared/fileUtils'
import type { FileContentResult } from '@shared/types'
import { isPathWithinBase, isRealPathWithinBase } from '../../security/pathBounds'
import { FileAccessServiceError } from './fileAccessError'

export type FileViewMode = 'editor' | 'viewer'

interface AssertPathWithinBaseInput {
  resolvedPath: string
  resolvedBase: string
  deniedMessage: string
}

export class FileAccessPolicyService {
  async assertResolvedPathWithinBase(input: AssertPathWithinBaseInput): Promise<void> {
    if (!isPathWithinBase(input.resolvedPath, input.resolvedBase)) {
      throw new FileAccessServiceError('access_denied', input.deniedMessage)
    }

    const withinRealPath = await isRealPathWithinBase(input.resolvedPath, input.resolvedBase)
    if (!withinRealPath) {
      throw new FileAccessServiceError('access_denied', input.deniedMessage)
    }
  }

  async readViewableTextFile(resolvedPath: string, mode: FileViewMode): Promise<FileContentResult> {
    if (isBinaryFile(resolvedPath)) {
      const modeMessage = mode === 'editor'
        ? 'Cannot open binary file in editor'
        : 'Cannot open binary file in viewer'
      throw new FileAccessServiceError('binary_file_not_supported', modeMessage)
    }

    const stat = await fs.stat(resolvedPath)
    if (stat.isDirectory()) {
      const modeMessage = mode === 'editor'
        ? 'Cannot open directory in editor'
        : 'Cannot open directory in viewer'
      throw new FileAccessServiceError('directory_not_supported', modeMessage)
    }

    if (stat.size > MAX_FILE_SIZE_BYTES) {
      throw new FileAccessServiceError(
        'file_too_large',
        `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`,
      )
    }

    const content = await fs.readFile(resolvedPath, 'utf-8')
    return {
      content,
      language: detectLanguage(resolvedPath),
      size: stat.size,
    }
  }

  async writeTextFileSafely(resolvedPath: string, content: string): Promise<void> {
    const writeFlags =
      nodeFs.constants.O_WRONLY |
      nodeFs.constants.O_CREAT |
      nodeFs.constants.O_TRUNC

    const noFollowFlag = nodeFs.constants.O_NOFOLLOW
    if (typeof noFollowFlag === 'number' && noFollowFlag > 0) {
      try {
        const handle = await fs.open(resolvedPath, writeFlags | noFollowFlag, 0o644)
        try {
          await handle.writeFile(content, 'utf-8')
        } finally {
          await handle.close()
        }
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ELOOP') {
          throw new FileAccessServiceError('symlink_blocked', 'Cannot write through symbolic link')
        }
        if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP') {
          throw error
        }
      }
    }

    let existing: nodeFs.Stats | null = null
    try {
      existing = await fs.lstat(resolvedPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    if (existing?.isSymbolicLink()) {
      throw new FileAccessServiceError('symlink_blocked', 'Cannot write through symbolic link')
    }

    const parentDir = path.dirname(resolvedPath)
    const tempPath = path.join(
      parentDir,
      `.opencow-write-${process.pid}-${Date.now()}-${randomUUID()}.tmp`,
    )

    await fs.writeFile(tempPath, content, 'utf-8')
    try {
      await fs.rename(tempPath, resolvedPath)
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => {})
    }
  }
}
