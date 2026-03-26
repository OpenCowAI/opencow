// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  fileAccessSuccess,
  type FileAccessFailure,
  type FileAccessResult,
} from '@shared/fileAccess'
import type {
  BundleFileInfo,
  FileContentReadResult,
  FileContentWriteResult,
  ViewCapabilityBundleFileContentInput,
  ViewToolFileContentInput,
} from '@shared/types'
import { validateCapabilityPath } from '../../security/pathValidator'
import { asFileAccessFailure, FileAccessServiceError } from './fileAccessError'
import { FileAccessPolicyService } from './fileAccessPolicyService'

interface SessionSnapshotLike {
  executionContext?: {
    cwd?: string | null
  } | null
  projectPath?: string | null
}

interface ReadSessionToolFileInput {
  input: ViewToolFileContentInput
  getSession?: (sessionId: string) => Promise<SessionSnapshotLike | null>
}

interface ReadCapabilityBundleFileInput {
  input: ViewCapabilityBundleFileContentInput
  resolveProjectPathFromId?: (projectId: string) => Promise<string | undefined>
  bundleFileName: string
}

interface ListCapabilityBundleFilesInput {
  skillFilePath: string
  projectId?: string
  resolveProjectPathFromId?: (projectId: string) => Promise<string | undefined>
  bundleFileName: string
}

export class FileContentAccessService {
  constructor(
    private readonly policy = new FileAccessPolicyService(),
  ) {}

  async readProjectFile(projectPath: string, filePath: string): Promise<FileContentReadResult> {
    try {
      const normalizedProjectPath = this.requireNonEmpty(projectPath, 'projectPath')
      const normalizedFilePath = this.requireNonEmpty(filePath, 'filePath')

      const resolvedBase = path.resolve(normalizedProjectPath)
      const resolvedPath = path.resolve(resolvedBase, normalizedFilePath)

      await this.policy.assertResolvedPathWithinBase({
        resolvedPath,
        resolvedBase,
        deniedMessage: 'Access denied: path outside project directory',
      })

      const content = await this.policy.readViewableTextFile(resolvedPath, 'editor')
      return fileAccessSuccess(content)
    } catch (error) {
      return asFileAccessFailure(error)
    }
  }

  async readSessionToolFile(params: ReadSessionToolFileInput): Promise<FileContentReadResult> {
    try {
      if (!params.getSession) {
        throw new FileAccessServiceError('session_service_unavailable', 'Session service unavailable')
      }

      const sessionId = this.requireNonEmpty(params.input.sessionId, 'sessionId')
      const filePath = this.requireNonEmpty(params.input.filePath, 'filePath')

      const session = await params.getSession(sessionId)
      if (!session) {
        throw new FileAccessServiceError('session_not_found', `Session not found: ${sessionId}`)
      }

      const baseDir = session.executionContext?.cwd ?? session.projectPath
      if (!baseDir) {
        throw new FileAccessServiceError(
          'session_context_unavailable',
          'Session execution context unavailable',
        )
      }

      const resolvedBase = path.resolve(baseDir)
      const resolvedPath = path.resolve(resolvedBase, filePath)

      await this.policy.assertResolvedPathWithinBase({
        resolvedPath,
        resolvedBase,
        deniedMessage: 'Access denied: path outside session workspace',
      })

      const content = await this.policy.readViewableTextFile(resolvedPath, 'viewer')
      return fileAccessSuccess(content)
    } catch (error) {
      return asFileAccessFailure(error)
    }
  }

  async saveProjectFile(
    projectPath: string,
    filePath: string,
    content: string,
  ): Promise<FileContentWriteResult> {
    try {
      const normalizedProjectPath = this.requireNonEmpty(projectPath, 'projectPath')
      const normalizedFilePath = this.requireNonEmpty(filePath, 'filePath')

      const resolvedBase = path.resolve(normalizedProjectPath)
      const resolvedFilePath = path.resolve(resolvedBase, normalizedFilePath)
      const parentDir = path.dirname(resolvedFilePath)

      await this.policy.assertResolvedPathWithinBase({
        resolvedPath: parentDir,
        resolvedBase,
        deniedMessage: 'Access denied: path outside project directory',
      })

      await this.policy.writeTextFileSafely(resolvedFilePath, content)
      return fileAccessSuccess({ saved: true })
    } catch (error) {
      return asFileAccessFailure(error)
    }
  }

