// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import type { BrowserError } from '../types'

export interface UploadPolicyConfig {
  readonly maxFilesPerUpload: number
  readonly maxFileSizeBytes: number
  readonly maxTotalUploadSizeBytes: number
}

export interface UploadValidationContext {
  readonly projectPath?: string | null
  readonly startupCwd?: string
}

export interface UploadValidationResult {
  readonly rootRealPath: string
  readonly files: string[]
  readonly totalBytes: number
}

const DEFAULT_UPLOAD_POLICY_CONFIG: UploadPolicyConfig = {
  maxFilesPerUpload: 10,
  maxFileSizeBytes: 50 * 1024 * 1024,
  maxTotalUploadSizeBytes: 200 * 1024 * 1024,
}

export class UploadPolicyService {
  constructor(
    private readonly config: UploadPolicyConfig = DEFAULT_UPLOAD_POLICY_CONFIG,
  ) {}

  async validateFiles(
    files: string[],
    context: UploadValidationContext,
  ): Promise<UploadValidationResult> {
    if (!Array.isArray(files) || files.length === 0) {
      throw this.error({
        code: 'FILE_NOT_FOUND',
        path: '',
        message: 'No files provided for upload',
      })
    }

    if (files.length > this.config.maxFilesPerUpload) {
      throw this.error({
        code: 'UPLOAD_TOO_MANY_FILES',
        maxFiles: this.config.maxFilesPerUpload,
        received: files.length,
        message: `Upload accepts at most ${this.config.maxFilesPerUpload} files, received ${files.length}`,
      })
    }

    const rootInput = context.projectPath?.trim()
    if (!rootInput) {
      throw this.error({
        code: 'SENSITIVE_ACTION_DENIED',
        action: 'browser_upload',
        message: 'Automatic upload is disabled without a projectPath context',
      })
    }

    let rootRealPath: string
    try {
      rootRealPath = path.resolve(await realpath(rootInput))
    } catch {
      throw this.error({
        code: 'FILE_NOT_ALLOWED',
        path: rootInput,
        root: rootInput,
        message: `Upload root path is invalid or inaccessible: ${rootInput}`,
      })
    }

    const resolvedFiles: string[] = []
    let totalBytes = 0

    for (const raw of files) {
      const candidate = typeof raw === 'string' ? raw.trim() : ''
      if (!candidate) {
        throw this.error({
          code: 'FILE_NOT_FOUND',
          path: String(raw ?? ''),
          message: 'Upload file path must be a non-empty string',
        })
      }

      const absolutePath = path.isAbsolute(candidate)
        ? candidate
        : path.resolve(context.startupCwd ?? rootRealPath, candidate)

      let realFilePath: string
      let fileInfo: Awaited<ReturnType<typeof stat>>
      try {
        realFilePath = await realpath(absolutePath)
        fileInfo = await stat(realFilePath)
      } catch {
        throw this.error({
          code: 'FILE_NOT_FOUND',
          path: absolutePath,
          message: `Upload file not found: ${absolutePath}`,
        })
      }

      if (!fileInfo.isFile()) {
        throw this.error({
          code: 'FILE_NOT_FOUND',
          path: realFilePath,
          message: `Upload path is not a regular file: ${realFilePath}`,
        })
      }

      if (!isPathInsideRoot(realFilePath, rootRealPath)) {
        throw this.error({
          code: 'FILE_NOT_ALLOWED',
          path: realFilePath,
          root: rootRealPath,
          message: `Upload path "${realFilePath}" is outside allowed root "${rootRealPath}"`,
        })
      }

      if (fileInfo.size > this.config.maxFileSizeBytes) {
        throw this.error({
          code: 'UPLOAD_FILE_TOO_LARGE',
          path: realFilePath,
          sizeBytes: fileInfo.size,
          maxBytes: this.config.maxFileSizeBytes,
          message: `Upload file exceeds max size (${this.config.maxFileSizeBytes} bytes): ${realFilePath}`,
        })
      }

      totalBytes += fileInfo.size
      if (totalBytes > this.config.maxTotalUploadSizeBytes) {
        throw this.error({
          code: 'UPLOAD_TOTAL_TOO_LARGE',
          totalBytes,
          maxBytes: this.config.maxTotalUploadSizeBytes,
          message: `Upload total size exceeds max (${this.config.maxTotalUploadSizeBytes} bytes)`,
        })
      }

      resolvedFiles.push(path.resolve(realFilePath))
    }

    return {
      rootRealPath,
      files: resolvedFiles,
      totalBytes,
    }
  }

  private error(error: BrowserError): BrowserError {
    return error
  }
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

