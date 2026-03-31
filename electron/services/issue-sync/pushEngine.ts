// SPDX-License-Identifier: Apache-2.0

import { createLogger } from '../../platform/logger'
import type { ChangeQueueStore } from './changeQueueStore'
import type { AdapterRegistry } from './adapterRegistry'
import type { IssueProviderStore } from '../issueProviderStore'
import type { IssueProviderService } from '../issueProviderService'
import type { IssueStore } from '../issueStore'
import type { CreateRemoteIssueInput, UpdateRemoteIssueInput } from './remoteAdapter'
import type { ChangeQueueEntry, DataBusEvent } from '../../../src/shared/types'

const log = createLogger('PushEngine')

/**
 * Background queue processor for pushing local changes to remote platforms.
 *
 * Runs on a configurable interval, processing pending ChangeQueue entries:
 * 1. Claim pending entries (mark as 'processing')
 * 2. Call RemoteWriteAdapter methods
 * 3. On success: mark completed, update local issue with remote metadata
 * 4. On failure: mark failed (retry count incremented by store)
 *
 * Uses exponential backoff for retries: delay = min(baseDelay * 2^retryCount, maxDelay)
 */
export class PushEngine {
  private readonly changeQueueStore: ChangeQueueStore
  private readonly issueStore: IssueStore
  private readonly providerStore: IssueProviderStore
  private readonly providerService: IssueProviderService
  private readonly adapterRegistry: AdapterRegistry
  private readonly dispatch: (event: DataBusEvent) => void

  private timer: ReturnType<typeof setInterval> | null = null
  private processing = false

  /** Interval between queue processing runs (ms). */
  private readonly intervalMs: number

  constructor(deps: {
    changeQueueStore: ChangeQueueStore
    issueStore: IssueStore
    providerStore: IssueProviderStore
    providerService: IssueProviderService
    adapterRegistry: AdapterRegistry
    dispatch: (event: DataBusEvent) => void
    intervalMs?: number
  }) {
    this.changeQueueStore = deps.changeQueueStore
    this.issueStore = deps.issueStore
    this.providerStore = deps.providerStore
    this.providerService = deps.providerService
    this.adapterRegistry = deps.adapterRegistry
    this.dispatch = deps.dispatch
    this.intervalMs = deps.intervalMs ?? 10_000 // Default: every 10 seconds
  }

  /** Start the push engine polling loop. */
  start(): void {
    if (this.timer) return

    log.info(`Starting push engine, processing every ${this.intervalMs}ms`)

    // Process immediately on start, then on interval
    this.processQueue().catch((err) =>
      log.error('Initial push queue processing failed:', err)
    )

    this.timer = setInterval(() => {
      this.processQueue().catch((err) =>
        log.error('Scheduled push queue processing failed:', err)
      )
    }, this.intervalMs)
  }

