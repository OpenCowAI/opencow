// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import type { Database, SessionNoteTable } from '../database/types'
import type { SessionNote, NoteContent, CreateNoteInput, IssueImage } from '../../src/shared/types'
import { generateId } from '../shared/identity'

// ─── Row ↔ Domain object mappers ─────────────────────────────────────────

function rowToNote(row: SessionNoteTable): SessionNote {
  const images = JSON.parse(row.images) as IssueImage[]
  return {
    id: row.id,
    issueId: row.issue_id,
    content: {
      text: row.content,
      richContent: row.rich_content ?? undefined,
      images: images.length > 0 ? images : undefined,
    },
    sourceFilePath: row.source_file_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function contentToRow(content: NoteContent): Pick<SessionNoteTable, 'content' | 'rich_content' | 'images'> {
  return {
    content: content.text,
    rich_content: content.richContent ?? null,
    images: JSON.stringify(content.images ?? []),
  }
}

// ─── Store ──────────────────────────────────────────────────────────────

export class NoteStore {
  constructor(private readonly db: Kysely<Database>) {}

  async listByIssue(issueId: string): Promise<SessionNote[]> {
    const rows = await this.db
      .selectFrom('session_notes')
      .selectAll()
      .where('issue_id', '=', issueId)
      .orderBy('created_at', 'asc')
      .execute()

    return rows.map(rowToNote)
  }

  async create(input: CreateNoteInput): Promise<SessionNote> {
    const now = Date.now()
    const note: SessionNote = {
      id: generateId(),
      issueId: input.issueId,
      content: input.content,
      sourceFilePath: input.sourceFilePath ?? null,
      createdAt: now,
      updatedAt: now,
    }

    const { content, rich_content, images } = contentToRow(input.content)
    await this.db
      .insertInto('session_notes')
      .values({
        id: note.id,
        issue_id: note.issueId,
        content,
        rich_content,
        source_file_path: note.sourceFilePath,
        images,
        created_at: now,
        updated_at: now,
      })
      .execute()

    return note
  }

  async update(id: string, content: NoteContent): Promise<SessionNote | null> {
    const row = contentToRow(content)
    await this.db
      .updateTable('session_notes')
      .set({ ...row, updated_at: Date.now() })
      .where('id', '=', id)
      .execute()

    return this.get(id)
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('session_notes')
      .where('id', '=', id)
      .executeTakeFirst()

    return (result?.numDeletedRows ?? 0n) > 0n
  }

  /** Return note counts grouped by issue ID for all issues that have notes. */
  async countByIssue(): Promise<Record<string, number>> {
    const rows = await this.db
      .selectFrom('session_notes')
      .select(['issue_id', this.db.fn.count<number>('id').as('count')])
      .groupBy('issue_id')
      .execute()

    const result: Record<string, number> = {}
    for (const row of rows) {
      result[row.issue_id] = Number(row.count)
    }
    return result
  }

  async get(id: string): Promise<SessionNote | null> {
    const row = await this.db
      .selectFrom('session_notes')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    return row ? rowToNote(row) : null
  }
}
