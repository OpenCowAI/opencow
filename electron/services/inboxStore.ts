// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import type { Database, InboxMessageTable } from '../database/types'
import type {
  InboxMessage,
  InboxMessageStatus,
  InboxFilter,
  InboxStats,
  HookEventMessage,
  SmartReminderMessage,
  InboxNavigationTarget,
} from '../../src/shared/types'
import { formatMessageTitle, formatMessageBody } from '@shared/inboxFormatters'
import { createLogger } from '../platform/logger'

const log = createLogger('InboxStore')

export class InboxStore {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Load all messages — returns them for SmartReminderDetector init.
   * With SQLite the data is always on-disk; this just reads it out.
   */
  async load(): Promise<InboxMessage[]> {
    const rows = await this.db
      .selectFrom('inbox_messages')
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute()

    return mapRowsToMessages(rows, 'load')
  }

  async add(message: InboxMessage): Promise<boolean> {
    const result = await this.db
      .insertInto('inbox_messages')
      .values(messageToRow(message))
      .onConflict((oc) => oc.column('id').doNothing())
      .executeTakeFirst()
    return Number(result.numInsertedOrUpdatedRows ?? 0n) > 0
  }

  async update(id: string, status: InboxMessageStatus): Promise<InboxMessage> {
    const now = Date.now()
    const setClauses: Partial<InboxMessageTable> = { status }

    if (status === 'read') setClauses.read_at = now
    if (status === 'archived') setClauses.archived_at = now

    // Also update the status inside the JSON payload
    const existing = await this.db
      .selectFrom('inbox_messages')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    if (!existing) throw new Error(`Message not found: ${id}`)

    const normalized = rowToMessage(existing)
    if (!normalized) throw new Error(`Message payload is invalid: ${id}`)

    const updated: InboxMessage = { ...normalized, status }
    if (status === 'read') updated.readAt = now
    if (status === 'archived') updated.archivedAt = now
    setClauses.payload = JSON.stringify(updated)

    await this.db
      .updateTable('inbox_messages')
      .set(setClauses)
      .where('id', '=', id)
      .execute()

    return updated
  }

  async dismiss(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('inbox_messages')
      .where('id', '=', id)
      .executeTakeFirst()

    return (result?.numDeletedRows ?? 0n) > 0n
  }

  async markAllRead(): Promise<number> {
    const now = Date.now()

    // Get all unread messages to update their payloads
    const unread = await this.db
      .selectFrom('inbox_messages')
      .selectAll()
      .where('status', '=', 'unread')
      .execute()

    if (unread.length === 0) return 0

    // Update each row's payload + status
    let updatedCount = 0
    for (const row of unread) {
      const normalized = rowToMessage(row)
      if (!normalized) continue
      const updated: InboxMessage = { ...normalized, status: 'read', readAt: now }
      await this.db
        .updateTable('inbox_messages')
        .set({
          status: 'read',
          read_at: now,
          payload: JSON.stringify(updated),
        })
        .where('id', '=', row.id)
        .execute()
      updatedCount += 1
    }

    return updatedCount
  }

  /**
   * Detach all inbox messages from a deleted project by setting project_id to null.
   * Messages are preserved because they carry independent informational value
   * (notifications, reminders) that should remain accessible in the global inbox.
   * @returns Number of detached messages.
   */
  async detachFromProject(projectId: string): Promise<number> {
    const result = await this.db
      .updateTable('inbox_messages')
      .set({ project_id: null })
      .where('project_id', '=', projectId)
      .executeTakeFirst()
    return Number(result?.numUpdatedRows ?? 0n)
  }

  async list(filter?: InboxFilter): Promise<InboxMessage[]> {
    let query = this.db.selectFrom('inbox_messages').selectAll()

    if (filter?.category) {
      query = query.where('category', '=', filter.category)
    }
    if (filter?.status) {
      query = query.where('status', '=', filter.status)
    }
    if (filter?.projectId) {
      query = query.where('project_id', '=', filter.projectId)
    }
    if (filter?.search) {
      // Search is applied in-memory after fetching, since it depends on
      // formatMessageTitle/formatMessageBody which are complex functions.
      const rows = await query.orderBy('created_at', 'desc').execute()
      const q = filter.search.toLowerCase()
      return mapRowsToMessages(rows, 'list:search')
        .filter((m) => {
          const title = formatMessageTitle(m).toLowerCase()
          const body = formatMessageBody(m).toLowerCase()
          return title.includes(q) || body.includes(q)
        })
    }

    const rows = await query.orderBy('created_at', 'desc').execute()
    return mapRowsToMessages(rows, 'list')
  }

