// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Migration 020 — Add project_id column to managed_sessions.
 *
 * Background
 * ----------
 * ManagedSession previously only had `project_path` (a filesystem concept
 * used to set the SDK's cwd). The Session-to-Project relationship was never
 * established at the domain level — there was no resolved `projectId`.
 *
 * This migration adds `project_id` so that sessions carry a first-class
 * domain-level link to their owning project. The field is used by:
 *   - NativeCapabilityToolContext.session.projectId — enables auto-injection into
 *     create_issue and dynamic tool descriptions
 *   - ManagedSessionInfo.projectId — persisted for resume
 *
 * Existing rows will have project_id = NULL, which is correct: old sessions
 * were created before project context injection existed.
 *
 * Rollback: not supported — additive column with no data loss.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE managed_sessions ADD COLUMN project_id TEXT`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  throw new Error(
    'Migration 020 down() is not supported. ' +
    'The project_id column is additive and has no impact on pre-020 behaviour.'
  )
}
