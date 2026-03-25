// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { Kysely, SqliteDialect, Migrator } from 'kysely'
import { migrationProvider } from '../../../electron/database/migrations/provider'

describe('004_create_projects migration', () => {
  let db: Kysely<unknown>
  let raw: BetterSqlite3.Database

  beforeEach(async () => {
    raw = new BetterSqlite3(':memory:')
    db = new Kysely({ dialect: new SqliteDialect({ database: raw }) })
    const migrator = new Migrator({ db, provider: migrationProvider })
    await migrator.migrateToLatest()
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('creates projects table with correct columns', () => {
    const cols = raw.pragma('table_info(projects)') as Array<{ name: string }>
    const names = cols.map((c) => c.name)
    expect(names).toContain('id')
    expect(names).toContain('name')
    expect(names).toContain('canonical_path')
    expect(names).toContain('created_at')
    expect(names).toContain('updated_at')
  })

  it('creates project_claude_mappings table with correct columns', () => {
    const cols = raw.pragma('table_info(project_claude_mappings)') as Array<{ name: string }>
    const names = cols.map((c) => c.name)
    expect(names).toContain('claude_folder_id')
    expect(names).toContain('project_id')
    expect(names).toContain('discovered_at')
  })

  it('creates project_external_mappings table with correct columns', () => {
    const cols = raw.pragma('table_info(project_external_mappings)') as Array<{ name: string }>
    const names = cols.map((c) => c.name)
    expect(names).toContain('id')
    expect(names).toContain('project_id')
    expect(names).toContain('engine_kind')
    expect(names).toContain('external_project_ref')
    expect(names).toContain('discovered_at')
  })

  it('enforces foreign key on project_claude_mappings', () => {
    raw.pragma('foreign_keys = ON')
    expect(() => {
      raw.exec(`INSERT INTO project_claude_mappings (claude_folder_id, project_id, discovered_at) VALUES ('test', 'nonexistent', 0)`)
    }).toThrow()
  })

  it('cascades delete from projects to mappings', () => {
    raw.pragma('foreign_keys = ON')
    const now = Date.now()
    raw.exec(`INSERT INTO projects (id, name, canonical_path, created_at, updated_at) VALUES ('p1', 'Test', '/test', ${now}, ${now})`)
    raw.exec(`INSERT INTO project_claude_mappings (claude_folder_id, project_id, discovered_at) VALUES ('folder1', 'p1', ${now})`)
    raw.exec(`DELETE FROM projects WHERE id = 'p1'`)
    const rows = raw.prepare('SELECT * FROM project_claude_mappings WHERE project_id = ?').all('p1')
    expect(rows).toHaveLength(0)
  })
})