  async readCapabilityBundleFile(params: ReadCapabilityBundleFileInput): Promise<FileContentReadResult> {
    try {
      const skillFilePath = this.requireNonEmpty(params.input.bundle.skillFilePath, 'capability bundle skillFilePath')
      const relativePath = this.requireNonEmpty(params.input.bundle.relativePath, 'capability bundle relativePath')
      if (path.isAbsolute(relativePath)) {
        throw new FileAccessServiceError(
          'invalid_input',
          'Capability bundle relativePath must be relative',
        )
      }
      if (path.basename(skillFilePath) !== params.bundleFileName) {
        throw new FileAccessServiceError(
          'invalid_input',
          `Capability bundle must reference ${params.bundleFileName}`,
        )
      }

      const projectPath = params.input.projectId
        ? await params.resolveProjectPathFromId?.(params.input.projectId)
        : undefined
      const normalizedProjectPath = projectPath
        ? await fs.realpath(projectPath).catch(() => path.resolve(projectPath))
        : undefined

      this.assertCapabilityPathAllowed(skillFilePath, projectPath)
      const realSkillPath = await fs.realpath(skillFilePath)
      this.assertCapabilityPathAllowed(realSkillPath, normalizedProjectPath)
      if (path.basename(realSkillPath) !== params.bundleFileName) {
        throw new FileAccessServiceError(
          'invalid_input',
          `Capability bundle must reference ${params.bundleFileName}`,
        )
      }

      const bundleDir = path.dirname(realSkillPath)
      this.assertCapabilityPathAllowed(bundleDir, normalizedProjectPath)

      const resolvedBundleDir = path.resolve(bundleDir)
      const targetPath = path.resolve(resolvedBundleDir, relativePath)
      await this.policy.assertResolvedPathWithinBase({
        resolvedPath: targetPath,
        resolvedBase: resolvedBundleDir,
        deniedMessage: 'Access denied: path outside capability bundle',
      })

      const content = await this.policy.readViewableTextFile(targetPath, 'viewer')
      return fileAccessSuccess(content)
    } catch (error) {
      return asFileAccessFailure(error)
    }
  }

  async listCapabilityBundleFiles(params: ListCapabilityBundleFilesInput): Promise<BundleFileInfo[]> {
    const skillFilePath = path.resolve(params.skillFilePath)
    if (path.basename(skillFilePath) !== params.bundleFileName) {
      return []
    }

    const projectPath = params.projectId
      ? await params.resolveProjectPathFromId?.(params.projectId)
      : undefined
    const normalizedProjectPath = projectPath
      ? await fs.realpath(projectPath).catch(() => path.resolve(projectPath))
      : undefined

    this.assertCapabilityPathAllowed(skillFilePath, projectPath)

    const realSkillPath = await fs.realpath(skillFilePath)
    if (path.basename(realSkillPath) !== params.bundleFileName) {
      return []
    }
    this.assertCapabilityPathAllowed(realSkillPath, normalizedProjectPath)

    const bundleDir = path.dirname(realSkillPath)
    this.assertCapabilityPathAllowed(bundleDir, normalizedProjectPath)

    const skipDirectories = new Set([
      'node_modules',
      '.git',
      '__pycache__',
      '.venv',
      'dist',
      'build',
    ])
    const skipExtensions = new Set(['.pyc', '.pyo', '.dll', '.so', '.dylib'])

    const collect = async (
      directory: string,
      root: string,
      depth: number,
    ): Promise<BundleFileInfo[]> => {
      if (depth > 4) return []

      let entries: import('node:fs').Dirent[]
      try {
        entries = await fs.readdir(directory, { withFileTypes: true })
      } catch {
        return []
      }

      const result: BundleFileInfo[] = []
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        if (entry.name === params.bundleFileName && depth === 0) continue
        if (entry.isSymbolicLink()) continue

        const absolutePath = path.join(directory, entry.name)
        const relativePath = path.relative(root, absolutePath)

        if (entry.isDirectory()) {
          if (skipDirectories.has(entry.name)) continue
          result.push({
            relativePath,
            name: entry.name,
            isDirectory: true,
            size: 0,
          })
          const children = await collect(absolutePath, root, depth + 1)
          result.push(...children)
          continue
        }

        if (skipExtensions.has(path.extname(entry.name))) continue
        try {
          const stat = await fs.stat(absolutePath)
          result.push({
            relativePath,
            name: entry.name,
            isDirectory: false,
            size: stat.size,
          })
        } catch {
          // skip files we cannot stat
        }
      }

      return result
    }

    return collect(bundleDir, bundleDir, 0)
  }

  private requireNonEmpty(value: string, fieldName: string): string {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized) {
      throw new FileAccessServiceError('invalid_input', `Invalid ${fieldName}`)
    }
    return normalized
  }

  private assertCapabilityPathAllowed(targetPath: string, projectPath?: string): void {
    try {
      validateCapabilityPath(targetPath, projectPath)
    } catch (error) {
      if (error instanceof Error) {
        throw new FileAccessServiceError('capability_path_denied', error.message)
      }
      throw new FileAccessServiceError(
        'capability_path_denied',
        'Access denied: path outside allowed capability directories',
      )
    }
  }
}

export function isFileAccessFailure<T>(result: FileAccessResult<T>): result is FileAccessFailure {
  return !result.ok
}
