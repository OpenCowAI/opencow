// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Migration 035 — Add execution_context column to managed_sessions.
 *
 * Stores a JSON-serialized SessionExecutionContext containing the session's
 * runtime working directory, git branch, detached/worktree state.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('managed_sessions')
    .addColumn('execution_context', 'text')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('managed_sessions')
    .dropColumn('execution_context')
    .execute()
}
