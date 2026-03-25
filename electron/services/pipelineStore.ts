// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import type { Database, SchedulePipelineTable } from '../database/types'
import type { SchedulePipeline, PipelineStep } from '../../src/shared/types'

// ─── Row <-> Domain object mappers ─────────────────────────────────────────

function rowToPipeline(row: SchedulePipelineTable): SchedulePipeline {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: JSON.parse(row.steps) as PipelineStep[],
    failurePolicy: row.failure_policy as SchedulePipeline['failurePolicy'],
    status: row.status as SchedulePipeline['status'],
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function pipelineToRow(pipeline: SchedulePipeline): SchedulePipelineTable {
  return {
    id: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    steps: JSON.stringify(pipeline.steps),
    failure_policy: pipeline.failurePolicy,
    status: pipeline.status,
    project_id: pipeline.projectId,
    created_at: pipeline.createdAt,
    updated_at: pipeline.updatedAt,
  }
}

export class PipelineStore {
  constructor(private readonly db: Kysely<Database>) {}

  async add(pipeline: SchedulePipeline): Promise<void> {
    await this.db
      .insertInto('schedule_pipelines')
      .values(pipelineToRow(pipeline))
      .execute()
  }

  async get(id: string): Promise<SchedulePipeline | null> {
    const row = await this.db
      .selectFrom('schedule_pipelines')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? rowToPipeline(row) : null
  }

  async list(): Promise<SchedulePipeline[]> {
    const rows = await this.db
      .selectFrom('schedule_pipelines')
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute()
    return rows.map(rowToPipeline)
  }

  async update(
    id: string,
    patch: Partial<SchedulePipeline>
  ): Promise<SchedulePipeline | null> {
    const existing = await this.get(id)
    if (!existing) return null

    const updates: Record<string, unknown> = { updated_at: Date.now() }
    if (patch.name !== undefined) updates.name = patch.name
    if (patch.description !== undefined) updates.description = patch.description
    if (patch.steps !== undefined) updates.steps = JSON.stringify(patch.steps)
    if (patch.failurePolicy !== undefined) updates.failure_policy = patch.failurePolicy
    if (patch.status !== undefined) updates.status = patch.status
    if (patch.projectId !== undefined) updates.project_id = patch.projectId

    await this.db
      .updateTable('schedule_pipelines')
      .set(updates)
      .where('id', '=', id)
      .execute()
    return this.get(id)
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('schedule_pipelines')
      .where('id', '=', id)
      .executeTakeFirst()
    return (result?.numDeletedRows ?? 0n) > 0n
  }

  /**
   * Delete all pipelines belonging to a project.
   * Called during project deletion to maintain data integrity.
   * @returns Number of deleted pipelines.
   */
  async deleteByProjectId(projectId: string): Promise<number> {
    const result = await this.db
      .deleteFrom('schedule_pipelines')
      .where('project_id', '=', projectId)
      .executeTakeFirst()
    return Number(result?.numDeletedRows ?? 0n)
  }
}