  async getStats(): Promise<InboxStats> {
    const result = await this.db
      .selectFrom('inbox_messages')
      .select((eb) => [
        eb.fn.countAll().as('total'),
        eb.fn
          .count('id')
          .filterWhere('status', '=', 'unread')
          .as('unread_count'),
      ])
      .executeTakeFirstOrThrow()

    return {
      total: Number(result.total),
      unreadCount: Number(result.unread_count),
    }
  }

  async compact(): Promise<void> {
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
    const MAX_MESSAGES = 1000
    const cutoff = Date.now() - SEVEN_DAYS

    // Remove old archived messages
    await this.db
      .deleteFrom('inbox_messages')
      .where('status', '=', 'archived')
      .where('archived_at', '<', cutoff)
      .execute()

    // Trim excess read messages (oldest first) if over limit
    const countResult = await this.db
      .selectFrom('inbox_messages')
      .select((eb) => eb.fn.countAll().as('count'))
      .executeTakeFirstOrThrow()

    const total = Number(countResult.count)
    if (total > MAX_MESSAGES) {
      const toRemove = total - MAX_MESSAGES
      // Subquery: select oldest read message IDs to delete
      await this.db
        .deleteFrom('inbox_messages')
        .where(
          'id',
          'in',
          this.db
            .selectFrom('inbox_messages')
            .select('id')
            .where('status', '=', 'read')
            .orderBy('created_at', 'asc')
            .limit(toRemove),
        )
        .execute()
    }
  }
}

// ─── Row ↔ Domain object mappers ─────────────────────────────────────────

function rowToMessage(row: InboxMessageTable): InboxMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.payload)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const candidate = parsed as Record<string, unknown>
  if (candidate.category === 'hook_event') {
    const normalized = normalizeHookEventMessage(candidate, row)
    return normalized
  }
  if (candidate.category === 'smart_reminder') {
    return normalizeSmartReminderMessage(candidate, row)
  }
  return null
}

function messageToRow(msg: InboxMessage): InboxMessageTable {
  const isHookEvent = msg.category === 'hook_event'
  const hookMsg = isHookEvent ? (msg as HookEventMessage) : null
  const reminderMsg = !isHookEvent ? (msg as SmartReminderMessage) : null
  const route = hookMsg?.navigationTarget
  const routeCols = routeToColumns(route)

  return {
    id: msg.id,
    category: msg.category,
    status: msg.status,
    event_type: hookMsg?.eventType ?? null,
    reminder_type: reminderMsg?.reminderType ?? null,
    project_id: hookMsg?.projectId ?? null,
    session_id: hookMsg?.sessionId ?? null,
    route_kind: routeCols.route_kind,
    route_issue_id: routeCols.route_issue_id,
    route_session_id: routeCols.route_session_id,
    route_schedule_id: routeCols.route_schedule_id,
    payload: JSON.stringify(msg),
    created_at: msg.createdAt,
    read_at: msg.readAt ?? null,
    archived_at: msg.archivedAt ?? null,
  }
}

function normalizeHookEventMessage(
  candidate: Record<string, unknown>,
  row: InboxMessageTable,
): HookEventMessage | null {
  const projectId =
    typeof candidate.projectId === 'string' || candidate.projectId === null
      ? (candidate.projectId as string | null)
      : row.project_id
  const sessionId =
    typeof candidate.sessionId === 'string'
      ? candidate.sessionId
      : row.session_id

  if (typeof sessionId !== 'string' || sessionId.length === 0) return null

  const targetFromPayload = toNavigationTarget(candidate.navigationTarget)
  const targetFromRow = toNavigationTargetFromRow(row)
  const fallbackTarget =
    projectId
      ? ({ kind: 'session', projectId, sessionId } as const)
      : null

  const navigationTarget = targetFromPayload ?? targetFromRow ?? fallbackTarget
  if (!navigationTarget) return null

  return {
    id: typeof candidate.id === 'string' ? candidate.id : row.id,
    category: 'hook_event',
    eventType: (candidate.eventType as HookEventMessage['eventType']) ?? (row.event_type as HookEventMessage['eventType']),
    status: (candidate.status as HookEventMessage['status']) ?? (row.status as HookEventMessage['status']),
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : row.created_at,
    readAt: typeof candidate.readAt === 'number' ? candidate.readAt : row.read_at ?? undefined,
    archivedAt: typeof candidate.archivedAt === 'number' ? candidate.archivedAt : row.archived_at ?? undefined,
    projectId,
    sessionId,
    navigationTarget,
    rawPayload: (candidate.rawPayload as Record<string, unknown>) ?? {},
  }
}

