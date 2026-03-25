// SPDX-License-Identifier: Apache-2.0

import { sql, type Kysely, type SelectQueryBuilder } from 'kysely'
import type { Database, IssueTable } from '../database/types'
import type { Issue, IssueSummary, IssueFilter, IssueQueryFilter, IssueImage, SortConfig, ContextRef } from '../../src/shared/types'

/** Options for {@link IssueStore.update}. */
export interface IssueUpdateOptions {
  /**
   * When true, `updated_at` is NOT bumped.
   * Use this for metadata-only writes (e.g. marking an issue as read)
   * that should not affect sort order or modification semantics.
   */
  skipTimestamp?: boolean
}

/**
 * Columns selected for lightweight list queries.
 * Excludes heavy fields: description, images, session_history.
 */
const SUMMARY_COLUMNS = [
  'id', 'title', 'status', 'priority', 'labels',
  'project_id', 'session_id', 'parent_issue_id',
  'created_at', 'updated_at', 'read_at', 'last_agent_activity_at',
] as const

/** Row shape returned by summary queries (only the lightweight columns). */
type IssueSummaryRow = Pick<IssueTable, typeof SUMMARY_COLUMNS[number]>

export class IssueStore {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * No-op for SQLite — kept for API compatibility with IssueService.start().
   * Migrations handle schema creation; data is always on-disk.
   */
  async load(): Promise<void> {
    // intentionally empty
  }

  async add(issue: Issue): Promise<void> {
    await this.db
      .insertInto('issues')
      .values(issueToRow(issue))
      .execute()
  }

  async update(id: string, patch: Partial<Issue>, opts?: IssueUpdateOptions): Promise<Issue | null> {
    const setClauses = patchToRow(patch)
    if (Object.keys(setClauses).length === 0 && !patch.updatedAt) {
      // Nothing to update — just return current
      return this.get(id)
    }

    await this.db
      .updateTable('issues')
      .set({
        ...setClauses,
        ...(opts?.skipTimestamp ? {} : { updated_at: Date.now() })
      })
      .where('id', '=', id)
      .execute()

    return this.get(id)
  }

  async delete(id: string): Promise<boolean> {
    // Promote orphaned children to top-level
    await this.db
      .updateTable('issues')
      .set({ parent_issue_id: null, updated_at: Date.now() })
      .where('parent_issue_id', '=', id)
      .execute()

    const result = await this.db
      .deleteFrom('issues')
      .where('id', '=', id)
      .executeTakeFirst()

    return (result?.numDeletedRows ?? 0n) > 0n
  }

  /**
   * Delete all issues belonging to a project.
   * Called during project deletion to maintain data integrity.
   * Note: issue_context_refs and session_notes are cleaned up automatically
   * via ON DELETE CASCADE on issue_id.
   * @returns Number of deleted issues.
   */
  async deleteByProjectId(projectId: string): Promise<number> {
    const result = await this.db
      .deleteFrom('issues')
      .where('project_id', '=', projectId)
      .executeTakeFirst()
    return Number(result?.numDeletedRows ?? 0n)
  }

  async get(id: string): Promise<Issue | null> {
    const row = await this.db
      .selectFrom('issues')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    return row ? rowToIssue(row) : null
  }

  // ─── Filtered queries ──────────────────────────────────────────────────

  /**
   * List full issue objects (all columns).
   * Use {@link listSummaries} for list views — it excludes heavy fields.
   */
  async list(filter?: IssueFilter | IssueQueryFilter): Promise<Issue[]> {
    let query = this.db.selectFrom('issues').selectAll()
    query = applyFilters(query, filter)
    query = applySortOrder(query, filter)
    const rows = await query.execute()
    return rows.map(rowToIssue)
  }

  /**
   * List lightweight issue summaries for list views.
   * Excludes heavy columns (description, images, session_history)
   * to minimize data transfer over IPC.
   */
  async listSummaries(filter?: IssueFilter | IssueQueryFilter): Promise<IssueSummary[]> {
    let query = this.db.selectFrom('issues').select([...SUMMARY_COLUMNS])
    query = applyFilters(query, filter)
    query = applySortOrder(query, filter)
    const rows = await query.execute()
    return rows.map(rowToIssueSummary)
  }

