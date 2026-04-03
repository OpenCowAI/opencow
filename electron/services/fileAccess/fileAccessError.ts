// SPDX-License-Identifier: Apache-2.0

import { fileAccessFailure, type FileAccessErrorCode, type FileAccessFailure } from '@shared/fileAccess'

export class FileAccessServiceError extends Error {
  constructor(
    public readonly code: FileAccessErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'FileAccessServiceError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function asFileAccessFailure(error: unknown): FileAccessFailure {
  if (error instanceof FileAccessServiceError) {
    return fileAccessFailure(error.code, error.message)
  }

  const errnoCode = (error as NodeJS.ErrnoException | undefined)?.code
  if (errnoCode === 'ENOENT') {
    return fileAccessFailure('not_found', 'File not found')
  }
  if (errnoCode === 'EACCES' || errnoCode === 'EPERM') {
    return fileAccessFailure('access_denied', 'Access denied')
  }
  if (errnoCode === 'EEXIST' || errnoCode === 'ENOTEMPTY') {
    return fileAccessFailure('already_exists', 'A file or folder with this name already exists')
  }
  if (errnoCode === 'ELOOP') {
    return fileAccessFailure('access_denied', 'Access denied')
  }
  if (
    errnoCode === 'EIO' ||
    errnoCode === 'ENOSPC' ||
    errnoCode === 'EMFILE' ||
    errnoCode === 'ENFILE' ||
    errnoCode === 'EROFS' ||
    errnoCode === 'EBUSY'
  ) {
    const message = error instanceof Error ? error.message : 'Filesystem I/O error'
    return fileAccessFailure('io_error', message)
  }

  const message = error instanceof Error ? error.message : 'Unexpected file access error'
  return fileAccessFailure('internal_error', message)
}
