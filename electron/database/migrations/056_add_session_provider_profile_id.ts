// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * ε.3b — Persist provider-profile binding on managed sessions.
 *
 * Until now `providerProfileId` lived only on `SessionRuntime` in process
 * memory, captured at lifecycle spawn time from the Settings default.
 * That had two consequences:
 *
 *   1. App restart lost the binding — next spawn used whatever the
 *      current Settings default happened to be, silently.
 *   2. There was no way to pin a session to a specific provider; every
 *      session tracked whatever the user had configured as default.
 *
 * This column lets a session declare its provider binding explicitly.
 * Semantics:
 *
 *   - NULL (default for all existing rows) — "follow current Settings
 *     default". Matches the status-quo behavior.
 *   - Non-NULL — "pinned to this profile". ε.3c changes spawn to prefer
 *     this value over `getActiveProviderProfileId()`.
 *
 * This migration is additive only; no behavior changes yet.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('managed_sessions')
    .addColumn('provider_profile_id', 'text')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('managed_sessions')
    .dropColumn('provider_profile_id')
    .execute()
}
