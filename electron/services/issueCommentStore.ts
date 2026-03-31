// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import type { Database, IssueCommentTable } from '../database/types'
import type { IssueComment, CommentBodyFormat } from '../../src/shared/types'

/**
 * Data-access layer for the `issue_comments` table.
 *
 * Handles both remote (synced from GitHub/GitLab) and local comments.
 * Remote comments are de-duplicated via the (provider_id, remote_id) unique index.
 */
export class IssueCommentStore {
  constructor(private readonly db: Kysely<Database>) {}

  async add(comment: IssueComment): Promise<void> {
    await this.db
      .insertInto('issue_comments')
      .values(commentToRow(comment))
      .execute()
  }

  async batchAdd(comments: IssueComment[]): Promise<void> {
    if (comments.length === 0) return
    await this.db
      .insertInto('issue_comments')
      .values(comments.map(commentToRow))
      .execute()
  }

  async get(id: string): Promise<IssueComment | null> {
    const row = await this.db
      .selectFrom('issue_comments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    return row ? rowToComment(row) : null
  }

  /** List comments for an issue, ordered by creation time (oldest first). */
  async list(issueId: string, limit = 100): Promise<IssueComment[]> {
    const rows = await this.db
      .selectFrom('issue_comments')
      .selectAll()
      .where('issue_id', '=', issueId)
      .orderBy('created_at', 'asc')
      .limit(limit)
      .execute()

    return rows.map(rowToComment)
  }

  async update(id: string, patch: Partial<IssueComment>): Promise<IssueComment | null> {
    const setClauses = patchToRow(patch)
    if (Object.keys(setClauses).length === 0) return this.get(id)

    await this.db
      .updateTable('issue_comments')
      .set({ ...setClauses, updated_at: Date.now() })
      .where('id', '=', id)
      .execute()

    return this.get(id)
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('issue_comments')
      .where('id', '=', id)
      .executeTakeFirst()

    return (result?.numDeletedRows ?? 0n) > 0n
  }

  /** Find a remote comment by provider + remote ID (for deduplication). */
  async findByRemoteId(providerId: string, remoteId: string): Promise<IssueComment | null> {
    const row = await this.db
      .selectFrom('issue_comments')
      .selectAll()
      .where('provider_id', '=', providerId)
      .where('remote_id', '=', remoteId)
      .executeTakeFirst()

    return row ? rowToComment(row) : null
  }

  /** Batch find remote comments by their remote IDs (for sync deduplication). */
  async findByRemoteIds(providerId: string, remoteIds: string[]): Promise<Map<string, IssueComment>> {
    if (remoteIds.length === 0) return new Map()

    const rows = await this.db
      .selectFrom('issue_comments')
      .selectAll()
      .where('provider_id', '=', providerId)
      .where('remote_id', 'in', remoteIds)
      .execute()

    const map = new Map<string, IssueComment>()
    for (const row of rows) {
      const comment = rowToComment(row)
      if (comment.remoteId) map.set(comment.remoteId, comment)
    }
    return map
  }

  /** Count comments for an issue. */
  async count(issueId: string): Promise<number> {
    const result = await this.db
      .selectFrom('issue_comments')
      .where('issue_id', '=', issueId)
      .select((eb) => eb.fn.count('id').as('count'))
      .executeTakeFirst()

    return Number(result?.count ?? 0)
  }
}

// ─── Row ↔ Domain ────────────────────────────────────────────────────────

function rowToComment(row: IssueCommentTable): IssueComment {
  return {
    id: row.id,
    issueId: row.issue_id,
    providerId: row.provider_id,
    remoteId: row.remote_id,
    authorLogin: row.author_login,
    authorName: row.author_name,
    authorAvatar: row.author_avatar,
    body: row.body,
    bodyFormat: row.body_format as CommentBodyFormat,
    isLocal: row.is_local === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
  }
}

function commentToRow(comment: IssueComment): IssueCommentTable {
  return {
    id: comment.id,
    issue_id: comment.issueId,
    provider_id: comment.providerId,
    remote_id: comment.remoteId,
    author_login: comment.authorLogin,
    author_name: comment.authorName,
    author_avatar: comment.authorAvatar,
    body: comment.body,
    body_format: comment.bodyFormat,
    is_local: comment.isLocal ? 1 : 0,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    synced_at: comment.syncedAt,
  }
}

function patchToRow(patch: Partial<IssueComment>): Partial<IssueCommentTable> {
  const row: Partial<IssueCommentTable> = {}

  if (patch.body !== undefined) row.body = patch.body
  if (patch.bodyFormat !== undefined) row.body_format = patch.bodyFormat
  if (patch.authorLogin !== undefined) row.author_login = patch.authorLogin
  if (patch.authorName !== undefined) row.author_name = patch.authorName
  if (patch.authorAvatar !== undefined) row.author_avatar = patch.authorAvatar
  if (patch.syncedAt !== undefined) row.synced_at = patch.syncedAt

  return row
}
