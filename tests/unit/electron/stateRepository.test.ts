// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Kysely } from 'kysely'
import { createTestDb } from '../../helpers/testDb'
import { StateRepository } from '../../../electron/services/capabilityCenter/stateRepository'
import type { Database } from '../../../electron/database/types'

describe('StateRepository', () => {
  let db: Kysely<Database>
  let close: () => Promise<void>
  let repo: StateRepository

  beforeEach(async () => {
    ({ db, close } = await createTestDb())
    repo = new StateRepository(db)
  })

  afterEach(async () => {
    await close()
  })

  describe('migrateDistributionPaths', () => {
    async function insertDistribution(overrides: {
      category?: string
      name?: string
      targetType?: string
      targetPath: string
    }): Promise<void> {
      await db.insertInto('capability_distribution').values({
        category: overrides.category ?? 'rules',
        name: overrides.name ?? `test-${Math.random().toString(36).slice(2, 6)}`,
        target_type: overrides.targetType ?? 'claude-code-project',
        target_path: overrides.targetPath,
        strategy: 'copy',
        content_hash: 'sha256:abc',
        distributed_at: Date.now(),
      }).execute()
    }

    async function getAllTargetPaths(): Promise<string[]> {
      const rows = await db
        .selectFrom('capability_distribution')
        .select('target_path')
        .orderBy('name')
        .execute()
      return rows.map((r) => r.target_path)
    }

    it('migrates paths matching the old prefix to the new prefix', async () => {
      await insertDistribution({
        name: 'rule-a',
        targetPath: '/Users/me/my-app/.claude/rules/rule-a.md',
      })
      await insertDistribution({
        name: 'rule-b',
        targetPath: '/Users/me/my-app/.claude/rules/rule-b.md',
      })

      const count = await repo.migrateDistributionPaths({
        oldProjectPath: '/Users/me/my-app',
        newProjectPath: '/Users/me/my-app-v2',
      })

      expect(count).toBe(2)
      const paths = await getAllTargetPaths()
      expect(paths).toEqual([
        '/Users/me/my-app-v2/.claude/rules/rule-a.md',
        '/Users/me/my-app-v2/.claude/rules/rule-b.md',
      ])
    })

    it('does not affect paths belonging to other projects', async () => {
      await insertDistribution({
        name: 'mine',
        targetPath: '/Users/me/my-app/.claude/rules/mine.md',
      })
      await insertDistribution({
        name: 'other',
        targetPath: '/Users/me/other-project/.claude/rules/other.md',
      })

      const count = await repo.migrateDistributionPaths({
        oldProjectPath: '/Users/me/my-app',
        newProjectPath: '/Users/me/my-app-v2',
      })

      expect(count).toBe(1)
      const paths = await getAllTargetPaths()
      expect(paths).toContain('/Users/me/my-app-v2/.claude/rules/mine.md')
      expect(paths).toContain('/Users/me/other-project/.claude/rules/other.md')
    })

    it('returns 0 when no paths match', async () => {
      await insertDistribution({
        name: 'unrelated',
        targetPath: '/Users/me/other/.claude/rules/unrelated.md',
      })

      const count = await repo.migrateDistributionPaths({
        oldProjectPath: '/Users/me/nonexistent',
        newProjectPath: '/Users/me/new-name',
      })

      expect(count).toBe(0)
    })

    it('returns 0 when old and new paths are identical', async () => {
      await insertDistribution({
        name: 'same',
        targetPath: '/Users/me/proj/.claude/rules/same.md',
      })

      const count = await repo.migrateDistributionPaths({
        oldProjectPath: '/Users/me/proj',
        newProjectPath: '/Users/me/proj',
      })

      expect(count).toBe(0)
    })

    it('handles exact path match (no trailing subdirectory)', async () => {
      // Edge case: target_path is exactly the project path (unlikely but valid)
      await insertDistribution({
        name: 'exact',
        targetPath: '/Users/me/my-app',
      })

      const count = await repo.migrateDistributionPaths({
        oldProjectPath: '/Users/me/my-app',
        newProjectPath: '/Users/me/my-app-v2',
      })

      expect(count).toBe(1)
      const paths = await getAllTargetPaths()
      expect(paths).toContain('/Users/me/my-app-v2')
    })

    it('does not match partial directory names (no false positive on prefix)', async () => {
      // /Users/me/my-app-extended should NOT be matched by /Users/me/my-app
      await insertDistribution({
        name: 'extended',
        targetPath: '/Users/me/my-app-extended/.claude/rules/r.md',
      })

      const count = await repo.migrateDistributionPaths({
        oldProjectPath: '/Users/me/my-app',
        newProjectPath: '/Users/me/my-app-v2',
      })

      // Only exact match or prefix/ match should fire — "my-app-extended" is neither
      expect(count).toBe(0)
      const paths = await getAllTargetPaths()
      expect(paths).toEqual(['/Users/me/my-app-extended/.claude/rules/r.md'])
    })

    it('correctly handles paths with underscore characters (LIKE wildcard)', async () => {
      // _ is a LIKE wildcard matching any single character.
      // The ESCAPE clause must ensure my_app matches literally, not my?app.
      await insertDistribution({
        name: 'underscore-rule',
        targetPath: '/Users/me/my_app/.claude/rules/r.md',
      })
      // This path should NOT be matched — myXapp differs from my_app
      await insertDistribution({
        name: 'similar-rule',
        targetPath: '/Users/me/myXapp/.claude/rules/r.md',
      })

      const count = await repo.migrateDistributionPaths({
        oldProjectPath: '/Users/me/my_app',
        newProjectPath: '/Users/me/my_app_v2',
      })

      expect(count).toBe(1)
      const paths = await getAllTargetPaths()
      expect(paths).toContain('/Users/me/my_app_v2/.claude/rules/r.md')
      expect(paths).toContain('/Users/me/myXapp/.claude/rules/r.md') // untouched
    })
  })

  describe('batchGetDistributions', () => {
    it('filters by targetTypes and prefers target order when multiple records exist', async () => {
      const now = Date.now()
      await repo.recordDistribution({
        category: 'rule',
        name: 'engine-aware',
        targetType: 'claude-code-global',
        targetPath: '/tmp/claude/rules/engine-aware.md',
        strategy: 'copy',
        contentHash: 'sha256:claude',
        distributedAt: now,
      })
      await repo.recordDistribution({
        category: 'rule',
        name: 'engine-aware',
        targetType: 'codex-global',
        targetPath: '/tmp/codex/rules/engine-aware.md',
        strategy: 'copy',
        contentHash: 'sha256:codex',
        distributedAt: now,
      })

      const result = await repo.batchGetDistributions(
        'rule',
        ['engine-aware'],
        { targetTypes: ['codex-global', 'claude-code-global'] },
      )

      expect(result.get('engine-aware')?.targetType).toBe('codex-global')
      expect(result.get('engine-aware')?.targetPath).toBe('/tmp/codex/rules/engine-aware.md')
    })
  })

  describe('batchGetDistributionTargetTypes', () => {
    it('returns deduplicated target types grouped by capability name', async () => {
      const now = Date.now()
      await repo.recordDistribution({
        category: 'skill',
        name: 'multi-engine',
        targetType: 'codex-project',
        targetPath: '/tmp/project/.codex/config.toml',
        strategy: 'copy',
        contentHash: 'sha256:codex-a',
        distributedAt: now,
      })
      await repo.recordDistribution({
        category: 'skill',
        name: 'multi-engine',
        targetType: 'claude-code-global',
        targetPath: '/tmp/.claude/skills/multi-engine/SKILL.md',
        strategy: 'copy',
        contentHash: 'sha256:claude-a',
        distributedAt: now + 1,
      })
      await repo.recordDistribution({
        category: 'skill',
        name: 'claude-only',
        targetType: 'claude-code-project',
        targetPath: '/tmp/project/.claude/skills/claude-only/SKILL.md',
        strategy: 'copy',
        contentHash: 'sha256:claude-b',
        distributedAt: now + 2,
      })

      const result = await repo.batchGetDistributionTargetTypes(
        'skill',
        ['multi-engine', 'claude-only'],
      )

      expect(result.get('multi-engine')).toEqual(['claude-code-global', 'codex-project'])
      expect(result.get('claude-only')).toEqual(['claude-code-project'])
    })
  })

  describe('import source_origin mapping', () => {
    it('keeps codex origin as-is', async () => {
      await repo.recordImport({
        category: 'skill',
        name: 'codex-skill',
        sourcePath: '/tmp/.agents/skills/codex-skill/SKILL.md',
        sourceOrigin: 'codex',
        sourceHash: null,
        importedAt: Date.now(),
      })

      const records = await repo.getImportsByOrigin('codex')
      expect(records).toHaveLength(1)
      expect(records[0]?.sourceOrigin).toBe('codex')
    })

    it('maps unknown source_origin to unknown instead of claude-code', async () => {
      await db
        .insertInto('capability_import')
        .values({
          category: 'skill',
          name: 'future-origin',
          source_path: '/tmp/future-origin.md',
          source_origin: 'future-engine',
          source_hash: null,
          imported_at: Date.now(),
        })
        .execute()

      const record = await repo.getImport('skill', 'future-origin')
      expect(record?.sourceOrigin).toBe('unknown')
    })
  })
})
