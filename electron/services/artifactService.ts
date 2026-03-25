// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'crypto'
import type { ArtifactStore, UpsertArtifactInput } from './artifactStore'
import type { ArtifactTable } from '../database/types'
import type {
  Artifact,
  ArtifactFilter,
  ArtifactMetaPatch,
  ArtifactKind,
  ArtifactSource,
  DataBusEvent,
  ManagedSessionInfo,
  StarProjectFileInput,
} from '../../src/shared/types'
import { getOriginIssueId } from '../../src/shared/types'
import type { ExtractedArtifact } from '../../src/shared/artifactExtraction'
import { extractAllArtifacts, extractArtifactsFromJsonl, isSupportedArtifact } from '../../src/shared/artifactExtraction'
import { mimeTypeFromExtension } from '../../src/shared/mimeTypes'
import { readAllLines } from '../io/safeReadLines'
import { createLogger } from '../platform/logger'

const log = createLogger('ArtifactService')

// ─── Service Dependencies ───────────────────────────────────────────────────

export interface ArtifactServiceDeps {
  store: ArtifactStore
  dispatch: (event: DataBusEvent) => void
  /** Resolve a filesystem projectPath to a DB project ID. Returns null if not found. */
  resolveProjectId: (projectPath: string) => Promise<string | null>
}

// ─── Row → Domain Mapper ────────────────────────────────────────────────────

