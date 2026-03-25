// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE issue_context_refs (
      id         TEXT    PRIMARY KEY NOT NULL,
      issue_id   TEXT    NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      ref_type   TEXT    NOT NULL CHECK(ref_type IN ('issue', 'artifact')),
      ref_id     TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    )
  `.execute(db)

  await sql`CREATE INDEX idx_issue_context_refs_issue_id ON issue_context_refs(issue_id)`.execute(db)
  await sql`CREATE INDEX idx_issue_context_refs_ref ON issue_context_refs(ref_type, ref_id)`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS issue_context_refs`.execute(db)
}
