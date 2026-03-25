// SPDX-License-Identifier: Apache-2.0

import { sql, type Kysely } from 'kysely'

/**
 * Migration 023: Rename capacity_state.project_path → project_id.
 *
 * OpenCow is the centre of capabilities — projects are identified by UUID,
 * not by filesystem path. This migration converts the column from storing
 * a path string to storing a project ID (or '' for global scope).
 *
 * Strategy: recreate table (SQLite lacks ALTER COLUMN + composite PK rename).
 *   1. Create new table with project_id column
 *   2. Migrate data: join with projects to resolve canonical_path → id
 *   3. Drop old table, rename new one
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Step 1: Create the new table structure
  await db.schema
    .createTable('capacity_state_v2')
    .addColumn('scope', 'text', (col) =>
      col.notNull().check(sql`scope IN ('global', 'project')`),
    )
    .addColumn('project_id', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('category', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('tags', 'text', (col) => col.defaultTo('[]'))
    .addColumn('sort_order', 'integer', (col) => col.defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_capacity_state_v2', [
      'scope',
      'project_id',
      'category',
      'name',
    ])
    .execute()

  // Step 2: Migrate data — resolve project_path → project_id via projects table
  // Global scope rows (project_path = '') keep project_id = ''
  // Project scope rows: look up projects.canonical_path → projects.id
  // Orphan rows (no matching project): downgrade to '' (global scope)
  await sql`
    INSERT INTO capacity_state_v2 (scope, project_id, category, name, enabled, tags, sort_order, created_at, updated_at)
    SELECT
      cs.scope,
      CASE
        WHEN cs.project_path = '' THEN ''
        ELSE COALESCE((SELECT p.id FROM projects p WHERE p.canonical_path = cs.project_path), '')
      END,
      cs.category,
      cs.name,
      cs.enabled,
      cs.tags,
      cs.sort_order,
      cs.created_at,
      cs.updated_at
    FROM capacity_state cs
  `.execute(db)

  // Step 3: Swap tables
  await db.schema.dropTable('capacity_state').execute()
  await sql`ALTER TABLE capacity_state_v2 RENAME TO capacity_state`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Reverse: project_id → project_path (best-effort — resolve via projects table)
  await db.schema
    .createTable('capacity_state_v2')
    .addColumn('scope', 'text', (col) =>
      col.notNull().check(sql`scope IN ('global', 'project')`),
    )
    .addColumn('project_path', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('category', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('tags', 'text', (col) => col.defaultTo('[]'))
    .addColumn('sort_order', 'integer', (col) => col.defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_capacity_state_v2', [
      'scope',
      'project_path',
      'category',
      'name',
    ])
    .execute()

  await sql`
    INSERT INTO capacity_state_v2 (scope, project_path, category, name, enabled, tags, sort_order, created_at, updated_at)
    SELECT
      cs.scope,
      CASE
        WHEN cs.project_id = '' THEN ''
        ELSE COALESCE((SELECT p.canonical_path FROM projects p WHERE p.id = cs.project_id), '')
      END,
      cs.category,
      cs.name,
      cs.enabled,
      cs.tags,
      cs.sort_order,
      cs.created_at,
      cs.updated_at
    FROM capacity_state cs
  `.execute(db)

  await db.schema.dropTable('capacity_state').execute()
  await sql`ALTER TABLE capacity_state_v2 RENAME TO capacity_state`.execute(db)
}
