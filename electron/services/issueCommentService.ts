// SPDX-License-Identifier: Apache-2.0

import { nanoid } from 'nanoid'
import type { IssueCommentStore } from './issueCommentStore'
import type { ChangeQueueService } from './issue-sync/changeQueueService'
import type { IssueComment, CreateIssueCommentInput, DataBusEvent } from '../../src/shared/types'

/**
 * Business logic for issue comments.
 *
 * Handles:
 * - Creating local comments (with optional push to remote via ChangeQueue)
 * - Listing comments for an issue
 * - Updating and deleting local comments
 */
export class IssueCommentService {
  private readonly store: IssueCommentStore
  private readonly changeQueueService: ChangeQueueService | null
  private readonly dispatch: (event: DataBusEvent) => void

  constructor(deps: {
    store: IssueCommentStore
    changeQueueService?: ChangeQueueService | null
    dispatch: (event: DataBusEvent) => void
  }) {
    this.store = deps.store
    this.changeQueueService = deps.changeQueueService ?? null
    this.dispatch = deps.dispatch
  }

  /**
   * Create a new local comment.
   * If the issue has a provider, also enqueues a push to remote.
   */
  async createComment(input: CreateIssueCommentInput, providerId?: string | null): Promise<IssueComment> {
    const now = Date.now()
    const comment: IssueComment = {
      id: nanoid(),
      issueId: input.issueId,
      providerId: providerId ?? null,
      remoteId: null,
      authorLogin: null, // Local user — no login needed
      authorName: null,
      authorAvatar: null,
      body: input.body,
      bodyFormat: input.bodyFormat ?? 'markdown',
      isLocal: true,
      createdAt: now,
      updatedAt: now,
      syncedAt: null,
    }

    await this.store.add(comment)
    this.dispatch({ type: 'issue-comments:changed', payload: { issueId: input.issueId } })

    // Enqueue push to remote if applicable
    if (providerId && this.changeQueueService) {
      await this.changeQueueService.enqueueComment(input.issueId, providerId, input.body)
    }

    return comment
  }

  /** List all comments for an issue (both local and remote). */
  async listComments(issueId: string): Promise<IssueComment[]> {
    return this.store.list(issueId)
  }

  /** Update a local comment's body. */
  async updateComment(id: string, body: string): Promise<IssueComment | null> {
    const existing = await this.store.get(id)
    if (!existing || !existing.isLocal) return null // Can't edit remote comments

    const updated = await this.store.update(id, { body })
    if (updated) {
      this.dispatch({ type: 'issue-comments:changed', payload: { issueId: existing.issueId } })
    }
    return updated
  }

  /** Delete a local comment. */
  async deleteComment(id: string): Promise<boolean> {
    const existing = await this.store.get(id)
    if (!existing || !existing.isLocal) return false // Can't delete remote comments

    const deleted = await this.store.delete(id)
    if (deleted) {
      this.dispatch({ type: 'issue-comments:changed', payload: { issueId: existing.issueId } })
    }
    return deleted
  }

  /** Count comments for an issue. */
  async countComments(issueId: string): Promise<number> {
    return this.store.count(issueId)
  }
}
