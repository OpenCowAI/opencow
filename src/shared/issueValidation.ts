// SPDX-License-Identifier: Apache-2.0

/**
 * Pure validation functions for Issue parent-child relationships.
 * Shared between frontend (real-time visual feedback) and backend (data integrity).
 *
 * Design: accepts pre-resolved data rather than lookup callbacks, so callers
 * can fetch data however they need (sync Map lookup on frontend, async DB
 * query on backend) without leaking that concern into validation.
 */

/** Reason why a parent-child relationship is invalid. */
export type ParentChildError =
  | 'self' // Cannot parent to self
  | 'not-found' // Source or target issue not found
  | 'target-is-child' // Target is already a sub-issue (single-level nesting only)
  | 'source-has-children' // Source has children (would create multi-level nesting)
  | 'already-child' // Source is already a child of target (no-op)
  | 'target-is-done' // Target issue is done — cannot add sub-issues to completed issues

export interface ParentChildValidation {
  valid: boolean
  error: ParentChildError | null
}

/** Minimal Issue shape needed for validation (avoids importing full Issue type). */
export interface IssueLike {
  parentIssueId: string | null
  status?: string
}

/** Pre-resolved context for parent-child validation. */
export interface SetParentInput {
  sourceId: string
  targetId: string
  /** The source issue data, or null if not found. */
  source: IssueLike | null
  /** The target issue data, or null if not found. */
  target: IssueLike | null
  /** Whether the source issue currently has any children. */
  sourceHasChildren: boolean
}

/**
 * Validate whether `sourceId` can be made a child of `targetId`.
 *
 * Rules (single-level nesting):
 * 1. Cannot parent to self
 * 2. Source and target must exist
 * 3. Target must be a top-level issue (not already a child)
 * 4. Target must not be in "done" status
 * 5. Source must not have children (would create multi-level nesting)
 * 6. Source is already a child of target (no-op, not an error but nothing to do)
 */
export function validateSetParent(input: SetParentInput): ParentChildValidation {
  const { sourceId, targetId, source, target, sourceHasChildren } = input

  if (sourceId === targetId) {
    return { valid: false, error: 'self' }
  }

  if (!source || !target) {
    return { valid: false, error: 'not-found' }
  }

  // Target must be a top-level issue
  if (target.parentIssueId !== null) {
    return { valid: false, error: 'target-is-child' }
  }

  // Target must not be in "done" status — cannot add sub-issues to completed issues
  if (target.status === 'done') {
    return { valid: false, error: 'target-is-done' }
  }

  // Source must not have children of its own
  if (sourceHasChildren) {
    return { valid: false, error: 'source-has-children' }
  }

  // Already a child of this parent — no-op
  if (source.parentIssueId === targetId) {
    return { valid: false, error: 'already-child' }
  }

  return { valid: true, error: null }
}
