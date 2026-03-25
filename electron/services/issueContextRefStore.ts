// SPDX-License-Identifier: Apache-2.0

import { type Kysely } from 'kysely'
import type { Database } from '../database/types'
import type { ContextRef } from '../../src/shared/types'
import { generateId } from '../shared/identity'

export class IssueContextRefStore {
  constructor(private readonly db: Kysely<Database>) {}

  async listByIssueId(issueId: string): Promise<ContextRef[]> {
    const rows = await this.db
      .selectFrom('issue_context_refs')
      .select(['ref_type', 'ref_id'])
      .where('issue_id', '=', issueId)
      .orderBy('created_at', 'asc')
      .execute()

    return rows.map((r) => ({ type: r.ref_type as ContextRef['type'], id: r.ref_id }))
  }

  async replaceAll(issueId: string, refs: ContextRef[]): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('issue_context_refs').where('issue_id', '=', issueId).execute()

      if (refs.length === 0) return

      const now = Date.now()
      await trx
        .insertInto('issue_context_refs')
        .values(
          refs.map((ref, i) => ({
            id: generateId(),
            issue_id: issueId,
            ref_type: ref.type,
            ref_id: ref.id,
            created_at: now + i, // Ensure uniqueness and preserve insertion order
          })),
        )
        .execute()
    })
  }

  /** Delete all references pointing to a specific entity (for polymorphic orphan cleanup) */
  async deleteByRef(ref: ContextRef): Promise<void> {
    await this.db
      .deleteFrom('issue_context_refs')
      .where('ref_type', '=', ref.type)
      .where('ref_id', '=', ref.id)
      .execute()
  }
}
