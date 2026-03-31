// SPDX-License-Identifier: Apache-2.0

import { generateId } from '../shared/identity'
import { IssueStore } from './issueStore'
import { validateSetParent } from '../../src/shared/issueValidation'
import { deriveDescriptionFromRichContent } from '../../src/shared/richContentUtils'
import { createLogger } from '../platform/logger'
import type { ChangeQueueService } from './issue-sync/changeQueueService'
import type { Issue, IssueSummary, CreateIssueInput, IssueFilter, IssueQueryFilter, DataBusEvent } from '../../src/shared/types'

const log = createLogger('IssueService')

interface IssueServiceDeps {
  store: IssueStore
  dispatch: (event: DataBusEvent) => void
  /** Optional — when provided, local changes to synced issues are enqueued for push. */
  changeQueueService?: ChangeQueueService | null
}

export class IssueService {
  private store: IssueStore
  private dispatch: (event: DataBusEvent) => void
  private changeQueueService: ChangeQueueService | null

  constructor(deps: IssueServiceDeps) {
    this.store = deps.store
    this.dispatch = deps.dispatch
    this.changeQueueService = deps.changeQueueService ?? null
  }

  /** Late-bind the ChangeQueueService (for circular dependency resolution). */
  setChangeQueueService(cqs: ChangeQueueService): void {
    this.changeQueueService = cqs
  }

  async start(): Promise<void> {
    await this.store.load()
  }

  async createIssue(input: CreateIssueInput): Promise<Issue> {
    const now = Date.now()

    const parentIssueId = input.parentIssueId ?? null
    let inheritedProjectId = input.projectId ?? null

    if (parentIssueId) {
      const parent = await this.store.get(parentIssueId)
      if (!parent) {
        throw new Error(`Parent issue not found: ${parentIssueId}`)
      }
      if (parent.parentIssueId) {
        throw new Error('Cannot create sub-issue of a sub-issue (only single-level nesting is supported)')
      }
      if (parent.status === 'done') {
        throw new Error('Cannot add sub-issues to a completed (Done) issue')
      }
      // Inherit projectId from parent when not specified
      if (inheritedProjectId === null) {
        inheritedProjectId = parent.projectId
      }
    }

    // When richContent is provided (GUI editor with TipTap), auto-derive
    // the plain-text description from it. This keeps description in sync as
    // a projection of richContent, used for search, list preview, and MCP API.
    const richContent = input.richContent ?? null
    const description = deriveDescriptionFromRichContent(richContent) ?? input.description ?? ''

    const issue: Issue = {
      id: generateId(),
      title: input.title,
      description,
      richContent,
      status: input.status ?? 'backlog',
      priority: input.priority ?? 'medium',
      labels: input.labels ?? [],
      projectId: inheritedProjectId,
      sessionId: input.sessionId ?? null,
      sessionHistory: [],
      parentIssueId,
      images: input.images ?? [],
      createdAt: now,
      updatedAt: now,
      readAt: now,
      lastAgentActivityAt: null,
      contextRefs: [],  // contextRefs are stored separately in issue_context_refs table
      // Remote issue tracking (null unless explicitly linked to a provider)
      providerId: input.providerId ?? null,
      remoteNumber: null,
      remoteUrl: null,
      remoteState: null,
      remoteSyncedAt: null,
      // Phase 2
      assignees: null,
      milestone: null,
      syncStatus: null,
      remoteUpdatedAt: null,
    }
    await this.store.add(issue)
    // Auto-sync labels to the registry so they appear in filter/picker UIs,
    // regardless of the entry point (UI form, MCP tool, API).
    await this.store.syncLabels(issue.labels)
    this.dispatch({ type: 'issues:invalidated', payload: {} })

    // Enqueue push to remote if issue has a provider and queue service is available
    if (issue.providerId && this.changeQueueService) {
      this.changeQueueService.enqueueCreate(issue).catch((err) => {
        log.warn(`Failed to enqueue remote create for issue ${issue.id}:`, err)
      })
    }

    return issue
  }

