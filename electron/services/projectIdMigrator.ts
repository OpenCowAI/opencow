// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import type { Database } from '../database/types'
import type { ProjectStore } from './projectStore'

interface MigrationResult {
  issues: number
  inbox: number
}

interface ProjectIdMigratorDeps {
  db: Kysely<Database>
  projectStore: ProjectStore
}

export class ProjectIdMigrator {
  private db: Kysely<Database>
  private projectStore: ProjectStore

  constructor(deps: ProjectIdMigratorDeps) {
    this.db = deps.db
    this.projectStore = deps.projectStore
  }

  async migrateDatabase(): Promise<MigrationResult> {
    const issues = await this.migrateIssues()
    const inbox = await this.migrateInbox()
    return { issues, inbox }
  }

  private async migrateIssues(): Promise<number> {
    const distinctIds = await this.db
      .selectFrom('issues')
      .select('project_id')
      .where('project_id', 'is not', null)
      .groupBy('project_id')
      .execute()

    let count = 0
    for (const row of distinctIds) {
      const oldId = row.project_id
      if (!oldId) continue

      const project = await this.projectStore.findByClaudeFolderId(oldId)
      if (!project) continue

      const result = await this.db
        .updateTable('issues')
        .set({ project_id: project.id, updated_at: Date.now() })
        .where('project_id', '=', oldId)
        .executeTakeFirst()
      count += Number(result?.numUpdatedRows ?? 0n)
    }
    return count
  }

  private async migrateInbox(): Promise<number> {
    let count = 0

    // Phase 1: Migrate messages with non-null project_id column (hook_event messages)
    const distinctIds = await this.db
      .selectFrom('inbox_messages')
      .select('project_id')
      .where('project_id', 'is not', null)
      .groupBy('project_id')
      .execute()

    for (const row of distinctIds) {
      const oldId = row.project_id
      if (!oldId) continue

      const project = await this.projectStore.findByClaudeFolderId(oldId)
      if (!project) continue

      const messages = await this.db
        .selectFrom('inbox_messages')
        .selectAll()
        .where('project_id', '=', oldId)
        .execute()

      for (const msg of messages) {
        const payload = JSON.parse(msg.payload)
        if (payload.projectId === oldId) payload.projectId = project.id
        if (payload.context?.projectId === oldId) payload.context.projectId = project.id

        await this.db
          .updateTable('inbox_messages')
          .set({ project_id: project.id, payload: JSON.stringify(payload) })
          .where('id', '=', msg.id)
          .execute()
        count++
      }
    }

    // Phase 2: Migrate smart_reminder messages where project_id column is NULL
    // but payload.context.projectId contains a legacy folder name
    const reminderMessages = await this.db
      .selectFrom('inbox_messages')
      .selectAll()
      .where('category', '=', 'smart_reminder')
      .where('project_id', 'is', null)
      .execute()

    for (const msg of reminderMessages) {
      const payload = JSON.parse(msg.payload)
      const contextProjectId = payload.context?.projectId
      if (!contextProjectId) continue

      const project = await this.projectStore.findByClaudeFolderId(contextProjectId)
      if (!project) continue

      payload.context.projectId = project.id
      await this.db
        .updateTable('inbox_messages')
        .set({ payload: JSON.stringify(payload) })
        .where('id', '=', msg.id)
        .execute()
      count++
    }

    return count
  }
}
