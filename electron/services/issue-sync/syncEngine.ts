// SPDX-License-Identifier: Apache-2.0

import { nanoid } from 'nanoid'
import { createLogger } from '../../platform/logger'
import type { IssueStore } from '../issueStore'
import type { IssueProviderStore } from '../issueProviderStore'
import type { IssueProviderService } from '../issueProviderService'
import type { AdapterRegistry } from './adapterRegistry'
import type { RemoteIssue } from './remoteAdapter'
import type { Issue, IssueProvider, DataBusEvent } from '../../../src/shared/types'

const log = createLogger('IssueSyncEngine')

/**
 * Pull-only sync engine for GitHub/GitLab issues.
 *
 * Phase 1: Read-only — pulls remote issues into local SQLite DB.
 * - Scheduled polling per provider's `sync_interval_s`
 * - Batch upsert in a single transaction
 * - Single DataBus notification after batch completes (§10.4)
 * - First sync: maps open→backlog, closed→done
 * - Incremental sync: only updates remote metadata, preserves local status
 */
export class IssueSyncEngine {
  private readonly issueStore: IssueStore
  private readonly providerStore: IssueProviderStore
  private readonly providerService: IssueProviderService
  private readonly adapterRegistry: AdapterRegistry
  private readonly dispatch: (event: DataBusEvent) => void

  /** Active polling timers keyed by provider ID. */
  private timers = new Map<string, ReturnType<typeof setInterval>>()

  /** Track in-progress syncs to prevent overlap. */
  private syncing = new Set<string>()

  constructor(deps: {
    issueStore: IssueStore
    providerStore: IssueProviderStore
    providerService: IssueProviderService
    adapterRegistry: AdapterRegistry
    dispatch: (event: DataBusEvent) => void
  }) {
    this.issueStore = deps.issueStore
    this.providerStore = deps.providerStore
    this.providerService = deps.providerService
    this.adapterRegistry = deps.adapterRegistry
    this.dispatch = deps.dispatch
  }

  /**
   * Start polling for all enabled providers.
   * Called once at app startup.
   */
  async start(): Promise<void> {
    const providers = await this.providerStore.listEnabled()
    log.info(`Starting sync engine for ${providers.length} enabled provider(s)`)

    for (const provider of providers) {
      this.scheduleProvider(provider)
    }
  }

  /** Stop all polling timers. Called on app shutdown. */
  stop(): void {
    for (const [id, timer] of this.timers) {
      clearInterval(timer)
      log.debug(`Stopped polling for provider ${id}`)
    }
    this.timers.clear()
  }

  /**
   * Reschedule polling for a specific provider (e.g. after config update).
   * Stops existing timer if any, then starts a new one if enabled.
   */
  async rescheduleProvider(providerId: string): Promise<void> {
    // Clear existing timer
    const existing = this.timers.get(providerId)
    if (existing) {
      clearInterval(existing)
      this.timers.delete(providerId)
    }

    const provider = await this.providerStore.get(providerId)
    if (provider && provider.syncEnabled) {
      this.scheduleProvider(provider)
    }
  }

