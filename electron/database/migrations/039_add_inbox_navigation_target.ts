// SPDX-License-Identifier: Apache-2.0

import { sql, type Kysely } from 'kysely'

type MigrationDatabase = {
  inbox_messages: {
    id: string
    category: string
    project_id: string | null
    session_id: string | null
    route_kind: string | null
    route_issue_id: string | null
    route_session_id: string | null
    route_schedule_id: string | null
    payload: string
  }
}

type LegacyInboxRow = {
  id: string
  category: string
  project_id: string | null
  session_id: string | null
  payload: string
}

type RouteCols = {
  routeKind: string | null
  routeIssueId: string | null
  routeSessionId: string | null
  routeScheduleId: string | null
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function normalizeRouteFromPayload(payload: unknown): RouteCols | null {
  if (!payload || typeof payload !== 'object') return null
  const route = (payload as Record<string, unknown>).navigationTarget
  if (!route || typeof route !== 'object') return null

  const kind = (route as Record<string, unknown>).kind
  if (kind === 'issue') {
    const issueId = (route as Record<string, unknown>).issueId
    if (!hasNonEmptyString(issueId)) return null
    return {
      routeKind: 'issue',
      routeIssueId: issueId,
      routeSessionId: null,
      routeScheduleId: null,
    }
  }
  if (kind === 'session') {
    const sessionId = (route as Record<string, unknown>).sessionId
    if (!hasNonEmptyString(sessionId)) return null
    return {
      routeKind: 'session',
      routeIssueId: null,
      routeSessionId: sessionId,
      routeScheduleId: null,
    }
  }
  if (kind === 'schedule') {
    const scheduleId = (route as Record<string, unknown>).scheduleId
    if (!hasNonEmptyString(scheduleId)) return null
    return {
      routeKind: 'schedule',
      routeIssueId: null,
      routeSessionId: null,
      routeScheduleId: scheduleId,
    }
  }
  return null
}

function deriveLegacyRoute(row: LegacyInboxRow): RouteCols | null {
  if (row.category !== 'hook_event') return null
  if (hasNonEmptyString(row.project_id) && hasNonEmptyString(row.session_id)) {
    return {
      routeKind: 'session',
      routeIssueId: null,
      routeSessionId: row.session_id,
      routeScheduleId: null,
    }
  }
  return null
}

function withInjectedNavigationTarget(payload: unknown, route: RouteCols, row: LegacyInboxRow): string | null {
  if (row.category !== 'hook_event') return null
  if (!payload || typeof payload !== 'object') return null
  if ((payload as Record<string, unknown>).navigationTarget !== undefined) return null
  if (!route.routeKind) return null

  const mutable = { ...(payload as Record<string, unknown>) }
  if (route.routeKind === 'issue' && hasNonEmptyString(route.routeIssueId) && hasNonEmptyString(row.project_id)) {
    mutable.navigationTarget = { kind: 'issue', projectId: row.project_id, issueId: route.routeIssueId }
  } else if (route.routeKind === 'session' && hasNonEmptyString(route.routeSessionId) && hasNonEmptyString(row.project_id)) {
    mutable.navigationTarget = { kind: 'session', projectId: row.project_id, sessionId: route.routeSessionId }
  } else if (route.routeKind === 'schedule' && hasNonEmptyString(route.routeScheduleId)) {
    mutable.navigationTarget = { kind: 'schedule', scheduleId: route.routeScheduleId }
  } else {
    return null
  }

  return JSON.stringify(mutable)
}

/**
 * Migration 039 — Add canonical inbox navigation target columns.
 *
 * This makes inbox jumps deterministic by persisting the target route at
 * classification time, rather than re-deriving it from volatile runtime state.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const typedDb = db as Kysely<MigrationDatabase>

  await typedDb.schema
    .alterTable('inbox_messages')
    .addColumn('route_kind', 'text')
    .execute()

  await typedDb.schema
    .alterTable('inbox_messages')
    .addColumn('route_issue_id', 'text')
    .execute()

  await typedDb.schema
    .alterTable('inbox_messages')
    .addColumn('route_session_id', 'text')
    .execute()

  await typedDb.schema
    .alterTable('inbox_messages')
    .addColumn('route_schedule_id', 'text')
    .execute()

  await typedDb.schema
    .createIndex('idx_inbox_route_kind')
    .on('inbox_messages')
    .column('route_kind')
    .execute()

  // Enforce route column consistency at DB level (SQLite CHECK can't be added via ALTER TABLE).
  await sql`
    CREATE TRIGGER trg_inbox_route_columns_insert
    BEFORE INSERT ON inbox_messages
    WHEN NOT (
      (NEW.route_kind IS NULL AND NEW.route_issue_id IS NULL AND NEW.route_session_id IS NULL AND NEW.route_schedule_id IS NULL)
      OR (NEW.route_kind = 'issue' AND NEW.route_issue_id IS NOT NULL AND NEW.route_session_id IS NULL AND NEW.route_schedule_id IS NULL)
      OR (NEW.route_kind = 'session' AND NEW.route_issue_id IS NULL AND NEW.route_session_id IS NOT NULL AND NEW.route_schedule_id IS NULL)
      OR (NEW.route_kind = 'schedule' AND NEW.route_issue_id IS NULL AND NEW.route_session_id IS NULL AND NEW.route_schedule_id IS NOT NULL)
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid inbox route columns');
    END;
  `.execute(typedDb)

  await sql`
    CREATE TRIGGER trg_inbox_route_columns_update
    BEFORE UPDATE ON inbox_messages
    WHEN NOT (
      (NEW.route_kind IS NULL AND NEW.route_issue_id IS NULL AND NEW.route_session_id IS NULL AND NEW.route_schedule_id IS NULL)
      OR (NEW.route_kind = 'issue' AND NEW.route_issue_id IS NOT NULL AND NEW.route_session_id IS NULL AND NEW.route_schedule_id IS NULL)
      OR (NEW.route_kind = 'session' AND NEW.route_issue_id IS NULL AND NEW.route_session_id IS NOT NULL AND NEW.route_schedule_id IS NULL)
      OR (NEW.route_kind = 'schedule' AND NEW.route_issue_id IS NULL AND NEW.route_session_id IS NULL AND NEW.route_schedule_id IS NOT NULL)
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid inbox route columns');
    END;
  `.execute(typedDb)

  const rows = await typedDb
    .selectFrom('inbox_messages')
    .select(['id', 'category', 'project_id', 'session_id', 'payload'])
    .execute() as LegacyInboxRow[]

  for (const row of rows) {
    let parsedPayload: unknown
    try {
      parsedPayload = JSON.parse(row.payload)
    } catch {
      parsedPayload = null
    }

    const payloadRoute = normalizeRouteFromPayload(parsedPayload)
    const legacyRoute = deriveLegacyRoute(row)
    const resolvedRoute = payloadRoute ?? legacyRoute
    const payloadWithRoute = withInjectedNavigationTarget(parsedPayload, resolvedRoute ?? {
      routeKind: null,
      routeIssueId: null,
      routeSessionId: null,
      routeScheduleId: null,
    }, row)

    await typedDb
      .updateTable('inbox_messages')
      .set({
        route_kind: resolvedRoute?.routeKind ?? null,
        route_issue_id: resolvedRoute?.routeIssueId ?? null,
        route_session_id: resolvedRoute?.routeSessionId ?? null,
        route_schedule_id: resolvedRoute?.routeScheduleId ?? null,
        ...(payloadWithRoute ? { payload: payloadWithRoute } : {}),
      })
      .where('id', '=', row.id)
      .execute()
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const typedDb = db as Kysely<MigrationDatabase>

  await sql`DROP TRIGGER IF EXISTS trg_inbox_route_columns_update`.execute(typedDb)
  await sql`DROP TRIGGER IF EXISTS trg_inbox_route_columns_insert`.execute(typedDb)

  await typedDb.schema
    .dropIndex('idx_inbox_route_kind')
    .ifExists()
    .execute()

  await typedDb.schema
    .alterTable('inbox_messages')
    .dropColumn('route_schedule_id')
    .execute()

  await typedDb.schema
    .alterTable('inbox_messages')
    .dropColumn('route_session_id')
    .execute()

  await typedDb.schema
    .alterTable('inbox_messages')
    .dropColumn('route_issue_id')
    .execute()

  await typedDb.schema
    .alterTable('inbox_messages')
    .dropColumn('route_kind')
    .execute()
}
