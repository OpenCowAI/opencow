// SPDX-License-Identifier: Apache-2.0

import { generateId } from '../shared/identity'
import { IssueStore } from './issueStore'
import { validateSetParent } from '../../src/shared/issueValidation'
import { deriveDescriptionFromRichContent } from '../../src/shared/richContentUtils'
import type { Issue, IssueSummary, CreateIssueInput, IssueFilter, IssueQueryFilter, DataBusEvent } from '../../src/shared/types'

interface IssueServiceDeps {
  store: IssueStore
  dispatch: (event: DataBusEvent) => void
}

export class IssueService {
  private store: IssueStore
  private dispatch: (event: DataBusEvent) => void

  constructor(deps: IssueServiceDeps) {
    this.store = deps.store
    this.dispatch = deps.dispatch
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
    }
    await this.store.add(issue)
    // Auto-sync labels to the registry so they appear in filter/picker UIs,
    // regardless of the entry point (UI form, MCP tool, API).
    await this.store.syncLabels(issue.labels)
    this.dispatch({ type: 'issues:invalidated', payload: {} })
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
