// SPDX-License-Identifier: Apache-2.0

/**
 * ProjectNativeCapability — OpenCow built-in native capability for Project queries.
 *
 * Exposes 2 read-only MCP tools:
 *   list_projects — list all non-archived projects (with optional archive inclusion)
 *   get_project   — retrieve project details with issue statistics
 *
 * Write operations (create, delete, archive, pin) are intentionally omitted.
 * These involve file-system side-effects and cascading data cleanup — they
 * belong in the UI, not in an AI agent's toolbox. This aligns with the same
 * principle behind omitting delete_issue.
 *
 * Tool handlers run in-process (Electron main), directly calling ProjectService.
 * No extra process, no network round-trips.
 */

import { z } from 'zod/v4'
import type { NativeCapabilityMeta, NativeCapabilityToolContext } from './types'
import { BaseNativeCapability, type ToolConfig } from './baseNativeCapability'
import type { ProjectService } from '../services/projectService'
import type { IssueService } from '../services/issueService'

// ─── Dependencies ─────────────────────────────────────────────────────────────

export interface ProjectNativeCapabilityDeps {
  projectService: ProjectService
  issueService: IssueService
}

// ─── ProjectNativeCapability ──────────────────────────────────────────────────

export class ProjectNativeCapability extends BaseNativeCapability {
  readonly meta: NativeCapabilityMeta = {
    category: 'projects',
    name: 'Projects',
    description: 'OpenCow Project queries — list and inspect projects',
    version: '1.0.0',
  }

  private readonly projectService: ProjectService
  private readonly issueService: IssueService

  constructor(deps: ProjectNativeCapabilityDeps) {
    super()
    this.projectService = deps.projectService
    this.issueService = deps.issueService
  }

  protected toolConfigs(context: NativeCapabilityToolContext): ToolConfig[] {
    const currentProjectId = context.session.projectId
    return [
      this.listProjectsConfig(currentProjectId),
      this.getProjectConfig(),
    ]
  }

  // ── list_projects ───────────────────────────────────────────────────────────

  private listProjectsConfig(currentProjectId: string | null): ToolConfig {
    const contextHint = currentProjectId
      ? ` You are currently in project "${currentProjectId}".`
      : ' You are not in a project context.'

    return {
      name: 'list_projects',
      description:
        'List all OpenCow projects. Returns name, path, pin status, and archive status. ' +
        'By default only non-archived projects are returned.' +
        contextHint,
      schema: {
        includeArchived: z
          .boolean()
          .default(false)
          .describe('Include archived projects in the result (default: false)'),
      },
      execute: async (args) => {
        const includeArchived = (args.includeArchived as boolean) ?? false
        const all = await this.projectService.listAll()
        const filtered = includeArchived ? all : all.filter((p) => !p.archivedAt)

        return this.textResult(JSON.stringify({
          total: filtered.length,
          currentProjectId,
          projects: filtered.map((p) => ({
            id:            p.id,
            name:          p.name,
            canonicalPath: p.canonicalPath,
            pinOrder:      p.pinOrder,
            isArchived:    !!p.archivedAt,
            createdAt:     new Date(p.createdAt).toISOString(),
            updatedAt:     new Date(p.updatedAt).toISOString(),
          })),
        }, null, 2))
      },
    }
  }

  // ── get_project ─────────────────────────────────────────────────────────────

  private getProjectConfig(): ToolConfig {
    return {
      name: 'get_project',
      description:
        'Retrieve full details of a single OpenCow project by its ID, ' +
        'including issue count breakdown by status.',
      schema: {
        id: z.string().describe('The project ID to retrieve'),
      },
      execute: async (args) => {
        const id = args.id as string
        const project = await this.projectService.getById(id)
        if (!project) {
          return this.errorResult(new Error(`Project not found: ${id}`))
        }

        // Fetch issue stats
        const issues = await this.issueService.listIssues({ projectId: id })
        const statusCounts: Record<string, number> = {}
        for (const issue of issues) {
          statusCounts[issue.status] = (statusCounts[issue.status] ?? 0) + 1
        }

        return this.textResult(JSON.stringify({
          id:            project.id,
          name:          project.name,
          canonicalPath: project.canonicalPath,
          pinOrder:      project.pinOrder,
          isArchived:    !!project.archivedAt,
          createdAt:     new Date(project.createdAt).toISOString(),
          updatedAt:     new Date(project.updatedAt).toISOString(),
          issueStats: {
            total:    issues.length,
            byStatus: statusCounts,
          },
        }, null, 2))
      },
    }
  }
}
