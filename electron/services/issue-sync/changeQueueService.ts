// SPDX-License-Identifier: Apache-2.0

import { nanoid } from 'nanoid'
import type { ChangeQueueStore } from './changeQueueStore'
import type { ChangeQueueEntry, ChangeQueueOperation, DataBusEvent, Issue } from '../../../src/shared/types'
import { tiptapToMarkdown } from './markdownConverter'

/**
 * Business logic for the issue change queue.
 *
 * Handles:
 * - Enqueuing changes with automatic merge strategies
 * - Converting TipTap content to Markdown for push
 *
 * ## Merge Strategies (applied at enqueue time)
 *
 * | Existing | New      | Result                                       |
 * |----------|----------|----------------------------------------------|
 * | update   | update   | Merge into latest payload                    |
 * | create   | update   | Update the create payload                    |
 * | create   | close    | Cancel both (delete both entries)             |
 * | update   | close    | Keep close only (delete update)               |
 * | *        | comment  | Always enqueue (no merge for comments)        |
 */
export class ChangeQueueService {
  private readonly store: ChangeQueueStore
  private readonly dispatch: (event: DataBusEvent) => void

  constructor(deps: {
    store: ChangeQueueStore
    dispatch: (event: DataBusEvent) => void
  }) {
    this.store = deps.store
    this.dispatch = deps.dispatch
  }

  /**
   * Enqueue a create operation after a local issue is created.
   * Converts richContent to Markdown for the remote payload.
   */
  async enqueueCreate(issue: Issue): Promise<void> {
    if (!issue.providerId) return

    const body = tiptapToMarkdown(issue.richContent) || issue.description
    const payload = JSON.stringify({
      title: issue.title,
      body,
      labels: issue.labels,
    })

    await this.enqueue(issue.id, issue.providerId, 'create', payload)
  }

  /**
   * Enqueue an update operation after a local issue is updated.
   * Only includes the changed fields in the payload.
   */
  async enqueueUpdate(issue: Issue, changedFields: Partial<Issue>): Promise<void> {
    if (!issue.providerId) return

    const payload = this.buildFieldPayload(issue, changedFields)
    if (Object.keys(payload).length === 0) return

    await this.enqueue(issue.id, issue.providerId, 'update', JSON.stringify(payload))
  }

  /**
   * Enqueue a close operation, optionally bundled with field changes.
   *
   * When `fieldChanges` is provided, any pending update entries are folded
   * into the close payload so that PushEngine can push field changes before
   * closing. This avoids the race condition where a separate enqueueUpdate
   * would be deleted by the close merge strategy.
   */
  async enqueueClose(issue: Issue, fieldChanges?: Partial<Issue>): Promise<void> {
    if (!issue.providerId) return

    let payload = '{}'
    if (fieldChanges) {
      const fields = this.buildFieldPayload(issue, fieldChanges)
      if (Object.keys(fields).length > 0) {
        payload = JSON.stringify(fields)
      }
    }

    await this.enqueue(issue.id, issue.providerId, 'close', payload)
  }

  /**
   * Enqueue a reopen operation, optionally bundled with field changes.
   */
  async enqueueReopen(issue: Issue, fieldChanges?: Partial<Issue>): Promise<void> {
    if (!issue.providerId) return

    let payload = '{}'
    if (fieldChanges) {
      const fields = this.buildFieldPayload(issue, fieldChanges)
      if (Object.keys(fields).length > 0) {
        payload = JSON.stringify(fields)
      }
    }

    await this.enqueue(issue.id, issue.providerId, 'reopen', payload)
  }