function normalizeSmartReminderMessage(
  candidate: Record<string, unknown>,
  row: InboxMessageTable,
): SmartReminderMessage | null {
  const reminderType =
    typeof candidate.reminderType === 'string'
      ? candidate.reminderType
      : row.reminder_type

  if (typeof reminderType !== 'string' || reminderType.length === 0) return null
  if (!candidate.context || typeof candidate.context !== 'object') return null

  return {
    id: typeof candidate.id === 'string' ? candidate.id : row.id,
    category: 'smart_reminder',
    reminderType: reminderType as SmartReminderMessage['reminderType'],
    status: (candidate.status as SmartReminderMessage['status']) ?? (row.status as SmartReminderMessage['status']),
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : row.created_at,
    readAt: typeof candidate.readAt === 'number' ? candidate.readAt : row.read_at ?? undefined,
    archivedAt: typeof candidate.archivedAt === 'number' ? candidate.archivedAt : row.archived_at ?? undefined,
    context: candidate.context as SmartReminderMessage['context'],
  }
}

function toNavigationTarget(value: unknown): InboxNavigationTarget | null {
  if (!value || typeof value !== 'object') return null
  const route = value as Record<string, unknown>
  if (route.kind === 'issue') {
    if (typeof route.projectId === 'string' && typeof route.issueId === 'string') {
      return { kind: 'issue', projectId: route.projectId, issueId: route.issueId }
    }
    return null
  }
  if (route.kind === 'session') {
    if (typeof route.projectId === 'string' && typeof route.sessionId === 'string') {
      return { kind: 'session', projectId: route.projectId, sessionId: route.sessionId }
    }
    return null
  }
  if (route.kind === 'schedule') {
    if (typeof route.scheduleId === 'string') {
      return { kind: 'schedule', scheduleId: route.scheduleId }
    }
    return null
  }
  return null
}

function toNavigationTargetFromRow(row: InboxMessageTable): InboxNavigationTarget | null {
  if (row.route_kind === 'issue') {
    if (row.project_id && row.route_issue_id) {
      return { kind: 'issue', projectId: row.project_id, issueId: row.route_issue_id }
    }
    return null
  }
  if (row.route_kind === 'session') {
    if (row.project_id && row.route_session_id) {
      return { kind: 'session', projectId: row.project_id, sessionId: row.route_session_id }
    }
    return null
  }
  if (row.route_kind === 'schedule') {
    if (row.route_schedule_id) {
      return { kind: 'schedule', scheduleId: row.route_schedule_id }
    }
    return null
  }
  return null
}

function routeToColumns(route: InboxNavigationTarget | undefined): Pick<InboxMessageTable, 'route_kind' | 'route_issue_id' | 'route_session_id' | 'route_schedule_id'> {
  if (!route) {
    return {
      route_kind: null,
      route_issue_id: null,
      route_session_id: null,
      route_schedule_id: null,
    }
  }
  switch (route.kind) {
    case 'issue':
      return {
        route_kind: 'issue',
        route_issue_id: route.issueId,
        route_session_id: null,
        route_schedule_id: null,
      }
    case 'session':
      return {
        route_kind: 'session',
        route_issue_id: null,
        route_session_id: route.sessionId,
        route_schedule_id: null,
      }
    case 'schedule':
      return {
        route_kind: 'schedule',
        route_issue_id: null,
        route_session_id: null,
        route_schedule_id: route.scheduleId,
      }
  }
}

function mapRowsToMessages(rows: InboxMessageTable[], source: string): InboxMessage[] {
  const messages: InboxMessage[] = []
  let dropped = 0

  for (const row of rows) {
    const message = rowToMessage(row)
    if (message) {
      messages.push(message)
    } else {
      dropped += 1
    }
  }

  if (dropped > 0) {
    log.warn('Dropped invalid inbox rows while mapping from database', {
      source,
      dropped,
      total: rows.length,
    })
  }

  return messages
}
