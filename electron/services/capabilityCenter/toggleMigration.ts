// SPDX-License-Identifier: Apache-2.0

/**
 * Toggle Migration — one-time migration of plugin toggle state.
 *
 * M6-3: Reads `enabledPlugins` from `~/.claude/settings.json` and seeds
 * `capability_state` rows for disabled plugins so the Capability Center
 * respects legacy toggle decisions.
 *
 * Strategy:
 *   1. Skip if migration already ran (sentinel row in capability_state)
 *   2. Read enabledPlugins from settings.json
 *   3. For disabled plugins: discover capabilities, bulk INSERT ... ON CONFLICT DO NOTHING
 *   4. Write sentinel row to prevent re-running
 *
 * This is intentionally best-effort — failure must never block startup.
 */

import path from 'node:path'
import type { Kysely } from 'kysely'
import type { Database } from '../../database/types'
import type { ManagedCapabilityCategory } from '@shared/types'
import { resolvePlugins } from '../capabilities/pluginResolver'
import { resolveClaudeCodePaths } from '../capabilities/paths'
import { safeDirEntries } from './shared/fsUtils'

// Sentinel uses a dedicated category prefix to avoid polluting real capability lists.
const MIGRATION_SENTINEL_CATEGORY = '__migration__'
const MIGRATION_SENTINEL_NAME = 'toggle_v1'

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Run the one-time toggle migration (idempotent, best-effort).
 * Call this during app startup after DB is ready.
 */
export async function runToggleMigration(db: Kysely<Database>): Promise<{
  migrated: number
  skipped: boolean
}> {
  // 1. Check sentinel — skip if already migrated
  const sentinel = await db
    .selectFrom('capability_state')
    .select('name')
    .where('scope', '=', 'global')
    .where('project_id', '=', '')
    .where('category', '=', MIGRATION_SENTINEL_CATEGORY)
    .where('name', '=', MIGRATION_SENTINEL_NAME)
    .executeTakeFirst()

  if (sentinel) {
    return { migrated: 0, skipped: true }
  }

  // 2. Resolve plugins and find disabled ones
  const paths = resolveClaudeCodePaths()
  const plugins = await resolvePlugins(paths)
  const disabledPlugins = plugins.filter((p) => !p.enabled && !p.blocked)

  // 3. Collect all capabilities from disabled plugins
  const now = Date.now()
  const rows: Array<{
    scope: string
    project_id: string
    category: string
    name: string
    enabled: number
    tags: string
    sort_order: number
    created_at: number
    updated_at: number
  }> = []

  for (const plugin of disabledPlugins) {
    const capabilities = await discoverPluginCapabilities(plugin.installPath)
    for (const cap of capabilities) {
      rows.push({
        scope: 'global',
        project_id: '',
        category: cap.category,
        name: cap.name,
        enabled: 0,
        tags: JSON.stringify([`plugin:${plugin.compositeKey}`]),
        sort_order: 0,
        created_at: now,
        updated_at: now,
      })
    }
  }

  // Bulk insert with ON CONFLICT DO NOTHING — never overwrite existing user state
  let migrated = 0
  for (const row of rows) {
    const result = await db
      .insertInto('capability_state')
      .values(row)
      .onConflict((oc) =>
        oc.columns(['scope', 'project_id', 'category', 'name']).doNothing(),
      )
      .execute()
    // executionResult[0].numInsertedOrUpdatedRows is bigint; > 0n means inserted
    if (result[0]?.numInsertedOrUpdatedRows && result[0].numInsertedOrUpdatedRows > 0n) {
      migrated++
    }
  }

  // 4. Write sentinel to mark migration complete
  await db
    .insertInto('capability_state')
    .values({
      scope: 'global',
      project_id: '',
      category: MIGRATION_SENTINEL_CATEGORY,
      name: MIGRATION_SENTINEL_NAME,
      enabled: 0,
      tags: JSON.stringify([`migrated:${migrated}`]),
      sort_order: 0,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.columns(['scope', 'project_id', 'category', 'name']).doNothing(),
    )
    .execute()

  return { migrated, skipped: false }
}

// ─── Internal ────────────────────────────────────────────────────────────

interface DiscoveredCapability {
  category: ManagedCapabilityCategory
  name: string
}

/**
 * Discover capability names from a plugin's install directory.
 * Scans all 5 relevant category directories (skills, commands, agents, rules, hooks).
 */
async function discoverPluginCapabilities(
  installPath: string,
): Promise<DiscoveredCapability[]> {
  const results: DiscoveredCapability[] = []

  const documentCategories: Array<[string, ManagedCapabilityCategory]> = [
    ['skills', 'skill'],
    ['commands', 'command'],
    ['agents', 'agent'],
    ['rules', 'rule'],
  ]

  for (const [dirName, category] of documentCategories) {
    const dirs = [
      path.join(installPath, dirName),
      path.join(installPath, '.claude', dirName),
    ]

    for (const dir of dirs) {
      const entries = await safeDirEntries(dir)
      for (const entry of entries) {
        if (!entry.isDir && entry.name.endsWith('.md')) {
          results.push({ category, name: entry.name.replace(/\.md$/, '') })
        }
      }
    }
  }

  // Hooks (.json) and MCP servers (.json)
  const configCategories: Array<[string, ManagedCapabilityCategory]> = [
    ['hooks', 'hook'],
    ['mcp-servers', 'mcp-server'],
  ]

  for (const [dirName, category] of configCategories) {
    const dir = path.join(installPath, dirName)
    const entries = await safeDirEntries(dir)
    for (const entry of entries) {
      if (!entry.isDir && entry.name.endsWith('.json')) {
        results.push({ category, name: entry.name.replace(/\.json$/, '') })
      }
    }
  }

  return results
}
