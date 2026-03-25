// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import type { Database, ProjectTable } from '../database/types'
import { generateId } from '../shared/identity'
import type { AIEngineKind } from '../../src/shared/types'

export interface StoredProject {
  id: string
  name: string
  canonicalPath: string
  pinOrder: number | null
  archivedAt: number | null
  displayOrder: number
  createdAt: number
  updatedAt: number
}

export interface StoredProjectExternalMapping {
  id: string
  projectId: string
  engineKind: AIEngineKind
  externalProjectRef: string
  discoveredAt: number
}

export interface AddExternalMappingInput {
  engineKind: AIEngineKind
  externalProjectRef: string
  projectId: string
  discoveredAt?: number
}

export interface ExternalProjectRefQuery {
  engineKind: AIEngineKind
  externalProjectRef: string
}

interface CreateProjectInput {
  name: string
  canonicalPath: string
}

interface UpdateProjectInput {
  name?: string
  canonicalPath?: string
  pinOrder?: number | null
  archivedAt?: number | null
  displayOrder?: number
}

export class ProjectStore {
  constructor(private readonly db: Kysely<Database>) {}

  async create(input: CreateProjectInput): Promise<StoredProject> {
    const now = Date.now()
    const nextOrder = await this.nextDisplayOrder()
    const row: ProjectTable = {
      id: generateId(),
      name: input.name,
      canonical_path: input.canonicalPath,
      pin_order: null,
      archived_at: null,
      display_order: nextOrder,
      created_at: now,
      updated_at: now,
    }
    await this.db.insertInto('projects').values(row).execute()
    return rowToProject(row)
  }

  async getById(id: string): Promise<StoredProject | null> {
    const row = await this.db
      .selectFrom('projects').selectAll().where('id', '=', id)
      .executeTakeFirst()
    return row ? rowToProject(row) : null
  }

  async findByCanonicalPath(path: string): Promise<StoredProject | null> {
    const row = await this.db
      .selectFrom('projects').selectAll().where('canonical_path', '=', path)
      .executeTakeFirst()
    return row ? rowToProject(row) : null
  }

  async findByClaudeFolderId(claudeFolderId: string): Promise<StoredProject | null> {
    // Prefer the new engine-agnostic mapping table.
    const byExternal = await this.findByExternalRef({
      engineKind: 'claude',
      externalProjectRef: claudeFolderId,
    })
    if (byExternal) return byExternal

    const row = await this.db
      .selectFrom('project_claude_mappings')
      .innerJoin('projects', 'projects.id', 'project_claude_mappings.project_id')
      .selectAll('projects')
      .where('project_claude_mappings.claude_folder_id', '=', claudeFolderId)
      .executeTakeFirst()
    return row ? rowToProject(row as ProjectTable) : null
  }

  async listAll(): Promise<StoredProject[]> {
    const rows = await this.db
      .selectFrom('projects').selectAll().orderBy('updated_at', 'desc')
      .execute()
    return rows.map(rowToProject)
  }

  async update(id: string, input: UpdateProjectInput): Promise<StoredProject | null> {
    const setClauses: Partial<ProjectTable> = { updated_at: Date.now() }
    if (input.name !== undefined) setClauses.name = input.name
    if (input.canonicalPath !== undefined) setClauses.canonical_path = input.canonicalPath
    if (input.pinOrder !== undefined) setClauses.pin_order = input.pinOrder
    if (input.archivedAt !== undefined) setClauses.archived_at = input.archivedAt
    if (input.displayOrder !== undefined) setClauses.display_order = input.displayOrder
    await this.db.updateTable('projects').set(setClauses).where('id', '=', id).execute()
    return this.getById(id)
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('projects').where('id', '=', id).executeTakeFirst()
    return (result?.numDeletedRows ?? 0n) > 0n
  }

  async nextPinOrder(): Promise<number> {
    const result = await this.db
      .selectFrom('projects')
      .select(this.db.fn.max('pin_order').as('maxOrder'))
      .executeTakeFirst()
    return ((result?.maxOrder as number | null) ?? -1) + 1
  }

  async nextDisplayOrder(): Promise<number> {
    const result = await this.db
      .selectFrom('projects')
      .select(this.db.fn.max('display_order').as('maxOrder'))
      .executeTakeFirst()
    return ((result?.maxOrder as number | null) ?? -1) + 1
  }

  /**
   * Batch-update display_order for the given project IDs.
   * Each project receives its array-index position as display_order.
   */
  async reorderProjects(orderedIds: string[]): Promise<void> {
    const now = Date.now()
    for (let i = 0; i < orderedIds.length; i++) {
      await this.db
        .updateTable('projects')
        .set({ display_order: i, updated_at: now })
        .where('id', '=', orderedIds[i])
        .execute()
    }
  }

