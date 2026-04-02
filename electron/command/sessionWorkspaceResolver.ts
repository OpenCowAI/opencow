// SPDX-License-Identifier: Apache-2.0

import { homedir } from 'node:os'
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { SessionWorkspaceInput } from '../../src/shared/types'

export type SessionWorkspaceScope = 'project' | 'global' | 'custom-path'

export interface ResolvedSessionWorkspace {
  scope: SessionWorkspaceScope
  cwd: string
  projectId: string | null
  projectPath: string | null
}

export type SessionWorkspaceResolutionErrorCode =
  | 'PROJECT_ID_REQUIRED'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_PATH_EMPTY'
  | 'CUSTOM_CWD_NOT_ABSOLUTE'
  | 'CUSTOM_CWD_NOT_FOUND'
  | 'CUSTOM_CWD_NOT_DIRECTORY'
  | 'INVALID_CUSTOM_CWD'

export class SessionWorkspaceResolutionError extends Error {
  readonly code: SessionWorkspaceResolutionErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: SessionWorkspaceResolutionErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'SessionWorkspaceResolutionError'
    this.code = code
    this.details = details
  }
}

export interface SessionWorkspaceResolverDeps {
  resolveProjectById?: ((projectId: string) => Promise<{ id: string; canonicalPath: string } | null>) | null
}

export class SessionWorkspaceResolver {
  private readonly resolveProjectById: ((projectId: string) => Promise<{ id: string; canonicalPath: string } | null>) | null

  constructor(deps: SessionWorkspaceResolverDeps = {}) {
    this.resolveProjectById = deps.resolveProjectById ?? null
  }

  async resolve(input: SessionWorkspaceInput | undefined): Promise<ResolvedSessionWorkspace> {
    const workspace = input ?? { scope: 'global' as const }

    switch (workspace.scope) {
      case 'global':
        return {
          scope: 'global',
          cwd: homedir(),
          projectId: null,
          projectPath: null,
        }

      case 'custom-path': {
        const cwd = workspace.cwd.trim()
        if (!cwd) {
          throw new SessionWorkspaceResolutionError(
            'INVALID_CUSTOM_CWD',
            'workspace.cwd must be a non-empty path for custom-path scope',
            { workspace },
          )
        }
        if (!isAbsolute(cwd)) {
          throw new SessionWorkspaceResolutionError(
            'CUSTOM_CWD_NOT_ABSOLUTE',
            'workspace.cwd must be an absolute path for custom-path scope',
            { cwd },
          )
        }
        let normalizedCwd: string
        try {
          normalizedCwd = realpathSync(cwd)
        } catch {
          throw new SessionWorkspaceResolutionError(
            'CUSTOM_CWD_NOT_FOUND',
            `workspace.cwd does not exist: ${cwd}`,
            { cwd },
          )
        }
        try {
          const stat = statSync(normalizedCwd)
          if (!stat.isDirectory()) {
            throw new SessionWorkspaceResolutionError(
              'CUSTOM_CWD_NOT_DIRECTORY',
              `workspace.cwd must be a directory: ${normalizedCwd}`,
              { cwd: normalizedCwd },
            )
          }
        } catch (err) {
          if (err instanceof SessionWorkspaceResolutionError) {
            throw err
          }
          throw new SessionWorkspaceResolutionError(
            'CUSTOM_CWD_NOT_FOUND',
            `workspace.cwd cannot be accessed: ${normalizedCwd}`,
            { cwd: normalizedCwd },
          )
        }
        return {
          scope: 'custom-path',
          cwd: normalizedCwd,
          projectId: null,
          projectPath: null,
        }
      }

      case 'project': {
        const projectId = workspace.projectId?.trim()
        if (!projectId) {
          throw new SessionWorkspaceResolutionError(
            'PROJECT_ID_REQUIRED',
            'workspace.projectId is required for project scope',
            { workspace },
          )
        }

        if (!this.resolveProjectById) {
          throw new SessionWorkspaceResolutionError(
            'PROJECT_NOT_FOUND',
            'Project resolver is not available to resolve project workspace',
            { projectId },
          )
        }

        const project = await this.resolveProjectById(projectId)
        if (!project) {
          throw new SessionWorkspaceResolutionError(
            'PROJECT_NOT_FOUND',
            `Project not found: ${projectId}`,
            { projectId },
          )
        }

        const projectPath = project.canonicalPath?.trim()
        if (!projectPath) {
          throw new SessionWorkspaceResolutionError(
            'PROJECT_PATH_EMPTY',
            `Project canonical path is empty: ${projectId}`,
            { projectId },
          )
        }

        return {
          scope: 'project',
          cwd: projectPath,
          projectId,
          projectPath,
        }
      }

      default: {
        const _exhaustive: never = workspace
        return _exhaustive
      }
    }
  }
}
