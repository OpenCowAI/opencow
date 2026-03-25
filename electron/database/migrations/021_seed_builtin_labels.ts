// SPDX-License-Identifier: Apache-2.0

import { sql, type Kysely } from 'kysely'

/**
 * Migration 021: Seed built-in labels into `custom_labels` table.
 *
 * Previously, built-in labels ('bug', 'feature', 'improvement') were a
 * hardcoded constant (`BUILTIN_LABELS`) merged at runtime with the
 * `custom_labels` table.  This caused a split-brain: labels created via
 * MCP / API were stored on issues but never registered in the table,
 * making them invisible in filter/picker UIs.
 *
 * This migration:
 *   1. Seeds the three built-in labels into `custom_labels`.
 *   2. Back-fills any labels already used on existing issues so the
 *      registry is fully consistent with actual data.
 *
 * After this migration, `BUILTIN_LABELS` constant is removed and
 * `custom_labels` becomes the single source of truth for available labels.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Seed the three former built-in labels
  for (const label of ['bug', 'feature', 'improvement']) {
    await sql`INSERT OR IGNORE INTO custom_labels (label) VALUES (${label})`.execute(db)
  }

  // 2. Back-fill labels from existing issues that aren't yet registered
  await sql`
    INSERT OR IGNORE INTO custom_labels (label)
    SELECT DISTINCT value
    FROM issues, json_each(issues.labels)
    WHERE value IS NOT NULL AND value != ''
  `.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // Intentionally no-op: removing seeded labels could break filter state.
  // The labels are harmless to keep.
}
