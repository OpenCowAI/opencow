// SPDX-License-Identifier: Apache-2.0

import { sql, type Kysely } from 'kysely'
import type { Database, ArtifactTable } from '../database/types'
import type { ArtifactFilter, ArtifactMetaPatch, ArtifactKind, ArtifactSource } from '../../src/shared/types'

// ─── Input type for batch upsert ────────────────────────────────────────────

export interface UpsertArtifactInput {
  id: string
  kind: ArtifactKind
  title: string
  mimeType: string
  filePath: string | null
  fileExtension: string | null
  sessionId: string | null
  issueId: string | null
  projectId: string | null
  source: ArtifactSource
  content: string | null
  contentHash: string
  contentLength: number
  writes: number
  edits: number
}

// ─── Row ↔ Domain helpers (used internally) ─────────────────────────────────

function inputToRow(input: UpsertArtifactInput, now: number): ArtifactTable {
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    mime_type: input.mimeType,
    file_path: input.filePath,
    file_extension: input.fileExtension,
    session_id: input.sessionId,
    issue_id: input.issueId,
    project_id: input.projectId,
    source: input.source,
    content: input.content,
    content_hash: input.contentHash,
    content_length: input.contentLength,
    starred: 0,
    starred_at: null,
    writes: input.writes,
    edits: input.edits,
    created_at: now,
    updated_at: now,
  }
}

// ─── ArtifactStore ──────────────────────────────────────────────────────────

/**
 * SQLite persistence for artifacts.
 * Follows the ManagedSessionStore upsert pattern.
 *
 * Content is stored in the same table. List queries return a truncated
 * preview (≤2 000 chars) for card thumbnails. Full content is fetched
 * on demand via `getContent(id)`.
 */
export class ArtifactStore {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Upsert a batch of artifacts.
   * Dedup: for 'file' kind, sessionId + filePath is the natural key.
   * On conflict, updates content/hash/stats if the content has changed.
   * @returns Number of rows inserted or updated.
   */
  async upsertBatch(inputs: UpsertArtifactInput[]): Promise<number> {
    if (inputs.length === 0) return 0

    const now = Date.now()
    let count = 0

    for (const input of inputs) {
      // Check for existing artifact by natural key (sessionId + filePath for files)
      let existing: Pick<ArtifactTable, 'id' | 'content_hash' | 'starred' | 'starred_at'> | undefined

      if (input.kind === 'file' && input.filePath) {
        const fileQ = this.db
          .selectFrom('artifacts')
          .select(['id', 'content_hash', 'starred', 'starred_at'])
          .where('file_path', '=', input.filePath)
        existing = await (
          input.sessionId !== null
            ? fileQ.where('session_id', '=', input.sessionId)
            : fileQ.where('session_id', 'is', null)
        ).executeTakeFirst()
      } else {
        // For non-file kinds: sessionId + contentHash
        const hashQ = this.db
          .selectFrom('artifacts')
          .select(['id', 'content_hash', 'starred', 'starred_at'])
          .where('content_hash', '=', input.contentHash)
        existing = await (
          input.sessionId !== null
            ? hashQ.where('session_id', '=', input.sessionId)
            : hashQ.where('session_id', 'is', null)
        ).executeTakeFirst()
      }

      if (existing) {
        // Only update if content changed
        if (existing.content_hash !== input.contentHash) {
          await this.db
            .updateTable('artifacts')
            .set({
              title: input.title,
              mime_type: input.mimeType,
              content: input.content,
              content_hash: input.contentHash,
              content_length: input.contentLength,
              writes: input.writes,
              edits: input.edits,
              updated_at: now,
            })
            .where('id', '=', existing.id)
            .execute()
          count++
        }
      } else {
        const row = inputToRow(input, now)
        await this.db
          .insertInto('artifacts')
          .values(row)
          .execute()
        count++
      }
    }

    return count
  }

  /**
   * List artifacts matching a filter.
   * Returns truncated content preview (≤2 000 chars) for card thumbnails.
   */
  async list(filter?: ArtifactFilter): Promise<ArtifactTable[]> {
    let query = this.db
      .selectFrom('artifacts')
      .select([
        'id', 'kind', 'title', 'mime_type', 'file_path', 'file_extension',
        'session_id', 'issue_id', 'project_id', 'source',
        'content_hash', 'content_length',
        'starred', 'starred_at', 'writes', 'edits',
        'created_at', 'updated_at',
      ])
      // Return truncated content preview for card thumbnails (≤2 000 chars)
      .select(sql<string | null>`SUBSTR(content, 1, 2000)`.as('content'))

    if (filter?.starred !== undefined) {
      query = query.where('starred', '=', filter.starred ? 1 : 0)
    }
    if (filter?.issueId) {
      query = query.where('issue_id', '=', filter.issueId)
    }
    if (filter?.projectId) {
      query = query.where('project_id', '=', filter.projectId)
    }
    if (filter?.sessionId) {
      query = query.where('session_id', '=', filter.sessionId)
    }
    if (filter?.kind) {
      query = query.where('kind', '=', filter.kind)
    }
    if (filter?.fileExtension) {
      query = query.where('file_extension', '=', filter.fileExtension)
    }

    return query.orderBy('updated_at', 'desc').execute() as Promise<ArtifactTable[]>
  }

