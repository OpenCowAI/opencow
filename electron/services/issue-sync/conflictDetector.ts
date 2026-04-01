// SPDX-License-Identifier: Apache-2.0

import type { Issue, ConflictResult } from '../../../src/shared/types'
import type { RemoteIssue } from './remoteAdapter'

/**
 * Conflict detection for bidirectional issue sync.
 *
 * ## Phase 2 Strategy (no snapshot)
 *
 * Without a sync snapshot column, true field-level three-way merge is impossible.
 * We cannot distinguish "local changed title" from "remote changed title" when
 * both differ from each other — we only see the two current values, not the base.
 *
 * Phase 2 uses a pragmatic timestamp-based strategy:
 *
 * 1. **syncStatus === 'synced' or null** → fast-forward (remote wins)
 * 2. **syncStatus === 'local_ahead' + remote NOT updated** → local wins (push will update remote)
 * 3. **syncStatus === 'local_ahead' + remote ALSO updated** → conflict (both sides changed)
 *
 * For case 3, we mark it as 'manual' conflict with the full issue diff.
 * The UI will present "Use Local / Use Remote / Edit Manually" options.
 *
 * Phase 3 will add a `sync_snapshot` JSON column to enable true field-level
 * auto-merge (different fields changed → merge automatically).
 */

/**
 * Detect conflicts between a local issue and its remote counterpart.
 *
 * @param local - The local issue (current state in DB).
 * @param remote - The freshly-fetched remote issue.
 * @returns Conflict detection result with resolution type.
 */
export function detectConflict(local: Issue, remote: RemoteIssue): ConflictResult {
  // 1. Local not modified since last sync → fast-forward (accept remote)
  if (local.syncStatus === 'synced' || local.syncStatus === null) {
    return { type: 'fast-forward' }
  }

  // 2. Local is ahead — check if remote also changed
  const remoteUpdatedAt = new Date(remote.updatedAt).getTime()

  if (local.remoteUpdatedAt && remoteUpdatedAt <= local.remoteUpdatedAt) {
    // Remote hasn't changed since our last sync → no conflict, local wins.
    // PushEngine will update remote with our local changes.
    return { type: 'fast-forward' }
  }

  // 3. Both sides changed (local_ahead + remote updated after our last sync).
  //    Without a snapshot, we cannot do field-level auto-merge.
  //    Report all differing fields as conflicts for manual resolution.
  const conflictFields = buildConflictDiff(local, remote)

  if (conflictFields.length === 0) {
    // Values are actually identical despite timestamps — no real conflict
    return { type: 'fast-forward' }
  }

  return {
    type: 'manual',
    conflictFields,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Build a diff of all fields that differ between local and remote.
 * Since we have no base snapshot, all differing fields are reported
 * as conflicts (conservative approach).
 */
function buildConflictDiff(local: Issue, remote: RemoteIssue) {
  const conflicts: Array<{ field: string; localValue: unknown; remoteValue: unknown; baseValue: unknown }> = []

  if (local.title !== remote.title) {
    conflicts.push({ field: 'title', localValue: local.title, remoteValue: remote.title, baseValue: null })
  }

  if (local.description !== remote.body) {
    conflicts.push({ field: 'description', localValue: local.description, remoteValue: remote.body, baseValue: null })
  }

  // Labels comparison (order-independent)
  const localLabels = new Set(local.labels)
  const remoteLabels = new Set(remote.labels)
  if (localLabels.size !== remoteLabels.size || ![...localLabels].every((l) => remoteLabels.has(l))) {
    conflicts.push({ field: 'labels', localValue: local.labels, remoteValue: remote.labels, baseValue: null })
  }

  return conflicts
}
