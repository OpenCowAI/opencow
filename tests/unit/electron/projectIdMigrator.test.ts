// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { Kysely, SqliteDialect, Migrator } from 'kysely'
import { migrationProvider } from '../../../electron/database/migrations/provider'
import { ProjectStore } from '../../../electron/services/projectStore'
import { ProjectService } from '../../../electron/services/projectService'
import { ProjectIdMigrator } from '../../../electron/services/projectIdMigrator'
import type { Database } from '../../../electron/database/types'

/** Minimal no-op stubs for stores only used by ProjectService.delete() */
function makeStubDeps(store: ProjectStore) {
  const noop = async () => 0
  return {
    store,
    issueStore: { deleteByProjectId: noop } as any,
    artifactStore: { deleteByProjectId: noop } as any,
    scheduleStore: { deleteByProjectId: noop } as any,
    pipelineStore: { deleteByProjectId: noop } as any,
    inboxStore: { detachFromProject: noop } as any,
  }
}

describe('ProjectIdMigrator', () => {
  let db: Kysely<Database>
  let raw: BetterSqlite3.Database
  let service: ProjectService
  let migrator: ProjectIdMigrator

  beforeEach(async () => {
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = new Kysely<Database>({ dialect: new SqliteDialect({ database: raw }) })
    const m = new Migrator({ db, provider: migrationProvider })
    await m.migrateToLatest()
    const store = new ProjectStore(db)
    service = new ProjectService(makeStubDeps(store))
    migrator = new ProjectIdMigrator({ db, projectStore: store })
  })

  afterEach(async () => { await db.destroy() })

  it('migrates issue project_id from folder name to stable ID', async () => {
    await service.importProjects([
      { folderName: '-Users-me-proj', resolvedPath: '/Users/me/proj', name: 'proj' },
    ])
    const now = Date.now()
    raw.exec(`INSERT INTO issues (id, title, description, status, priority, labels, project_id, session_history, images, created_at, updated_at) VALUES ('iss1', 'Test', '', 'backlog', 'medium', '[]', '-Users-me-proj', '[]', '[]', ${now}, ${now})`)

    const result = await migrator.migrateDatabase()
    expect(result.issues).toBeGreaterThan(0)

    const row = raw.prepare('SELECT project_id FROM issues WHERE id = ?').get('iss1') as { project_id: string }
    expect(row.project_id).not.toBe('-Users-me-proj')
  })

  it('migrates inbox hook_event projectId', async () => {
    await service.importProjects([
      { folderName: '-Users-me-proj', resolvedPath: '/Users/me/proj', name: 'proj' },
    ])
    const now = Date.now()
    const payload = JSON.stringify({ category: 'hook_event', projectId: '-Users-me-proj', sessionId: 'sess1', eventType: 'session_start', status: 'unread', id: 'msg1', createdAt: now })
    raw.exec(`INSERT INTO inbox_messages (id, category, status, event_type, project_id, session_id, payload, created_at) VALUES ('msg1', 'hook_event', 'unread', 'session_start', '-Users-me-proj', 'sess1', '${payload}', ${now})`)

    const result = await migrator.migrateDatabase()
    expect(result.inbox).toBeGreaterThan(0)

    const row = raw.prepare('SELECT project_id, payload FROM inbox_messages WHERE id = ?').get('msg1') as { project_id: string; payload: string }
    expect(row.project_id).not.toBe('-Users-me-proj')
    const parsed = JSON.parse(row.payload)
    expect(parsed.projectId).not.toBe('-Users-me-proj')
  })

  it('migrates smart_reminder ErrorSpikeContext.projectId', async () => {
    await service.importProjects([
      { folderName: '-Users-me-proj', resolvedPath: '/Users/me/proj', name: 'proj' },
    ])
    const now = Date.now()
    const payload = JSON.stringify({ category: 'smart_reminder', reminderType: 'error_spike', status: 'unread', id: 'msg2', createdAt: now, context: { projectId: '-Users-me-proj', errorCount: 5, windowMs: 60000 } })
    raw.exec(`INSERT INTO inbox_messages (id, category, status, reminder_type, project_id, payload, created_at) VALUES ('msg2', 'smart_reminder', 'unread', 'error_spike', NULL, '${payload}', ${now})`)

    await migrator.migrateDatabase()

    const row = raw.prepare('SELECT payload FROM inbox_messages WHERE id = ?').get('msg2') as { payload: string }
    const parsed = JSON.parse(row.payload)
    expect(parsed.context.projectId).not.toBe('-Users-me-proj')
  })

  it('is idempotent — second run migrates 0 rows', async () => {
    await service.importProjects([
      { folderName: '-Users-me-proj', resolvedPath: '/Users/me/proj', name: 'proj' },
    ])
    const now = Date.now()
    raw.exec(`INSERT INTO issues (id, title, description, status, priority, labels, project_id, session_history, images, created_at, updated_at) VALUES ('iss1', 'Test', '', 'backlog', 'medium', '[]', '-Users-me-proj', '[]', '[]', ${now}, ${now})`)

    await migrator.migrateDatabase()
    const second = await migrator.migrateDatabase()
    expect(second.issues).toBe(0)
    expect(second.inbox).toBe(0)
  })
})