  /**
   * Get full content for a single artifact (by ID).
   */
  async getContent(artifactId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('artifacts')
      .select('content')
      .where('id', '=', artifactId)
      .executeTakeFirst()

    return row?.content ?? null
  }

  /**
   * Update artifact metadata (star, issueId).
   * Returns the updated row (without content).
   */
  async updateMeta(id: string, patch: ArtifactMetaPatch): Promise<ArtifactTable | null> {
    const updates: Partial<ArtifactTable> = { updated_at: Date.now() }

    if (patch.starred !== undefined) {
      updates.starred = patch.starred ? 1 : 0
      updates.starred_at = patch.starred ? Date.now() : null
    }
    if ('issueId' in patch) {
      updates.issue_id = patch.issueId ?? null
    }

    await this.db
      .updateTable('artifacts')
      .set(updates)
      .where('id', '=', id)
      .execute()

    // Return updated row (with content preview)
    const row = await this.db
      .selectFrom('artifacts')
      .select([
        'id', 'kind', 'title', 'mime_type', 'file_path', 'file_extension',
        'session_id', 'issue_id', 'project_id', 'source',
        'content_hash', 'content_length',
        'starred', 'starred_at', 'writes', 'edits',
        'created_at', 'updated_at',
      ])
      .select(sql<string | null>`SUBSTR(content, 1, 2000)`.as('content'))
      .where('id', '=', id)
      .executeTakeFirst()

    return (row as ArtifactTable) ?? null
  }

  /**
   * Find a single artifact by sessionId + contentHash.
   * Used by persistAndStar to check if an artifact is already persisted.
   */
  async findBySessionAndHash(
    sessionId: string,
    contentHash: string,
  ): Promise<ArtifactTable | null> {
    const row = await this.db
      .selectFrom('artifacts')
      .selectAll()
      .where('session_id', '=', sessionId)
      .where('content_hash', '=', contentHash)
      .executeTakeFirst()
    return (row as ArtifactTable) ?? null
  }

  /**
   * Find a project_file artifact by projectId + filePath.
   * Used by starProjectFile to check if the file is already persisted.
   */
  async findByProjectAndPath(
    projectId: string,
    filePath: string,
  ): Promise<ArtifactTable | null> {
    const row = await this.db
      .selectFrom('artifacts')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('file_path', '=', filePath)
      .where('source', '=', 'project_file')
      .executeTakeFirst()
    return (row as ArtifactTable) ?? null
  }

  /**
   * Delete all project_file artifacts directly associated with a project.
   * Session-scoped artifacts (source = 'managed' | 'monitor') are left intact
   * because their lifecycle is tied to their session, not the project.
   * Called during project deletion to maintain data integrity.
   * @returns Number of deleted artifacts.
   */
  async deleteByProjectId(projectId: string): Promise<number> {
    const result = await this.db
      .deleteFrom('artifacts')
      .where('project_id', '=', projectId)
      .where('source', '=', 'project_file')
      .executeTakeFirst()
    return Number(result?.numDeletedRows ?? 0n)
  }

  /**
   * List starred artifacts, optionally filtered by project.
   * Returns truncated content preview (≤2 000 chars) for card thumbnails.
   */
  async listStarred(projectId?: string): Promise<ArtifactTable[]> {
    let query = this.db
      .selectFrom('artifacts')
      .select([
        'id', 'kind', 'title', 'mime_type', 'file_path', 'file_extension',
        'session_id', 'issue_id', 'project_id', 'source',
        'content_hash', 'content_length',
        'starred', 'starred_at', 'writes', 'edits',
        'created_at', 'updated_at',
      ])
      .select(sql<string | null>`SUBSTR(content, 1, 2000)`.as('content'))
      .where('starred', '=', 1)

    if (projectId) {
      query = query.where('project_id', '=', projectId)
    }

    return query.orderBy('starred_at', 'desc').execute() as Promise<ArtifactTable[]>
  }
}