  /** Enqueue a comment push. Comments are never merged. */
  async enqueueComment(issueId: string, providerId: string, body: string): Promise<void> {
    const payload = JSON.stringify({ body })
    const entry = makeEntry(issueId, providerId, 'comment', payload)
    await this.store.enqueue(entry)
    this.dispatch({ type: 'change-queue:updated', payload: { providerId } })
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  /** Build the remote-pushable field payload from changed fields. */
  private buildFieldPayload(issue: Issue, changedFields: Partial<Issue>): Record<string, unknown> {
    const payload: Record<string, unknown> = {}
    if (changedFields.title !== undefined) payload.title = changedFields.title
    if (changedFields.description !== undefined || changedFields.richContent !== undefined) {
      payload.body = tiptapToMarkdown(issue.richContent) || issue.description
    }
    if (changedFields.labels !== undefined) payload.labels = changedFields.labels
    return payload
  }

  /**
   * Core enqueue with transactional merge strategy.
   *
   * The entire read-modify-write cycle (read pending → apply merge → insert/update)
   * runs inside a single DB transaction to prevent concurrent enqueue calls from
   * producing duplicate entries or incorrect merges.
   */
  private async enqueue(
    localIssueId: string,
    providerId: string,
    operation: ChangeQueueOperation,
    payload: string,
  ): Promise<void> {
    await this.store.withTransaction(async (txStore) => {
      // Apply merge strategies before inserting
      const existing = await txStore.getPendingForIssue(localIssueId)
      const merged = await this.applyMergeStrategies(existing, operation, payload, txStore)

      if (!merged) {
        // Merge strategy cancelled the operation (e.g., create + close → cancel both)
        return
      }

      const entry = makeEntry(localIssueId, providerId, merged.operation, merged.payload)
      await txStore.enqueue(entry)
    })
    this.dispatch({ type: 'change-queue:updated', payload: { providerId } })
  }

  /**
   * Apply merge strategies against existing pending entries for the same issue.
   *
   * All DB operations go through `txStore` (transactional store) to ensure
   * the entire read-modify-write cycle is atomic.
   *
   * Returns the (possibly modified) operation+payload to enqueue,
   * or null if the operation should be cancelled entirely.
   */
  private async applyMergeStrategies(
    existing: ChangeQueueEntry[],
    newOp: ChangeQueueOperation,
    newPayload: string,
    txStore: ChangeQueueStore,
  ): Promise<{ operation: ChangeQueueOperation; payload: string } | null> {
    // Comments are never merged
    if (newOp === 'comment') return { operation: newOp, payload: newPayload }

    if (newOp === 'update') {
      // Scan for the best merge target: prefer 'create' (absorb update into create),
      // otherwise merge into the LAST 'update' entry.
      let createEntry: ChangeQueueEntry | null = null
      let lastUpdateEntry: ChangeQueueEntry | null = null

      for (const entry of existing) {
        if (entry.operation === 'create') createEntry = entry
        if (entry.operation === 'update') lastUpdateEntry = entry
      }

      // create + update → update the create payload
      if (createEntry) {
        const mergedPayload = mergeJsonPayloads(createEntry.payload, newPayload)
        await txStore.updatePayload(createEntry.id, mergedPayload)
        return null
      }

      // update + update → merge into the last existing update
      if (lastUpdateEntry) {
        const mergedPayload = mergeJsonPayloads(lastUpdateEntry.payload, newPayload)
        await txStore.updatePayload(lastUpdateEntry.id, mergedPayload)
        return null
      }
    }

    if (newOp === 'close' || newOp === 'reopen') {
      // Collect entries to process; create entries need special handling per operation.
      const updateIdsToDelete: string[] = []
      let createEntry: ChangeQueueEntry | null = null
      let foldedPayload = newPayload

      for (const entry of existing) {
        if (entry.operation === 'create') {
          createEntry = entry
        } else if (entry.operation === 'update') {
          // Fold older update payload under the newer close/reopen's field changes.
          // mergeJsonPayloads(a, b) = { ...a, ...b } — second arg wins.
          // entry.payload is older, foldedPayload carries the newest intent → keep it on top.
          foldedPayload = mergeJsonPayloads(entry.payload, foldedPayload)
          updateIdsToDelete.push(entry.id)
        }
      }

      // create + close → cancel both (delete create, don't enqueue the close)
      if (createEntry && newOp === 'close') {
        await txStore.deleteEntries([createEntry.id, ...updateIdsToDelete])
        return null
      }

      // create + reopen → cancel reopen, keep create (issue will be created as open)
      if (createEntry && newOp === 'reopen') {
        // Only delete update entries; the create entry stays in the queue.
        if (updateIdsToDelete.length > 0) {
          await txStore.deleteEntries(updateIdsToDelete)
        }
        return null
      }

      // No create entry — just delete folded update entries
      if (updateIdsToDelete.length > 0) {
        await txStore.deleteEntries(updateIdsToDelete)
      }

      // Folded payload carries any field changes from deleted update entries
      return { operation: newOp, payload: foldedPayload }
    }

    // No merge applicable — enqueue as-is
    return { operation: newOp, payload: newPayload }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeEntry(
  localIssueId: string,
  providerId: string,
  operation: ChangeQueueOperation,
  payload: string,
): ChangeQueueEntry {
  return {
    id: nanoid(),
    localIssueId,
    providerId,
    operation,
    payload,
    status: 'pending',
    retryCount: 0,
    maxRetries: 5,
    errorMessage: null,
    createdAt: Date.now(),
    processedAt: null,
  }
}

/** Deep-merge two JSON payloads (new values overwrite old). */
function mergeJsonPayloads(existingJson: string, newJson: string): string {
  try {
    const existing = JSON.parse(existingJson)
    const updated = JSON.parse(newJson)
    return JSON.stringify({ ...existing, ...updated })
  } catch {
    // If either payload is malformed, prefer the new one
    return newJson
  }
}
