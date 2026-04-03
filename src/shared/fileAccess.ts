// SPDX-License-Identifier: Apache-2.0

export const FILE_ACCESS_ERROR_CODES = [
  'invalid_input',
  'invalid_name',
  'access_denied',
  'session_service_unavailable',
  'session_not_found',
  'session_context_unavailable',
  'capability_path_denied',
  'not_found',
  'already_exists',
  'binary_file_not_supported',
  'directory_not_supported',
  'file_too_large',
  'symlink_blocked',
  'io_error',
  'internal_error',
] as const

export type FileAccessErrorCode = (typeof FILE_ACCESS_ERROR_CODES)[number]

export interface FileAccessError {
  code: FileAccessErrorCode
  message: string
}

export interface FileAccessSuccess<T> {
  ok: true
  data: T
}

export interface FileAccessFailure {
  ok: false
  error: FileAccessError
}

export type FileAccessResult<T> = FileAccessSuccess<T> | FileAccessFailure

export function fileAccessSuccess<T>(data: T): FileAccessSuccess<T> {
  return { ok: true, data }
}

export function fileAccessFailure(code: FileAccessErrorCode, message: string): FileAccessFailure {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  }
}

export function isFileAccessSuccess<T>(result: FileAccessResult<T>): result is FileAccessSuccess<T> {
  return result.ok
}
