// SPDX-License-Identifier: Apache-2.0

import type { IssueService } from './issueService'
import type { ArtifactService } from './artifactService'
import type { IssueContextRefStore } from './issueContextRefStore'
import type { ContextRef } from '../../src/shared/types'
import { createLogger } from '../platform/logger'

const log = createLogger('ContextRefResolver')

// ─── Internal types ─────────────────────────────────────────────────

/** Lightweight metadata for a single context reference — no content, just pointers. */
interface RefManifestEntry {
  type: ContextRef['type']
  id: string
  title: string
  /** Issue: status; Artifact: MIME type */
  meta: string
  /** Issue: whether it has a session; Artifact: file path */
  accessHint: string
  /** Artifact: content length in bytes */
  sizeHint?: number
}

// ─── Public interface ───────────────────────────────────────────────

/** Dependencies injected via constructor — structured, not flat. */
export interface ContextRefResolverDeps {
  contextRefStore: IssueContextRefStore
  issueService: IssueService
  artifactService: ArtifactService | null
}

/**
 * Builds a lightweight "Context Manifest" from Issue contextRefs.
 *
 * Instead of injecting full content into the system prompt, the manifest
 * provides the LLM with just enough metadata (IDs, titles, paths) to
 * fetch the content itself via available tools (get_issue, file read, etc.).
 *
 * This approach offers:
 * - **Unlimited depth**: LLM can read full Issue + Session history + Artifact content
 * - **Token efficiency**: Only fetches what's actually needed
 * - **Freshness**: Content is read at access time, not snapshot at session start
 */
export class ContextRefResolver {
  constructor(private readonly deps: ContextRefResolverDeps) {}

  /**
   * Build a context manifest for the given issue's contextRefs.
   * Returns `undefined` when the issue has no contextRefs or none can be resolved.
   */
  async resolveForIssue(issueId: string): Promise<string | undefined> {
    const refs = await this.deps.contextRefStore.listByIssueId(issueId)

    if (refs.length === 0) {
      log.info(`[resolveForIssue] issue=${issueId} → no contextRefs, skipping`)
      return undefined
    }

    log.info(`[resolveForIssue] issue=${issueId} → found ${refs.length} contextRef(s): ${refs.map((r) => `${r.type}:${r.id.slice(0, 8)}`).join(', ')}`)

    const entries = await Promise.all(refs.map((ref) => this.resolveEntry(ref)))
    const valid = entries.filter((e): e is RefManifestEntry => e !== null)

    if (valid.length === 0) {
      log.warn(`[resolveForIssue] issue=${issueId} → all ${refs.length} ref(s) failed to resolve metadata`)
      return undefined
    }

    const manifest = this.formatManifest(valid)
    log.info(`[resolveForIssue] issue=${issueId} → built manifest for ${valid.length}/${refs.length} ref(s), ${manifest.length} chars`)
    log.info(`[resolveForIssue] --- context manifest ---\n${manifest}\n--- end manifest ---`)
    return manifest
  }

  // ─── Per-type metadata resolution ───────────────────────────────────

  private async resolveEntry(ref: ContextRef): Promise<RefManifestEntry | null> {
    try {
      if (ref.type === 'issue') return await this.resolveIssueEntry(ref.id)
      if (ref.type === 'artifact') return await this.resolveArtifactEntry(ref.id)
      log.warn(`[resolveEntry] unknown ref type "${ref.type}" for id=${ref.id}, skipping`)
      return null
    } catch (err) {
      log.warn(`[resolveEntry] FAILED ${ref.type}:${ref.id}`, err)
      return null
    }
  }

  private async resolveIssueEntry(id: string): Promise<RefManifestEntry | null> {
    const issue = await this.deps.issueService.getIssue(id)
    if (!issue) {
      log.warn(`[resolveIssueEntry] issue ${id} not found (deleted?)`)
      return null
    }

    const hasSession = !!issue.sessionId
    log.info(`[resolveIssueEntry] ✓ issue ${id.slice(0, 8)} → title="${issue.title}", status=${issue.status}, hasSession=${hasSession}`)

    return {
      type: 'issue',
      id,
      title: issue.title,
      meta: `status: ${issue.status}`,
      accessHint: hasSession
        ? `Has session history — use get_issue to read full details and prior session context`
        : `Use get_issue to read full details`,
    }
  }

  private async resolveArtifactEntry(id: string): Promise<RefManifestEntry | null> {
    if (!this.deps.artifactService) {
      log.warn(`[resolveArtifactEntry] artifactService unavailable, skipping artifact ${id}`)
      return null
    }

    const artifacts = await this.deps.artifactService.list()
    const artifact = artifacts.find((a) => a.id === id)

    if (!artifact) {
      log.warn(`[resolveArtifactEntry] artifact ${id} not found in ${artifacts.length} total artifacts`)
      return null
    }

    const title = artifact.title || artifact.filePath || id
    log.info(
      `[resolveArtifactEntry] ✓ artifact ${id.slice(0, 8)} → title="${title}", ` +
      `path=${artifact.filePath ?? '(none)'}, size=${artifact.contentLength} bytes`
    )

    return {
      type: 'artifact',
      id,
      title,
      meta: artifact.mimeType,
      accessHint: artifact.filePath
        ? `Read file: ${artifact.filePath}`
        : `Use get-artifact-content tool to read content`,
      sizeHint: artifact.contentLength,
    }
  }

  // ─── Manifest formatting ────────────────────────────────────────────

  /**
   * Format entries into a Context Manifest block for system prompt injection.
   *
   * The manifest gives the LLM enough metadata to decide what to read,
   * plus clear instructions on HOW to read each item.
   */
  private formatManifest(entries: RefManifestEntry[]): string {
    const items = entries.map((entry, i) => {
      const num = i + 1
      const typeLabel = entry.type === 'issue' ? 'Issue' : 'Artifact'
      const lines = [
        `${num}. [${typeLabel}] "${entry.title}"`,
        `   - ID: ${entry.id}`,
        `   - ${entry.meta}`,
      ]
      if (entry.sizeHint != null) {
        lines.push(`   - Size: ${entry.sizeHint} bytes`)
      }
      lines.push(`   → ${entry.accessHint}`)
      return lines.join('\n')
    })

    return [
      '<context-references>',
      'This issue has the following items attached as context.',
      'You SHOULD read them before starting work — use the available tools',
      '(get_issue, Read file, etc.) to fetch their full content.',
      '',
      ...items,
      '</context-references>',
    ].join('\n')
  }
}
