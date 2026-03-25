// SPDX-License-Identifier: Apache-2.0

/**
 * reviewTypes — Type definitions and utilities for the "Chat to Review" feature.
 *
 * Provides structured types for identifying review contexts (session-level vs
 * turn-level) and matching them against persistent SessionOrigin data.
 */
import type { SessionSnapshot, SessionOrigin } from '@shared/types'

// ─── Review Scope ────────────────────────────────────────────────────────────

/**
 * Discriminated union identifying the granularity of a code review.
 *
 * - `session`: reviewing all changes across the entire session
 * - `turn`:    reviewing changes from a single turn, anchored by the
 *              first message ID of that turn (stable across restarts)
 */
export type ReviewScope =
  | { type: 'session' }
  | { type: 'turn'; turnAnchorMessageId: string }

// ─── Review Context ──────────────────────────────────────────────────────────

/**
 * Full context needed to create or find a review session.
 * Passed as a single structured prop instead of flat issueId/sessionId/scope.
 */
export interface ReviewContext {
  /** The Issue being reviewed */
  issueId: string
  /** The original session whose changes are being reviewed */
  sessionId: string
  /** Whether reviewing all session changes or a specific turn */
  scope: ReviewScope
}

// ─── Matching ────────────────────────────────────────────────────────────────

/**
 * Check if a session's origin matches a given ReviewContext.
 * Used to find existing review sessions from the persistent store.
 */
export function matchesReviewContext(
  origin: SessionOrigin,
  context: ReviewContext,
): boolean {
  if (origin.source !== 'review') return false
  if (origin.issueId !== context.issueId) return false
  if (origin.sessionId !== context.sessionId) return false

  if (context.scope.type === 'session') {
    return origin.turnAnchorMessageId == null
  }
  return origin.turnAnchorMessageId === context.scope.turnAnchorMessageId
}

/**
 * Find an existing review session whose origin matches the given context.
 * Returns undefined if no match — caller should create a new session on first message.
 */
export function findReviewSession(
  sessions: SessionSnapshot[],
  context: ReviewContext,
): SessionSnapshot | undefined {
  return sessions.find((s) => matchesReviewContext(s.origin, context))
}

/**
 * Build the SessionOrigin for a new review session.
 */
export function buildReviewOrigin(
  context: ReviewContext,
): Extract<SessionOrigin, { source: 'review' }> {
  return {
    source: 'review',
    issueId: context.issueId,
    sessionId: context.sessionId,
    turnAnchorMessageId:
      context.scope.type === 'turn' ? context.scope.turnAnchorMessageId : undefined,
  }
}
