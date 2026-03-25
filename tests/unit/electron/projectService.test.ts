// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { Kysely, SqliteDialect, Migrator } from 'kysely'
import { migrationProvider } from '../../../electron/database/migrations/provider'
import { ProjectStore } from '../../../electron/services/projectStore'
import { ProjectService } from '../../../electron/services/projectService'
import type { Database } from '../../../electron/database/types'
import type { DiscoveredProject } from '../../../electron/services/projectService'

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

describe('ProjectService', () => {
  let db: Kysely<Database>
  let raw: BetterSqlite3.Database
  let store: ProjectStore
  let service: ProjectService

  beforeEach(async () => {
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = new Kysely<Database>({ dialect: new SqliteDialect({ database: raw }) })
    const migrator = new Migrator({ db, provider: migrationProvider })
    await migrator.migrateToLatest()
    store = new ProjectStore(db)
    service = new ProjectService(makeStubDeps(store))
  })

  afterEach(async () => { await db.destroy() })

  describe('importProjects', () => {
    it('creates a new project for a new discovery', async () => {
      const discovered: DiscoveredProject[] = [
        { folderName: '-Users-me-proj', resolvedPath: '/Users/me/proj', name: 'proj' },
      ]
      const result = await service.importProjects(discovered)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('proj')
      expect(result[0].canonicalPath).toBe('/Users/me/proj')

      const found = await store.findByClaudeFolderId('-Users-me-proj')
      expect(found?.id).toBe(result[0].id)
    })

    it('reuses existing project for known claude folder', async () => {
      const disc: DiscoveredProject[] = [
        { folderName: '-Users-me-proj', resolvedPath: '/Users/me/proj', name: 'proj' },
      ]
      const first = await service.importProjects(disc)
      const second = await service.importProjects(disc)
      expect(second[0].id).toBe(first[0].id)

      const all = await store.listAll()
      expect(all).toHaveLength(1)
    })

    it('merges new claude folder into existing project by path match', async () => {
      const [p] = await service.importProjects([
        { folderName: '-Users-me-proj', resolvedPath: '/Users/me/proj', name: 'proj' },
      ])

      const [p2] = await service.importProjects([
        { folderName: '-Users-me-proj-renamed', resolvedPath: '/Users/me/proj', name: 'proj' },
      ])

      expect(p2.id).toBe(p.id)
      const mappings = await store.getClaudeMappings(p.id)
      expect(mappings).toHaveLength(2)
    })
  })

  describe('syncDiscovered', () => {
    it('returns matched projects as a Map, skips unknown', async () => {
      // Pre-create a project via importProjects
      const [project] = await service.importProjects([
        { folderName: '-Users-me-proj', resolvedPath: '/Users/me/proj', name: 'proj' },
      ])

      // syncDiscovered matches existing projects
      const result = await service.syncDiscovered([
        { folderName: '-Users-me-proj', resolvedPath: '/Users/me/proj', name: 'proj' },
      ])
      expect(result.size).toBe(1)
      expect(result.get('-Users-me-proj')?.id).toBe(project.id)

      // Unknown folder is silently skipped
      const unknown = await service.syncDiscovered([
        { folderName: '-Unknown-folder', resolvedPath: '/Unknown/path', name: 'unknown' },
      ])
      expect(unknown.size).toBe(0)
    })
  })

  describe('createManualProject', () => {
    it('creates a project for a new path', async () => {
      const project = await service.createManualProject({
        path: '/Users/me/new-project', name: 'New Project',
      })
      expect(project.name).toBe('New Project')
      expect(project.canonicalPath).toBe('/Users/me/new-project')
    })

    it('returns existing project if path already registered', async () => {
      const first = await service.createManualProject({ path: '/test' })
      const second = await service.createManualProject({ path: '/test' })
      expect(second.id).toBe(first.id)
    })
  })

  describe('resolveProjectId', () => {
    it('resolves claude folder to project id', async () => {
      const [project] = await service.importProjects([
        { folderName: '-Users-me-proj', resolvedPath: '/Users/me/proj', name: 'proj' },
      ])
      const resolved = await service.resolveProjectId('-Users-me-proj')
      expect(resolved).toBe(project.id)
    })

    it('returns null for unknown folder', async () => {
      const resolved = await service.resolveProjectId('unknown-folder')
      expect(resolved).toBeNull()
    })
  })

  describe('renameProject', () => {
    it('rejects empty name', async () => {
      const project = await store.create({ name: 'proj', canonicalPath: '/Users/me/proj' })
      await expect(service.renameProject({ id: project.id, newName: '  ' }))
        .rejects.toThrow('empty')
    })

    it('rejects name with path separators', async () => {
      const project = await store.create({ name: 'proj', canonicalPath: '/Users/me/proj' })
      await expect(service.renameProject({ id: project.id, newName: 'foo/bar' }))
        .rejects.toThrow('path separators')
    })

    it('rejects name exceeding 255 characters', async () => {
      const project = await store.create({ name: 'proj', canonicalPath: '/Users/me/proj' })
      await expect(service.renameProject({ id: project.id, newName: 'a'.repeat(256) }))
        .rejects.toThrow('too long')
    })

    it('returns project as-is when name is unchanged', async () => {
      const project = await store.create({ name: 'proj', canonicalPath: '/Users/me/proj' })
      const { project: result, previousPath } = await service.renameProject({ id: project.id, newName: 'proj' })
      expect(result.id).toBe(project.id)
      expect(result.name).toBe('proj')
      expect(result.canonicalPath).toBe('/Users/me/proj')
      expect(previousPath).toBe('/Users/me/proj')
    })

    it('throws for non-existent project id', async () => {
      await expect(service.renameProject({ id: 'nonexistent', newName: 'new-name' }))
        .rejects.toThrow('not found')
    })

    it('performs soft rename when directory does not exist', async () => {
      // Create a project with a path that doesn't exist on disk
      const project = await store.create({ name: 'ghost', canonicalPath: '/nonexistent/ghost' })
      const { project: result, previousPath } = await service.renameProject({ id: project.id, newName: 'renamed-ghost' })

      // Name updated, but canonicalPath stays the same (soft rename)
      expect(result.name).toBe('renamed-ghost')
      expect(result.canonicalPath).toBe('/nonexistent/ghost')
      // previousPath == canonicalPath means no disk rename happened
      expect(previousPath).toBe('/nonexistent/ghost')
    })
  })

  describe('pin / archive', () => {
    it('pinProject sets pinOrder and clears archivedAt', async () => {
      const project = await store.create({ name: 'P', canonicalPath: '/p' })
      await store.update(project.id, { archivedAt: Date.now() })

      const pinned = await service.pinProject(project.id)
      expect(pinned!.pinOrder).toBeGreaterThanOrEqual(0)
      expect(pinned!.archivedAt).toBeNull()
    })

    it('unpinProject clears pinOrder', async () => {
      const project = await store.create({ name: 'P', canonicalPath: '/p' })
      await service.pinProject(project.id)

      const unpinned = await service.unpinProject(project.id)
      expect(unpinned!.pinOrder).toBeNull()
    })

    it('archiveProject sets archivedAt and clears pinOrder', async () => {
      const project = await store.create({ name: 'P', canonicalPath: '/p' })
      await service.pinProject(project.id)

      const archived = await service.archiveProject(project.id)
      expect(archived!.archivedAt).toBeGreaterThan(0)
      expect(archived!.pinOrder).toBeNull()
    })

    it('unarchiveProject clears archivedAt', async () => {
      const project = await store.create({ name: 'P', canonicalPath: '/p' })
      await service.archiveProject(project.id)

      const unarchived = await service.unarchiveProject(project.id)
      expect(unarchived!.archivedAt).toBeNull()
    })
  })
})
