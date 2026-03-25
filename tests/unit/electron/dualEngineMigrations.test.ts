// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import * as m003 from '../../../electron/database/migrations/003_create_managed_sessions'
import * as m004 from '../../../electron/database/migrations/004_create_projects'
import * as m036 from '../../../electron/database/migrations/036_add_engine_kind_to_managed_sessions'
import * as m037 from '../../../electron/database/migrations/037_create_project_external_mappings'
import * as m038 from '../../../electron/database/migrations/038_backfill_project_external_mappings_from_claude'

describe('dual-engine additive migrations', () => {
  let db: Kysely<unknown>
  let raw: BetterSqlite3.Database

  beforeEach(() => {
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = new Kysely({ dialect: new SqliteDialect({ database: raw }) })
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('036 adds engine columns on managed_sessions with safe defaults', async () => {
    await m003.up(db)
    raw.exec(`
      INSERT INTO managed_sessions (
        id, sdk_session_id, state, stop_reason, issue_id, project_path, model,
        messages, created_at, last_activity,
        total_cost_usd, input_tokens, output_tokens, last_input_tokens, activity, error
      ) VALUES (
        'sess-1', NULL, 'stopped', NULL, NULL, '/tmp/p', 'claude-sonnet-4-6',
        '[]', 1, 1, 0, 0, 0, 0, NULL, NULL
      )
    `)

    await m036.up(db)

    const cols = raw.pragma('table_info(managed_sessions)') as Array<{ name: string }>
    const names = cols.map((c) => c.name)
    expect(names).toContain('engine_kind')
    expect(names).toContain('engine_state_json')

    const row = raw
      .prepare('SELECT engine_kind, engine_state_json FROM managed_sessions WHERE id = ?')
      .get('sess-1') as { engine_kind: string; engine_state_json: string | null }
    expect(row.engine_kind).toBe('claude')
    expect(row.engine_state_json).toBeNull()
  })

  it('037+038 create generic mapping table and backfill claude mappings idempotently', async () => {
    await m004.up(db)
    const now = Date.now()
    raw.exec(`
      INSERT INTO projects (id, name, canonical_path, created_at, updated_at)
      VALUES ('p1', 'P1', '/p1', ${now}, ${now})
    `)
    raw.exec(`
      INSERT INTO project_claude_mappings (claude_folder_id, project_id, discovered_at)
      VALUES ('folder-1', 'p1', ${now})
    `)

    await m037.up(db)
    await m038.up(db)
    await m038.up(db) // idempotency check

    const rows = raw
      .prepare(`
        SELECT project_id, engine_kind, external_project_ref, discovered_at
        FROM project_external_mappings
        WHERE engine_kind = 'claude' AND external_project_ref = 'folder-1'
      `)
      .all() as Array<{
        project_id: string
        engine_kind: string
        external_project_ref: string
        discovered_at: number
      }>

    expect(rows).toHaveLength(1)
    expect(rows[0].project_id).toBe('p1')
    expect(rows[0].engine_kind).toBe('claude')
    expect(rows[0].external_project_ref).toBe('folder-1')
    expect(rows[0].discovered_at).toBe(now)
  })
})
