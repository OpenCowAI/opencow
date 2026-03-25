// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Kysely } from 'kysely'
import { createTestDb } from '../../helpers/testDb'
import { IssueStore } from '../../../electron/services/issueStore'
import type { Issue, IssueQueryFilter } from '../../../src/shared/types'
import type { Database } from '../../../electron/database/types'

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: `issue-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test Issue',
    description: '',
    status: 'backlog',
    priority: 'medium',
    labels: [],
    projectId: null,
    sessionId: null,
    sessionHistory: [],
    parentIssueId: null,
    images: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    readAt: null,
    lastAgentActivityAt: null,
    ...overrides
  }
}

describe('IssueStore', () => {
  let db: Kysely<Database>
  let close: () => Promise<void>
  let store: IssueStore

  beforeEach(async () => {
    ({ db, close } = await createTestDb())
    store = new IssueStore(db)
  })

  afterEach(async () => {
    await close()
  })

  describe('load', () => {
    it('creates empty store when database is fresh', async () => {
      await store.load()
      expect(await store.list()).toEqual([])
      // Migration 021 seeds built-in labels ('bug', 'feature', 'improvement')
      // into custom_labels, so a fresh DB is never truly empty for labels.
      expect(await store.getCustomLabels()).toEqual(
        expect.arrayContaining(['bug', 'feature', 'improvement'])
      )
    })
  })

  describe('add', () => {
    it('adds an issue and persists to database', async () => {
      const issue = makeIssue({ id: 'add-1', title: 'New Issue' })
      await store.add(issue)

      expect(await store.list()).toHaveLength(1)
      expect((await store.get('add-1'))?.title).toBe('New Issue')
    })
  })

  describe('update', () => {
    it('updates an existing issue', async () => {
      const issue = makeIssue({ id: 'upd-1', title: 'Original' })
      await store.add(issue)

      const updated = await store.update('upd-1', { title: 'Updated', status: 'todo' })
      expect(updated?.title).toBe('Updated')
      expect(updated?.status).toBe('todo')
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(issue.updatedAt)
    })

    it('returns null for non-existent issue', async () => {
      const result = await store.update('nonexistent', { title: 'X' })
      expect(result).toBeNull()
    })
  })

  describe('delete', () => {
    it('removes an issue', async () => {
      const issue = makeIssue({ id: 'del-1' })
      await store.add(issue)

      const result = await store.delete('del-1')
      expect(result).toBe(true)
      expect(await store.list()).toHaveLength(0)
    })

    it('returns false for non-existent issue', async () => {
      const result = await store.delete('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('list with filtering', () => {
    it('filters by status', async () => {
      await store.add(makeIssue({ id: 'f1', status: 'backlog' }))
      await store.add(makeIssue({ id: 'f2', status: 'todo' }))
      await store.add(makeIssue({ id: 'f3', status: 'backlog' }))

      const result = await store.list({ status: 'backlog' })
      expect(result).toHaveLength(2)
    })

    it('filters by priority', async () => {
      await store.add(makeIssue({ id: 'p1', priority: 'urgent' }))
      await store.add(makeIssue({ id: 'p2', priority: 'low' }))

      const result = await store.list({ priority: 'urgent' })
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('p1')
    })

    it('filters by label', async () => {
      await store.add(makeIssue({ id: 'l1', labels: ['bug', 'feature'] }))
      await store.add(makeIssue({ id: 'l2', labels: ['improvement'] }))

      const result = await store.list({ label: 'bug' })
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('l1')
    })

    it('filters by projectId', async () => {
      await store.add(makeIssue({ id: 'pj1', projectId: 'proj-a' }))
      await store.add(makeIssue({ id: 'pj2', projectId: 'proj-b' }))

      const result = await store.list({ projectId: 'proj-a' })
      expect(result).toHaveLength(1)
    })

    it('filters by search term in title', async () => {
      await store.add(makeIssue({ id: 's1', title: 'Fix auth bug' }))
      await store.add(makeIssue({ id: 's2', title: 'Add feature' }))

      const result = await store.list({ search: 'auth' })
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('s1')
    })

    it('sorts by updatedAt descending by default', async () => {
      await store.add(makeIssue({ id: 'o1', updatedAt: 1000 }))
      await store.add(makeIssue({ id: 'o2', updatedAt: 3000 }))
      await store.add(makeIssue({ id: 'o3', updatedAt: 2000 }))

      const result = await store.list()
      expect(result.map((i) => i.id)).toEqual(['o2', 'o3', 'o1'])
    })
  })

  describe('customLabels', () => {
    it('adds a custom label', async () => {
      await store.addCustomLabel('urgent-fix')
      expect(await store.getCustomLabels()).toContain('urgent-fix')
    })

    it('does not add duplicate labels', async () => {
      await store.addCustomLabel('my-label')
      await store.addCustomLabel('my-label')
      expect((await store.getCustomLabels()).filter((l) => l === 'my-label')).toHaveLength(1)
    })
  })

  describe('parent-child relationships', () => {
    it('creates a sub-issue with parentIssueId', async () => {
      const parent = makeIssue({ id: 'parent-1' })
      await store.add(parent)
      const child = makeIssue({ id: 'child-1', parentIssueId: 'parent-1' })
      await store.add(child)

      expect((await store.get('child-1'))?.parentIssueId).toBe('parent-1')
    })

    it('lists children of a parent', async () => {
      await store.add(makeIssue({ id: 'parent-1' }))
      await store.add(makeIssue({ id: 'child-1', parentIssueId: 'parent-1' }))
      await store.add(makeIssue({ id: 'child-2', parentIssueId: 'parent-1' }))
      await store.add(makeIssue({ id: 'other-1' }))

      const children = await store.listChildren('parent-1')
      expect(children).toHaveLength(2)
      expect(children.map((c) => c.id).sort()).toEqual(['child-1', 'child-2'])
    })

    it('returns empty array when parent has no children', async () => {
      await store.add(makeIssue({ id: 'parent-1' }))

      const children = await store.listChildren('parent-1')
      expect(children).toHaveLength(0)
    })

    it('promotes children to top-level when parent is deleted', async () => {
      await store.add(makeIssue({ id: 'parent-1' }))
      await store.add(makeIssue({ id: 'child-1', parentIssueId: 'parent-1' }))
      await store.add(makeIssue({ id: 'child-2', parentIssueId: 'parent-1' }))

      await store.delete('parent-1')

      expect(await store.get('parent-1')).toBeNull()
      expect((await store.get('child-1'))?.parentIssueId).toBeNull()
      expect((await store.get('child-2'))?.parentIssueId).toBeNull()
    })

    it('does not affect unrelated issues when parent is deleted', async () => {
      await store.add(makeIssue({ id: 'parent-1' }))
      await store.add(makeIssue({ id: 'child-1', parentIssueId: 'parent-1' }))
      await store.add(makeIssue({ id: 'unrelated-1' }))

      await store.delete('parent-1')

      expect((await store.get('unrelated-1'))?.parentIssueId).toBeNull()
      expect(await store.list()).toHaveLength(2)
    })

    it('filters by parentIssueId', async () => {
      await store.add(makeIssue({ id: 'p1' }))
      await store.add(makeIssue({ id: 'c1', parentIssueId: 'p1' }))
      await store.add(makeIssue({ id: 'c2', parentIssueId: 'p1' }))
      await store.add(makeIssue({ id: 'p2' }))

      // Filter children of p1
      const children = await store.list({ parentIssueId: 'p1' })
      expect(children).toHaveLength(2)

      // Filter top-level issues only
      const topLevel = await store.list({ parentIssueId: null })
      expect(topLevel).toHaveLength(2)
      expect(topLevel.map((i) => i.id).sort()).toEqual(['p1', 'p2'])
    })

    it('persists data through a second store instance', async () => {
      await store.add(makeIssue({ id: 'parent-1' }))
      await store.add(makeIssue({ id: 'child-1', parentIssueId: 'parent-1' }))

      // Create a second store instance using the same db
      const store2 = new IssueStore(db)

      expect((await store2.get('child-1'))?.parentIssueId).toBe('parent-1')
      expect(await store2.listChildren('parent-1')).toHaveLength(1)
    })
  })

  describe('IssueQueryFilter multi-value queries', () => {
    it('filters by multiple statuses', async () => {
      await store.add(makeIssue({ id: 'a', status: 'todo' }))
      await store.add(makeIssue({ id: 'b', status: 'in_progress' }))
      await store.add(makeIssue({ id: 'c', status: 'done' }))

      const result = await store.list({ statuses: ['todo', 'in_progress'] } as IssueQueryFilter)
      expect(result).toHaveLength(2)
      expect(result.map((i) => i.status)).toEqual(expect.arrayContaining(['todo', 'in_progress']))
    })

    it('filters by multiple priorities', async () => {
      await store.add(makeIssue({ id: 'a', priority: 'urgent' }))
      await store.add(makeIssue({ id: 'b', priority: 'low' }))

      const result = await store.list({ priorities: ['urgent'] } as IssueQueryFilter)
      expect(result).toHaveLength(1)
    })

    it('filters by multiple labels (any match)', async () => {
      await store.add(makeIssue({ id: 'a', labels: ['bug', 'perf'] }))
      await store.add(makeIssue({ id: 'b', labels: ['feature'] }))
      await store.add(makeIssue({ id: 'c', labels: ['bug'] }))

      const result = await store.list({ labels: ['bug', 'feature'] } as IssueQueryFilter)
      expect(result).toHaveLength(3) // a has bug, b has feature, c has bug
    })

    it('filters by time range', async () => {
      const now = Date.now()
      await store.add(makeIssue({ id: 'a', createdAt: now - 100000 }))
      await store.add(makeIssue({ id: 'b', createdAt: now - 500000 }))

      const result = await store.list({ createdAfter: now - 200000 } as IssueQueryFilter)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('a')
    })

    it('filters by session association', async () => {
      await store.add(makeIssue({ id: 'a', sessionId: 'sess-1' }))
      await store.add(makeIssue({ id: 'b', sessionId: null }))

      const withSession = await store.list({ hasSession: true } as IssueQueryFilter)
      expect(withSession).toHaveLength(1)
      expect(withSession[0].id).toBe('a')

      const without = await store.list({ hasSession: false } as IssueQueryFilter)
      expect(without).toHaveLength(1)
      expect(without[0].id).toBe('b')
    })

    it('sorts by specified field and direction', async () => {
      await store.add(makeIssue({ id: 'a', priority: 'low' }))
      await store.add(makeIssue({ id: 'b', priority: 'urgent' }))

      const result = await store.list({ sort: { field: 'priority', order: 'asc' } } as IssueQueryFilter)
      expect(result[0].id).toBe('a') // 'low' comes first in ascending text sort
    })
  })
})
