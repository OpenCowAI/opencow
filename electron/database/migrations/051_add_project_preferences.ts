// SPDX-License-Identifier: Apache-2.0

import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('projects')
    .addColumn('default_tab', 'text', (col) => col.notNull().defaultTo('issues'))
    .execute()

  await db.schema
    .alterTable('projects')
    .addColumn('default_chat_view_mode', 'text', (col) => col.notNull().defaultTo('default'))
    .execute()

  await db.schema
    .alterTable('projects')
    .addColumn('default_files_display_mode', 'text')
    .execute()

  await sql`
    CREATE TRIGGER trg_projects_preferences_insert
    BEFORE INSERT ON projects
    WHEN NOT (
      NEW.default_tab IN ('issues', 'chat', 'schedule')
      AND NEW.default_chat_view_mode IN ('default', 'files')
      AND (
        (NEW.default_chat_view_mode = 'default' AND COALESCE(NEW.default_files_display_mode IN ('ide', 'browser'), 1) = 1)
        OR
        (NEW.default_chat_view_mode = 'files' AND COALESCE(NEW.default_files_display_mode IN ('ide', 'browser'), 0) = 1)
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid project preferences');
    END;
  `.execute(db)

  await sql`
    CREATE TRIGGER trg_projects_preferences_update
    BEFORE UPDATE ON projects
    WHEN NOT (
      NEW.default_tab IN ('issues', 'chat', 'schedule')
      AND NEW.default_chat_view_mode IN ('default', 'files')
      AND (
        (NEW.default_chat_view_mode = 'default' AND COALESCE(NEW.default_files_display_mode IN ('ide', 'browser'), 1) = 1)
        OR
        (NEW.default_chat_view_mode = 'files' AND COALESCE(NEW.default_files_display_mode IN ('ide', 'browser'), 0) = 1)
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid project preferences');
    END;
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS trg_projects_preferences_update`.execute(db)
  await sql`DROP TRIGGER IF EXISTS trg_projects_preferences_insert`.execute(db)
  await db.schema.alterTable('projects').dropColumn('default_files_display_mode').execute()
  await db.schema.alterTable('projects').dropColumn('default_chat_view_mode').execute()
  await db.schema.alterTable('projects').dropColumn('default_tab').execute()
}