  /**
   * Count issues matching filter criteria.
   * Shares the same filter logic as list/listSummaries via {@link applyFilters}.
   */
  async count(filter?: IssueFilter | IssueQueryFilter): Promise<number> {
    let query = this.db
      .selectFrom('issues')
      .select(sql<number>`count(*)`.as('cnt'))
    query = applyFilters(query, filter)
    // No sort needed for count queries
    const result = await query.executeTakeFirst()
    return Number(result?.cnt ?? 0)
  }

  /** Find the most recently updated issue summary linked to any of the given session IDs. */
  async findLatestSummaryBySessionIds(sessionIds: string[]): Promise<IssueSummary | null> {
    if (sessionIds.length === 0) return null
    const rows = await this.db
      .selectFrom('issues')
      .select([...SUMMARY_COLUMNS])
      .where('session_id', 'in', sessionIds)
      .orderBy('updated_at', 'desc')
      .limit(1)
      .execute()
    return rows.length > 0 ? rowToIssueSummary(rows[0]) : null
  }

  /** List full child issues (all columns) for a parent. */
  async listChildren(parentId: string): Promise<Issue[]> {
    const rows = await this.db
      .selectFrom('issues')
      .selectAll()
      .where('parent_issue_id', '=', parentId)
      .orderBy('updated_at', 'desc')
      .execute()

    return rows.map(rowToIssue)
  }

  /** List lightweight child issue summaries for a parent. */
  async listChildrenSummaries(parentId: string): Promise<IssueSummary[]> {
    const rows = await this.db
      .selectFrom('issues')
      .select([...SUMMARY_COLUMNS])
      .where('parent_issue_id', '=', parentId)
      .orderBy('updated_at', 'desc')
      .execute()

    return rows.map(rowToIssueSummary)
  }

  async listWithActiveSession(): Promise<Issue[]> {
    const rows = await this.db
      .selectFrom('issues')
      .selectAll()
      .where('session_id', 'is not', null)
      .orderBy('updated_at', 'desc')
      .execute()
    return rows.map(rowToIssue)
  }

  async getCustomLabels(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('custom_labels')
      .select('label')
      .execute()

    return rows.map((r) => r.label)
  }

  async addCustomLabel(label: string): Promise<string[]> {
    await this.db
      .insertInto('custom_labels')
      .values({ label })
      .onConflict((oc) => oc.column('label').doNothing())
      .execute()

    return this.getCustomLabels()
  }

  async deleteCustomLabel(label: string): Promise<string[]> {
    // 1. Remove the label from the registry
    await this.db
      .deleteFrom('custom_labels')
      .where('label', '=', label)
      .execute()

    // 2. Remove the label from all issues that reference it
    const rows = await this.db
      .selectFrom('issues')
      .select(['id', 'labels'])
      .execute()

    for (const row of rows) {
      const parsed: string[] = row.labels ? JSON.parse(row.labels as string) : []
      if (parsed.includes(label)) {
        const updated = parsed.filter((l) => l !== label)
        await this.db
          .updateTable('issues')
          .set({ labels: JSON.stringify(updated) })
          .where('id', '=', row.id)
          .execute()
      }
    }

    return this.getCustomLabels()
  }

  async updateCustomLabel(oldLabel: string, newLabel: string): Promise<string[]> {
    // 1. Insert the new label (ignore if already exists)
    await this.db
      .insertInto('custom_labels')
      .values({ label: newLabel })
      .onConflict((oc) => oc.column('label').doNothing())
      .execute()

    // 2. Remove the old label
    await this.db
      .deleteFrom('custom_labels')
      .where('label', '=', oldLabel)
      .execute()

    // 3. Rename the label in all issues that reference it
    const rows = await this.db
      .selectFrom('issues')
      .select(['id', 'labels'])
      .execute()

    for (const row of rows) {
      const parsed: string[] = row.labels ? JSON.parse(row.labels as string) : []
      if (parsed.includes(oldLabel)) {
        const updated = parsed.map((l) => (l === oldLabel ? newLabel : l))
        // Deduplicate in case newLabel already existed in the array
        const deduped = [...new Set(updated)]
        await this.db
          .updateTable('issues')
          .set({ labels: JSON.stringify(deduped) })
          .where('id', '=', row.id)
          .execute()
      }
    }

    return this.getCustomLabels()
  }