  /** Stop the push engine. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      log.info('Push engine stopped')
    }
  }

  /** Trigger an immediate processing run (e.g., after enqueueing). */
  async flush(): Promise<void> {
    await this.processQueue()
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      // Atomically claim entries (status pending → processing in one transaction).
      // Prevents duplicate processing when multiple processQueue() calls overlap.
      const entries = await this.changeQueueStore.claimPending(10)
      if (entries.length === 0) return

      log.debug(`Processing ${entries.length} claimed queue entries`)

      for (const entry of entries) {
        await this.processEntry(entry)
      }
    } catch (err) {
      log.error('Queue processing error:', err)
    } finally {
      this.processing = false
    }
  }

  private async processEntry(entry: ChangeQueueEntry): Promise<void> {
    // Backoff filtering is now handled at the SQL level in claimPending(),
    // so all claimed entries are ready for processing.

    try {
      const provider = await this.providerStore.get(entry.providerId)
      if (!provider) {
        await this.changeQueueStore.markFailed(entry.id, 'Provider not found')
        return
      }

      const token = await this.providerService.getToken(provider)
      if (!token) {
        await this.changeQueueStore.markFailed(entry.id, 'Token not found')
        return
      }

      const adapter = this.adapterRegistry.createWriteAdapter(provider, token)

      const payload = JSON.parse(entry.payload) as Record<string, unknown>
      const issue = await this.issueStore.get(entry.localIssueId)

      switch (entry.operation) {
        case 'create': {
          const input: CreateRemoteIssueInput = {
            title: (payload.title as string) ?? '',
            body: (payload.body as string) ?? '',
            labels: (payload.labels as string[]) ?? [],
          }
          const remoteIssue = await adapter.createIssue(input)

          // Update local issue with remote metadata
          if (issue) {
            await this.issueStore.update(entry.localIssueId, {
              remoteNumber: remoteIssue.number,
              remoteUrl: remoteIssue.url,
              remoteState: remoteIssue.state,
              remoteSyncedAt: Date.now(),
              remoteUpdatedAt: new Date(remoteIssue.updatedAt).getTime(),
              syncStatus: 'synced',
            })
          }

          log.info(`Created remote issue #${remoteIssue.number} from local ${entry.localIssueId}`)
          break
        }

        case 'update': {
          if (!issue?.remoteNumber) {
            await this.changeQueueStore.markFailed(entry.id, 'No remote number for update')
            return
          }
          const input: UpdateRemoteIssueInput = {}
          if (payload.title !== undefined) input.title = payload.title as string
          if (payload.body !== undefined) input.body = payload.body as string
          if (payload.labels !== undefined) input.labels = payload.labels as string[]

          const remoteIssue = await adapter.updateIssue(issue.remoteNumber, input)

          await this.issueStore.update(entry.localIssueId, {
            remoteSyncedAt: Date.now(),
            remoteUpdatedAt: new Date(remoteIssue.updatedAt).getTime(),
            syncStatus: 'synced',
          })

          log.info(`Updated remote issue #${issue.remoteNumber}`)
          break
        }

        case 'close': {
          if (!issue?.remoteNumber) {
            await this.changeQueueStore.markFailed(entry.id, 'No remote number for close')
            return
          }
          // Push bundled field changes (title/body/labels) before closing
          if (payload.title !== undefined || payload.body !== undefined || payload.labels !== undefined) {
            const fieldInput: UpdateRemoteIssueInput = {}
            if (payload.title !== undefined) fieldInput.title = payload.title as string
            if (payload.body !== undefined) fieldInput.body = payload.body as string
            if (payload.labels !== undefined) fieldInput.labels = payload.labels as string[]
            await adapter.updateIssue(issue.remoteNumber, fieldInput)
          }
          await adapter.closeIssue(issue.remoteNumber)

          await this.issueStore.update(entry.localIssueId, {
            remoteState: 'closed',
            remoteSyncedAt: Date.now(),
            syncStatus: 'synced',
          })

          log.info(`Closed remote issue #${issue.remoteNumber}`)
          break
        }

        case 'reopen': {
          if (!issue?.remoteNumber) {
            await this.changeQueueStore.markFailed(entry.id, 'No remote number for reopen')
            return
          }
          // Push bundled field changes (title/body/labels) before reopening
          if (payload.title !== undefined || payload.body !== undefined || payload.labels !== undefined) {
            const fieldInput: UpdateRemoteIssueInput = {}
            if (payload.title !== undefined) fieldInput.title = payload.title as string
            if (payload.body !== undefined) fieldInput.body = payload.body as string
            if (payload.labels !== undefined) fieldInput.labels = payload.labels as string[]
            await adapter.updateIssue(issue.remoteNumber, fieldInput)
          }
          await adapter.reopenIssue(issue.remoteNumber)

          await this.issueStore.update(entry.localIssueId, {
            remoteState: 'open',
            remoteSyncedAt: Date.now(),
            syncStatus: 'synced',
          })

          log.info(`Reopened remote issue #${issue.remoteNumber}`)
          break
        }

        case 'comment': {
          if (!issue?.remoteNumber) {
            await this.changeQueueStore.markFailed(entry.id, 'No remote number for comment')
            return
          }
          const body = (payload.body as string) ?? ''
          await adapter.createComment(issue.remoteNumber, body)

          log.info(`Created comment on remote issue #${issue.remoteNumber}`)
          break
        }

        default:
          await this.changeQueueStore.markFailed(entry.id, `Unknown operation: ${entry.operation}`)
          return
      }

      // Mark completed
      await this.changeQueueStore.markCompleted(entry.id)
      this.dispatch({ type: 'change-queue:updated', payload: { providerId: entry.providerId } })
      this.dispatch({ type: 'issues:invalidated', payload: {} })

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`Failed to process entry ${entry.id}:`, message)

      // Classify error: permanent errors should not be retried.
      // Force immediate failure for non-transient errors.
      if (isPermanentError(err)) {
        log.warn(`Permanent error for entry ${entry.id}, marking as failed immediately`)
        await this.changeQueueStore.markFailed(entry.id, `[permanent] ${message}`, true)
      } else {
        await this.changeQueueStore.markFailed(entry.id, message)
      }
      this.dispatch({ type: 'change-queue:updated', payload: { providerId: entry.providerId } })
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** HTTP status codes that indicate a permanent (non-retryable) error. */
const PERMANENT_STATUS_CODES = new Set([
  400, // Bad request (malformed payload)
  401, // Unauthorized (invalid/expired token)
  403, // Forbidden (no permission)
  404, // Not found (repo deleted, issue deleted)
  410, // Gone
  422, // Unprocessable entity (validation error)
])

/**
 * Classify whether an error is permanent (should not be retried).
 * Transient errors (network failures, 5xx, rate limits) are retryable.
 */
function isPermanentError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false

  // Octokit and Gitbeaker both expose `status` on HTTP errors
  const status = (err as { status?: number }).status
  if (typeof status === 'number') {
    // Rate limit (429) is transient — should be retried
    if (status === 429) return false
    return PERMANENT_STATUS_CODES.has(status)
  }

  // Network errors (ECONNREFUSED, ETIMEDOUT, etc.) are transient
  const code = (err as { code?: string }).code
  if (typeof code === 'string' && /^(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|ECONNRESET)$/.test(code)) {
    return false
  }

  return false
}
