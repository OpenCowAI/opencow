// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Kysely } from 'kysely'
import { createTestDb } from '../../helpers/testDb'
import { IssueViewStore } from '../../../electron/services/issueViewStore'
import type { Database } from '../../../electron/database/types'
import type { CreateIssueViewInput } from '../../../src/shared/types'

const sampleInput: CreateIssueViewInput = {
  name: 'High Priority Bugs',
  icon: '🔴',
  filters: { statuses: ['todo', 'in_progress'], priorities: ['urgent', 'high'], labels: ['bug'] },
  display: { groupBy: 'status', sort: { field: 'priority', order: 'asc' } },
}

describe('IssueViewStore', () => {
  let db: Kysely<Database>
  let close: () => Promise<void>
  let store: IssueViewStore

  beforeEach(async () => {
    ({ db, close } = await createTestDb())
    store = new IssueViewStore(db)
  })
  afterEach(async () => { await close() })

  describe('create + list', () => {
    it('creates a view and lists it', async () => {
      const view = await store.create(sampleInput)
      expect(view.name).toBe('High Priority Bugs')
      expect(view.icon).toBe('🔴')
      expect(view.filters.statuses).toEqual(['todo', 'in_progress'])
      expect(view.position).toBe(0)

      const list = await store.list()
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe(view.id)
    })

    it('auto-increments position', async () => {
      await store.create(sampleInput)
      const second = await store.create({ ...sampleInput, name: 'Second' })
      expect(second.position).toBe(1)
    })
  })

  describe('update', () => {
    it('updates name and filter criteria', async () => {
      const view = await store.create(sampleInput)
      const updated = await store.update(view.id, { name: 'Renamed', filters: { statuses: ['done'] } })
      expect(updated?.name).toBe('Renamed')
      expect(updated?.filters.statuses).toEqual(['done'])
      expect(updated?.icon).toBe('🔴') // unchanged
    })

    it('returns null for non-existent view', async () => {
      const result = await store.update('non-existent', { name: 'Nope' })
      expect(result).toBeNull()
    })
  })

  describe('delete', () => {
    it('deletes a view and re-orders positions', async () => {
      const a = await store.create({ ...sampleInput, name: 'A' })
      const b = await store.create({ ...sampleInput, name: 'B' })
      const _c = await store.create({ ...sampleInput, name: 'C' })

      await store.delete(b.id)
      const list = await store.list()
      expect(list).toHaveLength(2)
      expect(list[0].name).toBe('A')
      expect(list[0].position).toBe(0)
      expect(list[1].name).toBe('C')
      expect(list[1].position).toBe(1)
    })
  })

  describe('reorder', () => {
    it('reorders views by ID array', async () => {
      const a = await store.create({ ...sampleInput, name: 'A' })
      const b = await store.create({ ...sampleInput, name: 'B' })
      const c = await store.create({ ...sampleInput, name: 'C' })

      await store.reorder([c.id, a.id, b.id])
      const list = await store.list()
      expect(list.map((v) => v.name)).toEqual(['C', 'A', 'B'])
    })
  })
})
