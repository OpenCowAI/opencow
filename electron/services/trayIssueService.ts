// SPDX-License-Identifier: Apache-2.0

/**
 * Tray Issue Service
 *
 * Computes issue-centric view data for the Tray Popover by joining
 * managed sessions (for activity status) with issues (for user-facing metadata).
 *
 * The tray popover only shows Issues that have an active managed session
 * (active / waiting / error) AND a valid projectId. This ensures every tray
 * item is navigable to an Issue detail view — no orphan sessions, no
 * project-less issues that cannot be navigated.
 *
 * @module
 */

import type { SessionOrchestrator } from '../command/sessionOrchestrator'
import type { IssueService } from './issueService'
import type { ProjectService } from './projectService'
import type { TrayIssueItem, TraySessionStatus, ManagedSessionState, IssueStatus, IssuePriority } from '@shared/types'
import { getOriginIssueId } from '@shared/types'
import { createLogger } from '../platform/logger'

const log = createLogger('TrayIssueService')

/**
 * Map a ManagedSessionState to a TraySessionStatus.
 * Returns null for states that should not appear in the tray (e.g. stopped).
 */
function toTrayStatus(state: ManagedSessionState): TraySessionStatus | null {
  switch (state) {
    case 'creating':
    case 'streaming':
      return 'active'
    case 'awaiting_input':
    case 'awaiting_question':
    case 'idle':
    case 'stopping':
      return 'waiting'
    case 'error':
      return 'error'
    case 'stopped':
      return null
  }
}

export interface TrayIssueServiceDeps {
  orchestrator: SessionOrchestrator
  issueService: IssueService
  projectService: ProjectService
}

/** Intermediate pair linking a managed session to its origin issue. */
interface SessionIssuePair {
  issueId: string
  managedSessionId: string
  sessionStatus: TraySessionStatus
  lastActivity: number
}

/** Cached issue metadata with preserved original types. */
interface IssueMeta {
  title: string
  status: IssueStatus
  priority: IssuePriority
  projectId: string | null
}

export class TrayIssueService {
  private readonly orchestrator: SessionOrchestrator
  private readonly issueService: IssueService
  private readonly projectService: ProjectService

  constructor(deps: TrayIssueServiceDeps) {
    this.orchestrator = deps.orchestrator
    this.issueService = deps.issueService
    this.projectService = deps.projectService
  }

  /**
   * Compute the current list of tray issue items.
   *
   * Joins managed sessions (filtered to active/waiting/error + issue origin)
   * with issue metadata and project names.
   */
  async getItems(): Promise<TrayIssueItem[]> {
    try {
      const managedSessions = await this.orchestrator.listSessions()

      // Filter to sessions that are visible in the tray AND linked to an issue
      const pairs: SessionIssuePair[] = []
      for (const ms of managedSessions) {
        const trayStatus = toTrayStatus(ms.state)
        if (!trayStatus) continue

        const issueId = getOriginIssueId(ms.origin)
        if (!issueId) continue

        pairs.push({
          issueId,
          managedSessionId: ms.id,
          sessionStatus: trayStatus,
          lastActivity: ms.lastActivity,
        })
      }

      if (pairs.length === 0) return []

      // Batch-fetch issues in parallel
      const issueIds = [...new Set(pairs.map((p) => p.issueId))]
      const issueResults = await Promise.all(
        issueIds.map((id) => this.issueService.getIssue(id).then((issue) => [id, issue] as const))
      )
      const issueMap = new Map<string, IssueMeta>()
      for (const [id, issue] of issueResults) {
        if (issue) {
          issueMap.set(id, {
            title: issue.title,
            status: issue.status,
            priority: issue.priority,
            projectId: issue.projectId,
          })
        }
      }

      // Batch-fetch projects in parallel
      const projectIds = [...new Set(
        [...issueMap.values()].map((i) => i.projectId).filter((id): id is string => id !== null)
      )]
      const projectResults = await Promise.all(
        projectIds.map((pid) => this.projectService.getById(pid).then((project) => [pid, project] as const))
      )
      const projectNameMap = new Map<string, string>()
      for (const [pid, project] of projectResults) {
        if (project) {
          projectNameMap.set(pid, project.name)
        }
      }

      // Assemble TrayIssueItems — skip issues without a projectId (not navigable)
      const items: TrayIssueItem[] = []
      for (const pair of pairs) {
        const issue = issueMap.get(pair.issueId)
        if (!issue || !issue.projectId) continue

        items.push({
          issueId: pair.issueId,
          issueTitle: issue.title,
          issueStatus: issue.status,
          issuePriority: issue.priority,
          projectId: issue.projectId,
          projectName: projectNameMap.get(issue.projectId) ?? null,
          sessionStatus: pair.sessionStatus,
          managedSessionId: pair.managedSessionId,
          lastActivity: pair.lastActivity,
        })
      }

      // Sort: waiting first (needs attention), then error, then active — within each group by lastActivity desc
      const statusOrder: Record<TraySessionStatus, number> = { waiting: 0, error: 1, active: 2 }
      items.sort((a, b) => {
        const orderDiff = statusOrder[a.sessionStatus] - statusOrder[b.sessionStatus]
        if (orderDiff !== 0) return orderDiff
        return b.lastActivity - a.lastActivity
      })

      return items
    } catch (err) {
      log.error('Failed to compute tray issue items', err)
      return []
    }
  }
}
