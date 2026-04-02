// SPDX-License-Identifier: Apache-2.0

import { homedir } from 'node:os'
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
        return {
          scope: 'custom-path',
          cwd,
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
