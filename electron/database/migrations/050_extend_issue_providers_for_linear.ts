// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Migration 050 — Extend issue_providers table for Linear integration.
 *
 * Adds:
 * - metadata: JSON text column for platform-specific configuration that doesn't
 *   fit into the generic columns (e.g., Linear's teamId, teamKey, cached
 *   WorkflowStates, tokenType).
 *
 * This column is intentionally generic (JSON text) so future platform integrations
 * (Jira, Asana, etc.) can reuse it without additional migrations.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('issue_providers')
    .addColumn('metadata', 'text')
    // JSON string for platform-specific config. NULL for GitHub/GitLab (not needed).
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('issue_providers').dropColumn('metadata').execute()
}