  /**
   * Batch-update pin_order for the given pinned project IDs.
   * Each project receives its array-index position as pin_order.
   */
  async reorderPinnedProjects(orderedIds: string[]): Promise<void> {
    const now = Date.now()
    for (let i = 0; i < orderedIds.length; i++) {
      await this.db
        .updateTable('projects')
        .set({ pin_order: i, updated_at: now })
        .where('id', '=', orderedIds[i])
        .execute()
    }
  }

  // ── Claude Folder Mappings ──

  /** Upsert: if folder already mapped, update its project_id. */
  async addClaudeMapping(claudeFolderId: string, projectId: string): Promise<void> {
    const now = Date.now()

    // Legacy mapping table (kept for compatibility)
    await this.db
      .insertInto('project_claude_mappings')
      .values({
        claude_folder_id: claudeFolderId,
        project_id: projectId,
        discovered_at: now,
      })
      .onConflict((oc) =>
        oc.column('claude_folder_id').doUpdateSet({ project_id: projectId })
      )
      .execute()

    // New engine-agnostic mapping table
    await this.addExternalMapping({
      engineKind: 'claude',
      externalProjectRef: claudeFolderId,
      projectId,
      discoveredAt: now,
    })
  }

  async addExternalMapping(input: AddExternalMappingInput): Promise<void> {
    const now = input.discoveredAt ?? Date.now()
    await this.db
      .insertInto('project_external_mappings')
      .values({
        id: generateId(),
        project_id: input.projectId,
        engine_kind: input.engineKind,
        external_project_ref: input.externalProjectRef,
        discovered_at: now,
      })
      .onConflict((oc) =>
        oc.columns(['engine_kind', 'external_project_ref']).doUpdateSet({
          project_id: input.projectId,
          discovered_at: now,
        })
      )
      .execute()
  }

  async findByExternalRef(query: ExternalProjectRefQuery): Promise<StoredProject | null> {
    const row = await this.db
      .selectFrom('project_external_mappings')
      .innerJoin('projects', 'projects.id', 'project_external_mappings.project_id')
      .selectAll('projects')
      .where('project_external_mappings.engine_kind', '=', query.engineKind)
      .where('project_external_mappings.external_project_ref', '=', query.externalProjectRef)
      .executeTakeFirst()
    return row ? rowToProject(row as ProjectTable) : null
  }

  async getClaudeMappings(projectId: string): Promise<string[]> {
    const legacyRows = await this.db
      .selectFrom('project_claude_mappings')
      .select('claude_folder_id')
      .where('project_id', '=', projectId)
      .execute()
    const externalRows = await this.db
      .selectFrom('project_external_mappings')
      .select('external_project_ref')
      .where('project_id', '=', projectId)
      .where('engine_kind', '=', 'claude')
      .execute()
    return [...new Set([
      ...legacyRows.map((r) => r.claude_folder_id),
      ...externalRows.map((r) => r.external_project_ref),
    ])]
  }

  /** Return all known claude_folder_ids as a Set (batch lookup for discovery filtering). */
  async listAllClaudeFolderIds(): Promise<Set<string>> {
    const legacyRows = await this.db
      .selectFrom('project_claude_mappings')
      .select('claude_folder_id')
      .execute()
    const externalRows = await this.db
      .selectFrom('project_external_mappings')
      .select('external_project_ref')
      .where('engine_kind', '=', 'claude')
      .execute()
    return new Set([
      ...legacyRows.map((r) => r.claude_folder_id),
      ...externalRows.map((r) => r.external_project_ref),
    ])
  }

  async listAllExternalRefs(params: { engineKind: AIEngineKind }): Promise<Set<string>> {
    const rows = await this.db
      .selectFrom('project_external_mappings')
      .select('external_project_ref')
      .where('engine_kind', '=', params.engineKind)
      .execute()
    return new Set(rows.map((r) => r.external_project_ref))
  }

  /** Return all known canonical_paths as a Set (batch lookup for discovery filtering). */
  async listAllCanonicalPaths(): Promise<Set<string>> {
    const rows = await this.db
      .selectFrom('projects')
      .select('canonical_path')
      .execute()
    return new Set(rows.map((r) => r.canonical_path))
  }
}

function rowToProject(row: ProjectTable): StoredProject {
  return {
    id: row.id,
    name: row.name,
    canonicalPath: row.canonical_path,
    pinOrder: row.pin_order,
    archivedAt: row.archived_at,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