  /**
   * Trigger an immediate sync for a specific provider.
   * Called from IPC handler (manual "Sync Now" button).
   */
  async pullNow(providerId: string): Promise<void> {
    await this.syncProvider(providerId)
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private scheduleProvider(provider: IssueProvider): void {
    const intervalMs = provider.syncIntervalS * 1000
    const providerId = provider.id

    // Run first sync immediately (non-blocking)
    this.syncProvider(providerId).catch((err) =>
      log.error(`Initial sync failed for ${providerId}:`, err)
    )

    // Schedule recurring sync — uses providerId, not the stale provider object.
    // Each tick re-reads the provider from DB so lastSyncedAt / config changes are respected.
    const timer = setInterval(() => {
      this.syncProvider(providerId).catch((err) =>
        log.error(`Scheduled sync failed for ${providerId}:`, err)
      )
    }, intervalMs)

    this.timers.set(providerId, timer)
    log.info(`Scheduled polling for ${provider.platform}:${provider.repoOwner}/${provider.repoName} every ${provider.syncIntervalS}s`)
  }

  private async syncProvider(providerId: string): Promise<void> {
    if (this.syncing.has(providerId)) {
      log.debug(`Sync already in progress for ${providerId}, skipping`)
      return
    }

    this.syncing.add(providerId)

    try {
      // Re-read from DB on every tick to get fresh lastSyncedAt and config
      const provider = await this.providerStore.get(providerId)
      if (!provider) {
        log.warn(`Provider ${providerId} no longer exists, skipping sync`)
        return
      }

      const token = await this.providerService.getToken(provider)
      if (!token) {
        log.error(`No token found for provider ${providerId}`)
        return
      }

      const adapter = this.adapterRegistry.createAdapter(provider, token)
      const isFirstSync = provider.lastSyncedAt === null
      const sinceDate = provider.lastSyncedAt ? new Date(provider.lastSyncedAt) : undefined

      log.info(`${isFirstSync ? 'Full' : 'Incremental'} sync starting for ${adapter.label}`)

      // Fetch all pages (with safety limit to prevent infinite loops from adapter bugs)
      // Supports both page-based (GitHub/GitLab) and cursor-based (Linear) pagination.
      const MAX_PAGES = 200 // 200 pages × 100/page = 20,000 issues max
      const allRemoteIssues: RemoteIssue[] = []
      let page = 1
      let cursor: string | undefined
      let hasMore = true

      while (hasMore && page <= MAX_PAGES) {
        const result = await adapter.listIssues({
          since: sinceDate,
          page,
          cursor,
          perPage: 100,
          state: 'all',
        })
        allRemoteIssues.push(...result.issues)
        hasMore = result.hasNextPage
        // Advance: use nextCursor if present (cursor-based), else nextPage (page-based)
        cursor = result.nextCursor
        page = result.nextPage ?? page + 1
      }

      if (page > MAX_PAGES) {
        log.warn(`Pagination limit reached (${MAX_PAGES} pages) for ${adapter.label}, sync may be incomplete`)
      }

      log.info(`Fetched ${allRemoteIssues.length} remote issues from ${adapter.label}`)

      if (allRemoteIssues.length === 0) {
        // Update last_synced_at even if no changes
        await this.providerStore.update(provider.id, { lastSyncedAt: Date.now() })
        this.dispatch({ type: 'issue-providers:changed', payload: { projectId: provider.projectId } })
        return
      }

      // Batch lookup — single query instead of N+1 individual SELECTs
      const remoteNumbers = allRemoteIssues.map((r) => r.number)
      const existingMap = await this.issueStore.findByRemoteNumbers(provider.id, remoteNumbers)

      // Upsert: new issues → batchAdd, existing → batchUpdate
      const toInsert: Issue[] = []
      const toUpdate: Array<{ id: string; patch: Partial<Issue> }> = []

      for (const remote of allRemoteIssues) {
        const existing = existingMap.get(remote.number)
        const now = Date.now()

        if (existing) {
          // Incremental: only update remote metadata, preserve local status
          toUpdate.push({
            id: existing.id,
            patch: {
              title: remote.title,
              description: remote.body,
              labels: remote.labels,
              remoteState: remote.state,
              remoteUrl: remote.url,
              remoteSyncedAt: now,
            },
          })
        } else {
          // First time seeing this remote issue → create local copy
          const newIssue: Issue = {
            id: nanoid(),
            title: remote.title,
            description: remote.body,
            richContent: null,
            status: mapRemoteStateToLocalStatus(remote.state, isFirstSync),
            priority: 'medium',
            labels: remote.labels,
            projectId: provider.projectId,
            sessionId: null,
            sessionHistory: [],
            parentIssueId: null,
            images: [],
            createdAt: new Date(remote.createdAt).getTime(),
            updatedAt: now,
            readAt: null,
            lastAgentActivityAt: null,
            contextRefs: [],
            // Remote tracking
            providerId: provider.id,
            remoteNumber: remote.number,
            remoteUrl: remote.url,
            remoteState: remote.state,
            remoteSyncedAt: now,
            // Phase 2
            assignees: null,  // TODO: populate from remote.assignees in Phase 2 adapter extension
            milestone: null,  // TODO: populate from remote.milestone in Phase 2 adapter extension
            syncStatus: 'synced',
            remoteUpdatedAt: new Date(remote.updatedAt).getTime(),
          }
          toInsert.push(newIssue)
        }
      }

      // Atomic batch upsert — inserts + updates in a single transaction (§10.4)
      // Prevents partial sync states where new issues are visible but updates are not.
      await this.issueStore.batchUpsert(toInsert, toUpdate)
      if (toInsert.length > 0) log.info(`Inserted ${toInsert.length} new issues from ${adapter.label}`)
      if (toUpdate.length > 0) log.info(`Updated ${toUpdate.length} issues from ${adapter.label}`)

      // Update last_synced_at
      await this.providerStore.update(provider.id, { lastSyncedAt: Date.now() })

      // Single DataBus notification for the entire batch
      this.dispatch({ type: 'issues:invalidated', payload: {} })
      this.dispatch({ type: 'issue-providers:changed', payload: { projectId: provider.projectId } })

      log.info(`Sync complete for ${adapter.label}: ${toInsert.length} new, ${toUpdate.length} updated`)
    } catch (err) {
      log.error(`Sync failed for provider ${providerId}:`, err)
    } finally {
      this.syncing.delete(providerId)
    }
  }
}

/**
 * Map remote issue state to local IssueStatus.
 *
 * Handles all three platforms:
 * - GitHub:  'open' | 'closed'
 * - GitLab:  'opened' | 'closed'
 * - Linear:  'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled'
 *            (WorkflowState category, set by LinearAdapter.mapLinearIssue)
 *
 * For first sync, all states are mapped. For incremental sync, only remote_state
 * is updated — the caller preserves the existing local status.
 */
function mapRemoteStateToLocalStatus(
  remoteState: string,
  _isFirstSync: boolean,
): Issue['status'] {
  const normalized = remoteState.toLowerCase()

  switch (normalized) {
    // GitHub/GitLab closed states
    case 'closed':
      return 'done'

    // Linear WorkflowState categories (1:1 mapping with OpenCow statuses)
    case 'backlog':
      return 'backlog'
    case 'unstarted':
      return 'todo'
    case 'started':
      return 'in_progress'
    case 'completed':
      return 'done'
    case 'cancelled':
      return 'cancelled'

    // GitHub 'open', GitLab 'opened', or any unknown state → backlog
    default:
      return 'backlog'
  }
}