function rowToArtifact(row: ArtifactTable): Artifact {
  return {
    id: row.id,
    kind: row.kind as ArtifactKind,
    title: row.title,
    mimeType: row.mime_type,
    filePath: row.file_path,
    fileExtension: row.file_extension,
    sessionId: row.session_id,
    issueId: row.issue_id,
    projectId: row.project_id,
    source: row.source as ArtifactSource,
    contentHash: row.content_hash,
    contentLength: row.content_length,
    // row.content is SUBSTR(content, 1, 2000) in list queries — maps to preview
    contentPreview: row.content,
    starred: row.starred === 1,
    starredAt: row.starred_at,
    stats: { writes: row.writes, edits: row.edits },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ─── ArtifactService ────────────────────────────────────────────────────────

/**
 * Orchestration layer for artifact persistence.
 *
 * Responsibilities:
 * - Extract artifacts from session messages or JSONL transcripts
 * - Persist via ArtifactStore (upsert with dedup)
 * - Dispatch lightweight DataBus events
 * - CRUD proxy for IPC handlers
 */
export class ArtifactService {
  private readonly store: ArtifactStore
  private readonly dispatch: (event: DataBusEvent) => void
  private readonly resolveProjectId: (projectPath: string) => Promise<string | null>

  constructor(deps: ArtifactServiceDeps) {
    this.store = deps.store
    this.dispatch = deps.dispatch
    this.resolveProjectId = deps.resolveProjectId
  }

  /**
   * Capture artifacts from a Managed Session at session boundary
   * (idle / stopped / error).
   */
  async captureFromManagedSession(session: ManagedSessionInfo): Promise<void> {
    try {
      const extracted = extractAllArtifacts(session.messages).filter(isSupportedArtifact)
      if (extracted.length === 0) return

      const projectId = session.projectPath
        ? await this.resolveProjectId(session.projectPath)
        : null

      const inputs = extracted.map((e) =>
        this.toUpsertInput(e, {
          sessionId: session.id,
          issueId: getOriginIssueId(session.origin),
          projectId,
          source: 'managed',
        }),
      )

      const count = await this.store.upsertBatch(inputs)
      if (count > 0) {
        log.debug(`Captured ${count} artifacts from managed session ${session.id}`)
        this.dispatch({
          type: 'artifacts:changed',
          payload: { sessionId: session.id, count },
        })
      }
    } catch (err) {
      log.error(`Failed to capture artifacts from managed session ${session.id}`, err)
    }
  }

  /**
   * Capture artifacts from a Monitor Session using its JSONL transcript.
   * Triggered by session_stop hook events that include transcript_path.
   */
  async captureFromMonitorSession(params: {
    sessionId: string
    transcriptPath: string
    projectId: string | null
  }): Promise<void> {
    try {
      const lines = await readAllLines(params.transcriptPath)
      const extracted = extractArtifactsFromJsonl(lines).filter(isSupportedArtifact)
      if (extracted.length === 0) return

      const inputs = extracted.map((e) =>
        this.toUpsertInput(e, {
          sessionId: params.sessionId,
          issueId: null,
          projectId: params.projectId,
          source: 'monitor',
        }),
      )

      const count = await this.store.upsertBatch(inputs)
      if (count > 0) {
        log.debug(`Captured ${count} artifacts from monitor session ${params.sessionId}`)
        this.dispatch({
          type: 'artifacts:changed',
          payload: { sessionId: params.sessionId, count },
        })
      }
    } catch (err) {
      log.error(`Failed to capture artifacts from monitor session ${params.sessionId}`, err)
    }
  }

  /**
   * Backfill artifacts from existing managed sessions.
   * Called async (non-blocking) during startup.
   * Idempotent — contentHash dedup prevents duplicate records.
   */
  async backfillFromExistingSessions(
    listSessions: () => Promise<ManagedSessionInfo[]>,
  ): Promise<void> {
    try {
      const sessions = await listSessions()
      let totalCount = 0

      for (const session of sessions) {
        const extracted = extractAllArtifacts(session.messages).filter(isSupportedArtifact)
        if (extracted.length === 0) continue

        const projectId = session.projectPath
          ? await this.resolveProjectId(session.projectPath)
          : null

        const inputs = extracted.map((e) =>
          this.toUpsertInput(e, {
            sessionId: session.id,
            issueId: getOriginIssueId(session.origin),
            projectId,
            source: 'managed',
          }),
        )

        const count = await this.store.upsertBatch(inputs)
        totalCount += count

        // Yield to event loop periodically to avoid blocking
        if (totalCount % 50 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
      }

      if (totalCount > 0) {
        log.info(`Backfilled ${totalCount} artifacts from ${sessions.length} sessions`)
      }
    } catch (err) {
      log.error('Failed to backfill artifacts', err)
    }
  }

  // ─── CRUD Proxy ─────────────────────────────────────────────────────

  async list(filter?: ArtifactFilter): Promise<Artifact[]> {
    const rows = await this.store.list(filter)
    return rows.map(rowToArtifact)
  }

  async getContent(id: string): Promise<string | null> {
    return this.store.getContent(id)
  }

  async updateMeta(id: string, patch: ArtifactMetaPatch): Promise<Artifact> {
    const row = await this.store.updateMeta(id, patch)
    if (!row) throw new Error(`Artifact not found: ${id}`)

    // Dispatch star event for UI optimistic updates
    if (patch.starred !== undefined) {
      this.dispatch({
        type: 'artifacts:starred',
        payload: { artifactId: id, starred: patch.starred },
      })
    }

    return rowToArtifact(row)
  }

  async listStarred(projectId?: string): Promise<Artifact[]> {
    const rows = await this.store.listStarred(projectId)
    return rows.map(rowToArtifact)
  }

  // ─── Eager Persist ────────────────────────────────────────────────────

  /**
   * Persist a single artifact on demand and set its starred state.
   *
   * This is the "Eager Persist" path — triggered by explicit user intent (Star).
   * Complements the "Write-Behind" batch path (captureFromManagedSession).
   *
   * Flow:
   * 1. If already persisted (by contentHash) → toggle star on existing row
   * 2. If not persisted → upsert new row + set starred
   *
   * @returns The persisted Artifact with star state applied.
   */
  async persistAndStar(params: {
    extracted: ExtractedArtifact
    sessionId: string
    issueId: string | null
    projectId: string | null
    starred: boolean
  }): Promise<Artifact> {
    const { extracted, sessionId, issueId, projectId, starred } = params

    // Check if already persisted
    let existing = await this.store.findBySessionAndHash(sessionId, extracted.contentHash)

    if (!existing) {
      // Eager persist: insert the artifact now
      const input = this.toUpsertInput(extracted, {
        sessionId,
        issueId,
        projectId,
        source: 'managed',
      })
      await this.store.upsertBatch([input])
      existing = await this.store.findBySessionAndHash(sessionId, extracted.contentHash)
    }

    if (!existing) {
      throw new Error(`Failed to persist artifact: ${extracted.title}`)
    }

    // Apply star state
    const row = await this.store.updateMeta(existing.id, { starred })
    if (!row) throw new Error(`Artifact not found after persist: ${existing.id}`)

    this.dispatch({
      type: 'artifacts:starred',
      payload: { artifactId: existing.id, starred },
    })

    return rowToArtifact(row)
  }

  /**
   * Star (or unstar) a project file artifact.
   *
   * Unlike persistAndStar, this operates outside of any session context.
   * Dedup key: projectId + filePath (via source='project_file').
   * The DB `session_id` NOT NULL constraint is satisfied with '' sentinel.
   */
  async starProjectFile(input: StarProjectFileInput): Promise<Artifact> {
    const { filePath, fileExtension, content, contentHash, projectId, starred } = input

    const fileName = filePath.split('/').pop() ?? filePath
    const ext = fileExtension ?? (filePath.includes('.') ? '.' + filePath.split('.').pop()! : null)
    const mimeType = ext ? mimeTypeFromExtension(ext) : 'text/plain'

    // Dedup: check if already persisted as a project_file artifact
    let existing = await this.store.findByProjectAndPath(projectId, filePath)

    if (!existing) {
      const upsertInput: UpsertArtifactInput = {
        id: randomUUID(),
        kind: 'file',
        title: fileName,
        mimeType,
        filePath,
        fileExtension: ext,
        sessionId: null,      // project_file artifacts have no session (migration 017)
        issueId: null,
        projectId,
        source: 'project_file',
        content,
        contentHash,
        contentLength: content.length,
        writes: 0,
        edits: 0,
      }
      await this.store.upsertBatch([upsertInput])
      existing = await this.store.findByProjectAndPath(projectId, filePath)
    }

    if (!existing) {
      throw new Error(`Failed to persist project file artifact: ${filePath}`)
    }

    const row = await this.store.updateMeta(existing.id, { starred })
    if (!row) throw new Error(`Artifact not found after persist: ${existing.id}`)

    this.dispatch({ type: 'artifacts:starred', payload: { artifactId: existing.id, starred } })

    return rowToArtifact(row)
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private toUpsertInput(
    extracted: ExtractedArtifact,
    context: {
      sessionId: string | null
      issueId: string | null
      projectId: string | null
      source: ArtifactSource
    },
  ): UpsertArtifactInput {
    return {
      id: randomUUID(),
      kind: extracted.kind,
      title: extracted.title,
      mimeType: extracted.mimeType,
      filePath: extracted.filePath,
      fileExtension: extracted.fileExtension,
      sessionId: context.sessionId,
      issueId: context.issueId,
      projectId: context.projectId,
      source: context.source,
      content: extracted.content,
      contentHash: extracted.contentHash,
      contentLength: extracted.content?.length ?? 0,
      writes: extracted.stats.writes,
      edits: extracted.stats.edits,
    }
  }
}