  async updateIssue(id: string, patch: Partial<Issue>): Promise<Issue | null> {
    // When richContent is updated, auto-derive description to keep them in sync.
    // Always set description — including empty string when content is cleared.
    if (patch.richContent !== undefined) {
      patch.description = deriveDescriptionFromRichContent(patch.richContent) ?? ''
    }

    // Snapshot old status before update for status-change event
    const old = patch.status !== undefined ? await this.store.get(id) : null

    // Validate parent-child relationship changes
    if (patch.parentIssueId !== undefined && patch.parentIssueId !== null) {
      const [source, target, sourceChildren] = await Promise.all([
        old ?? this.store.get(id),
        this.store.get(patch.parentIssueId),
        this.store.listChildren(id)
      ])

      const result = validateSetParent({
        sourceId: id,
        targetId: patch.parentIssueId,
        source,
        target,
        sourceHasChildren: sourceChildren.length > 0
      })
      if (!result.valid) {
        throw new Error(`Invalid parent-child relationship: ${result.error}`)
      }
    }

    const updated = await this.store.update(id, patch)
    if (updated) {
      // Auto-sync labels to the registry when labels are changed
      if (patch.labels && patch.labels.length > 0) {
        await this.store.syncLabels(patch.labels)
      }
      this.dispatch({ type: 'issues:invalidated', payload: {} })
      // Emit granular status-change event for Schedule EventMatcher
      if (old && old.status !== updated.status) {
        this.dispatch({
          type: 'issue:status_changed',
          payload: { issueId: id, oldStatus: old.status, newStatus: updated.status }
        })
      }

      // Enqueue push to remote if issue has a provider
      if (updated.providerId && this.changeQueueService) {
        // Map local terminal statuses to remote close/reopen.
        // GitHub/GitLab only have open/closed — both 'done' and 'cancelled' map to closed.
        const isClosedStatus = (s: string) => s === 'done' || s === 'cancelled'
        const wasOpen = old ? !isClosedStatus(old.status) : true
        const nowClosed = patch.status ? isClosedStatus(patch.status) : false
        const nowOpen = patch.status ? !isClosedStatus(patch.status) : false
        const wasClosed = old ? isClosedStatus(old.status) : false

        // Extract non-status field changes for bundling into close/reopen operations.
        const { status: _statusField, ...nonStatusPatch } = patch
        const hasNonStatusChanges = Object.keys(nonStatusPatch).length > 0

        if (nowClosed && wasOpen) {
          // Bundle field changes into the close operation so they're pushed atomically.
          // enqueueClose's merge strategy will also fold any prior pending updates.
          this.changeQueueService.enqueueClose(updated, hasNonStatusChanges ? nonStatusPatch : undefined).catch((err) =>
            log.warn(`Failed to enqueue remote close for issue ${id}:`, err))
        } else if (nowOpen && wasClosed) {
          this.changeQueueService.enqueueReopen(updated, hasNonStatusChanges ? nonStatusPatch : undefined).catch((err) =>
            log.warn(`Failed to enqueue remote reopen for issue ${id}:`, err))
        } else if (hasNonStatusChanges) {
          // No status transition — push field changes only
          this.changeQueueService.enqueueUpdate(updated, nonStatusPatch).catch((err) =>
            log.warn(`Failed to enqueue remote update for issue ${id}:`, err))
        }
        // Intra-group status changes (e.g. todo→in_progress) are not pushed to
        // GitHub/GitLab (they only recognize open/closed). Linear adapter maps
        // these internally via workflow state.
      }
    }
    return updated
  }

  async deleteIssue(id: string): Promise<boolean> {
    const result = await this.store.delete(id)
    if (result) {
      this.dispatch({ type: 'issues:invalidated', payload: {} })
    }
    return result
  }

  /**
   * Mark an issue as read by the user.
   * Uses `skipTimestamp` to avoid bumping `updatedAt` — reading an issue
   * is not a content modification and should not affect sort order.
   *
   * Note: Does NOT dispatch `issues:invalidated` — read status is a
   * local UI concern that doesn't warrant a full list refresh.
   */
  async markIssueRead(id: string): Promise<Issue | null> {
    return this.store.update(id, { readAt: Date.now() }, { skipTimestamp: true })
  }

  /**
   * Manually mark an issue as unread.
   * Sets `readAt` to 0 (sentinel value) so `isIssueUnread` returns true
   * regardless of `lastAgentActivityAt`. Viewing the issue detail will
   * clear this state via `markIssueRead`.
   * Uses `skipTimestamp` to avoid bumping `updatedAt`.
   *
   * Note: Does NOT dispatch `issues:invalidated` — same reasoning as markIssueRead.
   */
  async markIssueUnread(id: string): Promise<Issue | null> {
    return this.store.update(id, { readAt: 0 }, { skipTimestamp: true })
  }

  async getIssue(id: string): Promise<Issue | null> {
    return this.store.get(id)
  }

  async listIssues(filter?: IssueFilter | IssueQueryFilter): Promise<Issue[]> {
    return this.store.list(filter)
  }

  /** List lightweight issue summaries for list views (excludes heavy fields). */
  async listIssueSummaries(filter?: IssueFilter | IssueQueryFilter): Promise<IssueSummary[]> {
    return this.store.listSummaries(filter)
  }

  async countIssues(filter?: IssueFilter | IssueQueryFilter): Promise<number> {
    return this.store.count(filter)
  }

  /** Resolve the newest issue linked to any candidate session ID. */
  async findLatestIssueSummaryBySessionIds(sessionIds: string[]): Promise<IssueSummary | null> {
    return this.store.findLatestSummaryBySessionIds(sessionIds)
  }

  async listChildIssues(parentId: string): Promise<Issue[]> {
    return this.store.listChildren(parentId)
  }

  /** List lightweight child issue summaries (excludes heavy fields). */
  async listChildIssueSummaries(parentId: string): Promise<IssueSummary[]> {
    return this.store.listChildrenSummaries(parentId)
  }

  /**
   * Batch-update multiple issues in a single call.
   * Applies the same patch to all specified issue IDs.
   * Returns the list of successfully updated issues.
   */
  async batchUpdateIssues(ids: string[], patch: Partial<Issue>): Promise<Issue[]> {
    const results: Issue[] = []
    for (const id of ids) {
      try {
        const updated = await this.updateIssue(id, patch)
        if (updated) results.push(updated)
      } catch {
        // Best-effort — skip individual failures, continue with remaining
      }
    }
    // Single invalidation event after all updates (updateIssue already dispatches per-item,
    // but this ensures a final consistent state)
    if (results.length > 0) {
      this.dispatch({ type: 'issues:invalidated', payload: {} })
    }
    return results
  }

  async getCustomLabels(): Promise<string[]> {
    return this.store.getCustomLabels()
  }

  async createCustomLabel(label: string): Promise<string[]> {
    return this.store.addCustomLabel(label)
  }

  async deleteCustomLabel(label: string): Promise<string[]> {
    return this.store.deleteCustomLabel(label)
  }

  async updateCustomLabel(oldLabel: string, newLabel: string): Promise<string[]> {
    return this.store.updateCustomLabel(oldLabel, newLabel)
  }
}
