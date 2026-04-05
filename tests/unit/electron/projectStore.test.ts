// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { Kysely, SqliteDialect, Migrator } from 'kysely'
import { migrationProvider } from '../../../electron/database/migrations/provider'
import { ProjectStore } from '../../../electron/services/projectStore'
import type { Database } from '../../../electron/database/types'

describe('ProjectStore', () => {
  let db: Kysely<Database>
  let raw: BetterSqlite3.Database
  let store: ProjectStore

  beforeEach(async () => {
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = new Kysely<Database>({ dialect: new SqliteDialect({ database: raw }) })
    const migrator = new Migrator({ db, provider: migrationProvider })
    await migrator.migrateToLatest()
    store = new ProjectStore(db)
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('creates a project and retrieves it by id', async () => {
    const project = await store.create({ name: 'MyProject', canonicalPath: '/Users/me/myproject' })
    expect(project.id).toBeTruthy()
    expect(project.name).toBe('MyProject')
    expect(project.canonicalPath).toBe('/Users/me/myproject')

    const fetched = await store.getById(project.id)
    expect(fetched).toEqual(project)
  })

  it('finds project by canonical path', async () => {
    const project = await store.create({ name: 'Test', canonicalPath: '/test/path' })
    const found = await store.findByCanonicalPath('/test/path')
    expect(found?.id).toBe(project.id)
  })

  it('returns null for non-existent path', async () => {
    const found = await store.findByCanonicalPath('/nonexistent')
    expect(found).toBeNull()
  })

  it('adds and finds claude folder mapping', async () => {
    const project = await store.create({ name: 'P1', canonicalPath: '/p1' })
    await store.addClaudeMapping('-Users-me-p1', project.id)

    const found = await store.findByClaudeFolderId('-Users-me-p1')
    expect(found?.id).toBe(project.id)
  })

  it('supports multiple claude folders mapping to one project', async () => {
    const project = await store.create({ name: 'P1', canonicalPath: '/p1' })
    await store.addClaudeMapping('-Users-me-p1', project.id)
    await store.addClaudeMapping('-Users-Me-p1', project.id)

    const mappings = await store.getClaudeMappings(project.id)
    expect(mappings).toHaveLength(2)
  })

  it('lists all projects', async () => {
    await store.create({ name: 'A', canonicalPath: '/a' })
    await store.create({ name: 'B', canonicalPath: '/b' })

    const all = await store.listAll()
    expect(all).toHaveLength(2)
  })

  it('updates project name', async () => {
    const project = await store.create({ name: 'Old', canonicalPath: '/test' })
    const updated = await store.update(project.id, { name: 'New' })
    expect(updated?.name).toBe('New')
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(project.updatedAt)
  })

  it('applies default project preferences on create', async () => {
    const project = await store.create({ name: 'Pref', canonicalPath: '/pref' })
    expect(project.preferences).toEqual({
      defaultTab: 'issues',
      defaultChatViewMode: 'default',
      defaultFilesDisplayMode: null,
      defaultBrowserStatePolicy: 'shared-global',
    })
  })

  it('merges partial preference updates without dropping existing values', async () => {
    const created = await store.create({
      name: 'PrefMerge',
      canonicalPath: '/pref-merge',
      preferences: {
        defaultTab: 'schedule',
        defaultChatViewMode: 'files',
        defaultFilesDisplayMode: 'browser',
        defaultBrowserStatePolicy: 'isolated-session',
      },
    })

    const updated = await store.update(created.id, {
      preferences: { defaultTab: 'chat' },
    })

    expect(updated?.preferences).toEqual({
      defaultTab: 'chat',
      defaultChatViewMode: 'files',
      defaultFilesDisplayMode: 'browser',
      defaultBrowserStatePolicy: 'isolated-session',
    })
  })

  it('normalizes files chat mode to explicit files display mode', async () => {
    const created = await store.create({
      name: 'PrefNormalize',
      canonicalPath: '/pref-normalize',
      preferences: {
        defaultTab: 'issues',
        defaultChatViewMode: 'files',
        defaultFilesDisplayMode: null,
      },
    })

    expect(created.preferences).toEqual({
      defaultTab: 'issues',
      defaultChatViewMode: 'files',
      defaultFilesDisplayMode: 'ide',
      defaultBrowserStatePolicy: 'shared-global',
    })
  })

  it('updates browser default state policy via partial preference patch', async () => {
    const created = await store.create({
      name: 'PrefBrowserPolicy',
      canonicalPath: '/pref-browser-policy',
    })

    const updated = await store.update(created.id, {
      preferences: { defaultBrowserStatePolicy: 'isolated-issue' },
    })

    expect(updated?.preferences).toEqual({
      defaultTab: 'issues',
      defaultChatViewMode: 'default',
      defaultFilesDisplayMode: null,
      defaultBrowserStatePolicy: 'isolated-issue',
    })
  })

  it('cascades delete to mappings', async () => {
    const project = await store.create({ name: 'P', canonicalPath: '/p' })
    await store.addClaudeMapping('folder1', project.id)

    await store.delete(project.id)
    const found = await store.findByClaudeFolderId('folder1')
    expect(found).toBeNull()
  })

  it('creates project with null pinOrder and archivedAt', async () => {
    const p = await store.create({ name: 'Test', canonicalPath: '/test' })
    expect(p.pinOrder).toBeNull()
    expect(p.archivedAt).toBeNull()
  })

  it('updates pinOrder', async () => {
    const p = await store.create({ name: 'Test', canonicalPath: '/test' })
    const updated = await store.update(p.id, { pinOrder: 0 })
    expect(updated!.pinOrder).toBe(0)
  })

  it('updates archivedAt', async () => {
    const p = await store.create({ name: 'Test', canonicalPath: '/test' })
    const now = Date.now()
    const updated = await store.update(p.id, { archivedAt: now })
    expect(updated!.archivedAt).toBe(now)
  })

  it('clears pinOrder by setting null', async () => {
    const p = await store.create({ name: 'Test', canonicalPath: '/test' })
    await store.update(p.id, { pinOrder: 0 })
    const cleared = await store.update(p.id, { pinOrder: null })
    expect(cleared!.pinOrder).toBeNull()
  })

  it('nextPinOrder returns 0 when no pinned projects', async () => {
    expect(await store.nextPinOrder()).toBe(0)
  })

  it('nextPinOrder returns max + 1', async () => {
    const p1 = await store.create({ name: 'A', canonicalPath: '/a' })
    const p2 = await store.create({ name: 'B', canonicalPath: '/b' })
    await store.update(p1.id, { pinOrder: 0 })
    await store.update(p2.id, { pinOrder: 5 })
    expect(await store.nextPinOrder()).toBe(6)
  })

  it('addClaudeMapping upserts — re-mapping a folder to a different project updates it', async () => {
    const p1 = await store.create({ name: 'P1', canonicalPath: '/p1' })
    const p2 = await store.create({ name: 'P2', canonicalPath: '/p2' })
    await store.addClaudeMapping('folder1', p1.id)
    await store.addClaudeMapping('folder1', p2.id)

    const found = await store.findByClaudeFolderId('folder1')
    expect(found?.id).toBe(p2.id)
  })

  it('addClaudeMapping dual-writes to external mapping table', async () => {
    const project = await store.create({ name: 'P1', canonicalPath: '/p1' })
    await store.addClaudeMapping('folder-ext-1', project.id)

    const found = await store.findByExternalRef({
      engineKind: 'claude',
      externalProjectRef: 'folder-ext-1',
    })
    expect(found?.id).toBe(project.id)
  })

  it('supports non-claude external mappings', async () => {
    const project = await store.create({ name: 'P-Codex', canonicalPath: '/codex' })
    await store.addExternalMapping({
      engineKind: 'codex',
      externalProjectRef: 'thread-root-1',
      projectId: project.id,
    })

    const found = await store.findByExternalRef({
      engineKind: 'codex',
      externalProjectRef: 'thread-root-1',
    })
    expect(found?.id).toBe(project.id)
  })

  it('listAllExternalRefs filters by engine kind', async () => {
    const project = await store.create({ name: 'P-Multi', canonicalPath: '/multi' })
    await store.addExternalMapping({
      engineKind: 'claude',
      externalProjectRef: 'claude-1',
      projectId: project.id,
    })
    await store.addExternalMapping({
      engineKind: 'codex',
      externalProjectRef: 'codex-1',
      projectId: project.id,
    })

    const claudeRefs = await store.listAllExternalRefs({ engineKind: 'claude' })
    const codexRefs = await store.listAllExternalRefs({ engineKind: 'codex' })
    expect(claudeRefs.has('claude-1')).toBe(true)
    expect(claudeRefs.has('codex-1')).toBe(false)
    expect(codexRefs.has('codex-1')).toBe(true)
    expect(codexRefs.has('claude-1')).toBe(false)
  })
})