  /**
   * Ensure all given labels exist in the `custom_labels` registry.
   *
   * Called automatically by IssueService on create/update so that labels
   * originating from any entry point (UI form, MCP tool, API) are always
   * discoverable in filter/picker UIs.  Uses ON CONFLICT DO NOTHING for
   * idempotent, conflict-free bulk insertion.
   */
  async syncLabels(labels: string[]): Promise<void> {
    if (labels.length === 0) return

    for (const label of labels) {
      await this.db
        .insertInto('custom_labels')
        .values({ label })
        .onConflict((oc) => oc.column('label').doNothing())
        .execute()
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Escape LIKE wildcard characters (`%`, `_`, `\`) so they match literally. */
function escapeLikePattern(pattern: string): string {
  return pattern.replace(/[%_\\]/g, '\\$&')
}

// ─── Shared filter/sort logic ──────────────────────────────────────────────
//
// Extracted into standalone functions so that list(), listSummaries(), and
// count() share the exact same WHERE-clause logic without duplication.
// The generic type parameter Q preserves the specific SelectQueryBuilder
// variant (selectAll vs select vs select-count) through the call chain.

/** Apply all WHERE clauses derived from filter options. */
function applyFilters<Q extends SelectQueryBuilder<Database, 'issues', Record<string, unknown>>>(
  query: Q,
  filter?: IssueFilter | IssueQueryFilter,
): Q {
  const qf = filter as IssueQueryFilter | undefined

  // ── Multi-value filters ──────────────────────────────────────────
  if (qf?.statuses && qf.statuses.length > 0) {
    query = query.where('status', 'in', qf.statuses) as Q
  } else if ((filter as IssueFilter | undefined)?.status) {
    query = query.where('status', '=', (filter as IssueFilter).status!) as Q
  }

  if (qf?.priorities && qf.priorities.length > 0) {
    query = query.where('priority', 'in', qf.priorities) as Q
  } else if ((filter as IssueFilter | undefined)?.priority) {
    query = query.where('priority', '=', (filter as IssueFilter).priority!) as Q
  }

  if (qf?.labels && qf.labels.length > 0) {
    query = query.where(
      sql<boolean>`EXISTS (SELECT 1 FROM json_each(${sql.ref('issues.labels')}) WHERE value IN (${sql.join(qf.labels.map((l) => sql.lit(l)))}))`,
    ) as Q
  } else if ((filter as IssueFilter | undefined)?.label) {
    query = query.where(
      sql<boolean>`EXISTS (SELECT 1 FROM json_each(${sql.ref('issues.labels')}) WHERE value = ${(filter as IssueFilter).label!})`,
    ) as Q
  }

  if (filter?.projectId) {
    query = query.where('project_id', '=', filter.projectId) as Q
  }

  if (filter?.search) {
    const term = `%${escapeLikePattern(filter.search)}%`
    query = query.where(
      sql<boolean>`(title LIKE ${term} ESCAPE '\\' OR description LIKE ${term} ESCAPE '\\')`,
    ) as Q
  }

  // undefined = no filter, null = top-level only, string = children of parent
  if (filter?.parentIssueId !== undefined) {
    if (filter.parentIssueId === null) {
      query = query.where('parent_issue_id', 'is', null) as Q
    } else {
      query = query.where('parent_issue_id', '=', filter.parentIssueId) as Q
    }
  }

  // ── Time range filters ──────────────────────────────────────────
  if (qf?.createdAfter) {
    query = query.where('created_at', '>=', qf.createdAfter) as Q
  }
  if (qf?.createdBefore) {
    query = query.where('created_at', '<=', qf.createdBefore) as Q
  }
  if (qf?.updatedAfter) {
    query = query.where('updated_at', '>=', qf.updatedAfter) as Q
  }
  if (qf?.updatedBefore) {
    query = query.where('updated_at', '<=', qf.updatedBefore) as Q
  }

  // ── Session filters ─────────────────────────────────────────────
  if (qf?.hasSession === true) {
    query = query.where('session_id', 'is not', null) as Q
  } else if (qf?.hasSession === false) {
    query = query.where('session_id', 'is', null) as Q
  }

  if (qf?.sessionIds && qf.sessionIds.length > 0) {
    query = query.where('session_id', 'in', qf.sessionIds) as Q
  }

  return query
}

/** Apply ORDER BY clause derived from filter options. */
function applySortOrder<Q extends SelectQueryBuilder<Database, 'issues', Record<string, unknown>>>(
  query: Q,
  filter?: IssueFilter | IssueQueryFilter,
): Q {
  const sort: SortConfig | undefined = (filter as IssueQueryFilter | undefined)?.sort
  if (sort) {
    const columnMap: Record<SortConfig['field'], string> = {
      priority: 'priority',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      status: 'status',
    }
    const col = columnMap[sort.field] ?? 'updated_at'
    return query.orderBy(col as keyof IssueTable, sort.order) as Q
  }
  return query.orderBy('updated_at', 'desc') as Q
}

// ─── Row ↔ Domain object mappers ─────────────────────────────────────────

function rowToIssue(row: IssueTable): Issue {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    richContent: row.rich_content,
    status: row.status as Issue['status'],
    priority: row.priority as Issue['priority'],
    labels: JSON.parse(row.labels) as string[],
    projectId: row.project_id,
    sessionId: row.session_id,
    sessionHistory: JSON.parse(row.session_history) as string[],
    parentIssueId: row.parent_issue_id,
    images: JSON.parse(row.images) as IssueImage[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readAt: row.read_at,
    lastAgentActivityAt: row.last_agent_activity_at,
    contextRefs: [] as ContextRef[],  // loaded separately by IssueService when needed
  }
}

/** Map a lightweight summary row to an IssueSummary domain object. */
function rowToIssueSummary(row: IssueSummaryRow): IssueSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as IssueSummary['status'],
    priority: row.priority as IssueSummary['priority'],
    labels: JSON.parse(row.labels) as string[],
    projectId: row.project_id,
    sessionId: row.session_id,
    parentIssueId: row.parent_issue_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readAt: row.read_at,
    lastAgentActivityAt: row.last_agent_activity_at,
  }
}

function issueToRow(issue: Issue): IssueTable {
  return {
    id: issue.id,
    title: issue.title,
    description: issue.description,
    rich_content: issue.richContent,
    status: issue.status,
    priority: issue.priority,
    labels: JSON.stringify(issue.labels),
    project_id: issue.projectId,
    session_id: issue.sessionId,
    session_history: JSON.stringify(issue.sessionHistory),
    parent_issue_id: issue.parentIssueId,
    images: JSON.stringify(issue.images),
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    read_at: issue.readAt,
    last_agent_activity_at: issue.lastAgentActivityAt,
  }
}

function patchToRow(patch: Partial<Issue>): Partial<IssueTable> {
  const row: Partial<IssueTable> = {}

  if (patch.title !== undefined) row.title = patch.title
  if (patch.description !== undefined) row.description = patch.description
  if (patch.richContent !== undefined) row.rich_content = patch.richContent
  if (patch.status !== undefined) row.status = patch.status
  if (patch.priority !== undefined) row.priority = patch.priority
  if (patch.labels !== undefined) row.labels = JSON.stringify(patch.labels)
  if (patch.projectId !== undefined) row.project_id = patch.projectId
  if (patch.sessionId !== undefined) row.session_id = patch.sessionId
  if (patch.sessionHistory !== undefined) row.session_history = JSON.stringify(patch.sessionHistory)
  if (patch.parentIssueId !== undefined) row.parent_issue_id = patch.parentIssueId
  if (patch.images !== undefined) row.images = JSON.stringify(patch.images)
  if (patch.readAt !== undefined) row.read_at = patch.readAt
  if (patch.lastAgentActivityAt !== undefined) row.last_agent_activity_at = patch.lastAgentActivityAt

  return row
}
