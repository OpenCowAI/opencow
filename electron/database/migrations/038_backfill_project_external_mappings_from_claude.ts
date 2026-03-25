// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Migration 038 — Backfill project_external_mappings from project_claude_mappings.
 *
 * Idempotent via INSERT OR IGNORE on unique(engine_kind, external_project_ref).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT OR IGNORE INTO project_external_mappings (
      id,
      project_id,
      engine_kind,
      external_project_ref,
      discovered_at
    )
    SELECT
      lower(hex(randomblob(16))),
      pcm.project_id,
      'claude',
      pcm.claude_folder_id,
      pcm.discovered_at
    FROM project_claude_mappings pcm
  `.execute(db)
}

export async function down(_: Kysely<unknown>): Promise<void> {
  // No-op by design.
  // This migration is data-backfill only; deleting rows on rollback can drop
  // user-created mappings that happen to share the same external refs.
}
