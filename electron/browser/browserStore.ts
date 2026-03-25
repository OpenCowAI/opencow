// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import type { Database, BrowserProfileTable } from '../database/types'
import type { BrowserProfile, CreateProfileInput } from './types'
import { nanoid } from 'nanoid'

/**
 * BrowserStore — pure data access for browser profiles.
 *
 * Follows OpenCow's Store/Service separation pattern (see IssueStore).
 * No business logic — only SQL queries and row ↔ domain object mapping.
 */
export class BrowserStore {
  constructor(private readonly db: Kysely<Database>) {}

  async add(profile: BrowserProfile): Promise<void> {
    await this.db
      .insertInto('browser_profiles')
      .values(profileToRow(profile))
      .execute()
  }

  async getById(id: string): Promise<BrowserProfile | null> {
    const row = await this.db
      .selectFrom('browser_profiles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    return row ? rowToProfile(row) : null
  }

  async list(): Promise<BrowserProfile[]> {
    const rows = await this.db
      .selectFrom('browser_profiles')
      .selectAll()
      .orderBy('last_used_at', 'desc')
      .execute()

    return rows.map(rowToProfile)
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('browser_profiles')
      .where('id', '=', id)
      .executeTakeFirst()

    return (result?.numDeletedRows ?? 0n) > 0n
  }

  async updateLastUsed(id: string): Promise<void> {
    await this.db
      .updateTable('browser_profiles')
      .set({ last_used_at: Date.now() })
      .where('id', '=', id)
      .execute()
  }

  /** Create a new profile with auto-generated id and partition. */
  createProfile(input: CreateProfileInput): BrowserProfile {
    const id = nanoid()
    return {
      id,
      name: input.name,
      partition: `persist:browser-${id}`,
      allowedDomains: input.allowedDomains ?? [],
      cookiePersistence: input.cookiePersistence ?? true,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    }
  }
}

// ─── Row ↔ Domain object mappers ─────────────────────────────────────────

function rowToProfile(row: BrowserProfileTable): BrowserProfile {
  return {
    id: row.id,
    name: row.name,
    partition: row.partition,
    allowedDomains: JSON.parse(row.allowed_domains) as string[],
    cookiePersistence: row.cookie_persistence === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }
}

function profileToRow(profile: BrowserProfile): BrowserProfileTable {
  return {
    id: profile.id,
    name: profile.name,
    partition: profile.partition,
    allowed_domains: JSON.stringify(profile.allowedDomains),
    cookie_persistence: profile.cookiePersistence ? 1 : 0,
    created_at: profile.createdAt,
    last_used_at: profile.lastUsedAt,
  }
}
