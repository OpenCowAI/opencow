// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import type { Database, IssueViewTable } from '../database/types'
import type {
  IssueView,
  CreateIssueViewInput,
  UpdateIssueViewInput,
  ViewFilters,
  ViewDisplayConfig,
} from '../../src/shared/types'

export class IssueViewStore {
  constructor(private readonly db: Kysely<Database>) {}

  async list(): Promise<IssueView[]> {
    const rows = await this.db
      .selectFrom('issue_views')
      .selectAll()
      .orderBy('position', 'asc')
      .execute()
    return rows.map(rowToView)
  }

  async create(input: CreateIssueViewInput): Promise<IssueView> {
    const now = Date.now()
    const maxPos = await this.db
      .selectFrom('issue_views')
      .select((eb) => eb.fn.max('position').as('maxPos'))
      .executeTakeFirst()
    const position = ((maxPos?.maxPos as number | null) ?? -1) + 1

    const row: IssueViewTable = {
      id: randomUUID(),
      name: input.name,
      icon: input.icon,
      filters: JSON.stringify(input.filters),
      display: JSON.stringify(input.display),
      position,
      created_at: now,
      updated_at: now,
    }

    await this.db.insertInto('issue_views').values(row).execute()
    return rowToView(row)
  }

  async update(id: string, patch: UpdateIssueViewInput): Promise<IssueView | null> {
    const existing = await this.db
      .selectFrom('issue_views')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    if (!existing) return null

    const updates: Partial<IssueViewTable> = { updated_at: Date.now() }
    if (patch.name !== undefined) updates.name = patch.name
    if (patch.icon !== undefined) updates.icon = patch.icon
    if (patch.filters !== undefined) updates.filters = JSON.stringify(patch.filters)
    if (patch.display !== undefined) updates.display = JSON.stringify(patch.display)

    await this.db.updateTable('issue_views').set(updates).where('id', '=', id).execute()

    const updated = await this.db
      .selectFrom('issue_views')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return updated ? rowToView(updated) : null
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('issue_views')
      .where('id', '=', id)
      .executeTakeFirst()
    if (!result.numDeletedRows) return false

    // Re-order positions to fill the gap
    const remaining = await this.db
      .selectFrom('issue_views')
      .select(['id'])
      .orderBy('position', 'asc')
      .execute()
    for (let i = 0; i < remaining.length; i++) {
      await this.db
        .updateTable('issue_views')
        .set({ position: i })
        .where('id', '=', remaining[i].id)
        .execute()
    }
    return true
  }

  async reorder(orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await this.db
        .updateTable('issue_views')
        .set({ position: i })
        .where('id', '=', orderedIds[i])
        .execute()
    }
  }

  // ── Label lifecycle cascade ────────────────────────────────────────

  /**
   * Remove a deleted label from every view's `filters.labels`.
   *
   * Called when a custom label is deleted — ensures no view silently
   * retains a "phantom" reference to a label that no longer exists.
   * Returns the number of views that were updated.
   */
  async purgeLabel(label: string): Promise<number> {
    return this.mutateViewLabels((labels) => {
      const idx = labels.indexOf(label)
      if (idx === -1) return null       // not referenced — skip
      const next = labels.filter((l) => l !== label)
      return next.length > 0 ? next : undefined // undefined = delete key
    })
  }

  /**
   * Rename a label across every view's `filters.labels`.
   *
   * Called when a custom label is renamed — keeps views in sync with
   * the label registry so filter UIs and queries stay consistent.
   * Returns the number of views that were updated.
   */
  async renameLabel(oldLabel: string, newLabel: string): Promise<number> {
    return this.mutateViewLabels((labels) => {
      const idx = labels.indexOf(oldLabel)
      if (idx === -1) return null       // not referenced — skip
      const next = labels.map((l) => (l === oldLabel ? newLabel : l))
      // Deduplicate: newLabel may already be present
      return [...new Set(next)]
    })
  }

  // ── Internals ──────────────────────────────────────────────────────

  /**
   * Iterate all views and apply `transform` to each view's `filters.labels`.
   *
   * `transform(labels)` returns:
   *   - `null`        → skip (label not referenced in this view)
   *   - `undefined`   → remove the `labels` key entirely (was the only label)
   *   - `string[]`    → replacement labels array
   */
  private async mutateViewLabels(
    transform: (labels: string[]) => string[] | undefined | null,
  ): Promise<number> {
    const rows = await this.db
      .selectFrom('issue_views')
      .select(['id', 'filters'])
      .execute()

    let updated = 0
    for (const row of rows) {
      const filters = safeJsonParse<ViewFilters>(row.filters, {})
      if (!filters.labels || filters.labels.length === 0) continue

      const result = transform(filters.labels)
      if (result === null) continue // not affected

      const updatedFilters = { ...filters }
      if (result === undefined) {
        delete updatedFilters.labels
      } else {
        updatedFilters.labels = result
      }

      await this.db
        .updateTable('issue_views')
        .set({ filters: JSON.stringify(updatedFilters), updated_at: Date.now() })
        .where('id', '=', row.id)
        .execute()
      updated++
    }
    return updated
  }
}

function rowToView(row: IssueViewTable): IssueView {
  const filters = safeJsonParse<ViewFilters>(row.filters, {})

  // Sanitize: strip empty arrays that may have been persisted.
  // Semantically [] and undefined both mean "no constraint" (match all),
  // but downstream intersection logic can treat [] as "match nothing".
  if (filters.statuses && filters.statuses.length === 0) delete filters.statuses
  if (filters.priorities && filters.priorities.length === 0) delete filters.priorities
  if (filters.labels && filters.labels.length === 0) delete filters.labels

  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    filters,
    display: safeJsonParse<ViewDisplayConfig>(row.display, {
      groupBy: null,
      sort: { field: 'updatedAt', order: 'desc' },
    }),
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}
