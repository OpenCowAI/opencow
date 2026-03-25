// SPDX-License-Identifier: Apache-2.0

/**
 * PendingQuestionRegistry — manages blocking Promises for user Q&A interactions.
 *
 * When the MCP `ask_user_question` tool handler runs, it calls `waitFor()` which
 * returns a Promise that doesn't resolve until the user answers (via card Confirm
 * or direct text input). This naturally blocks the SDK's tool execution loop.
 *
 * Two resolve paths:
 *   1. Card Confirm → IPC `command:answer-question` → `resolve(requestId, answer)`
 *   2. Direct input → `sendMessage()` → `resolveBySession(sessionId, answer)`
 *
 * Design:
 *   - Global singleton (not per-session) — both MCP handler and SessionOrchestrator
 *     need access. sessionId field enables per-session lookup when needed.
 *   - cancelAll() ensures no dangling Promises when a session ends.
 */

import { createLogger } from '../../platform/logger'

const log = createLogger('PendingQuestionRegistry')

/** Structured response from a resolved question. */
export interface QuestionResponse {
  /** The request ID that was waiting */
  requestId: string
  /** User's answer text */
  answer: string
  /** True when cancelled (session ended, timeout, etc.) */
  cancelled?: boolean
}

export class PendingQuestionRegistry {
  private readonly pending = new Map<string, {
    resolve: (response: QuestionResponse) => void
    sessionId: string
  }>()

  /**
   * Register a blocking wait. The returned Promise resolves when the user answers.
   * MCP tool handler `await`s this to block the SDK execution loop.
   */
  waitFor(requestId: string, sessionId: string): Promise<QuestionResponse> {
    return new Promise<QuestionResponse>((resolve) => {
      this.pending.set(requestId, { resolve, sessionId })
      log.info(`Registered pending question ${requestId} for session ${sessionId}`)
    })
  }

  /**
   * Resolve by requestId — called when user clicks card Confirm button.
   * @returns true if the request was found and resolved
   */
  resolve(requestId: string, answer: string): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) {
      log.warn(`No pending question found for requestId=${requestId}`)
      return false
    }
    this.pending.delete(requestId)
    entry.resolve({ requestId, answer })
    log.info(`Resolved question ${requestId} via card confirm`)
    return true
  }

  /**
   * Resolve by sessionId — called when user types directly in the input bar.
   * Finds the first pending question for the session and resolves it.
   * @returns true if a pending question was found and resolved
   */
  resolveBySession(sessionId: string, answer: string): boolean {
    for (const [requestId, entry] of this.pending) {
      if (entry.sessionId === sessionId) {
        this.pending.delete(requestId)
        entry.resolve({ requestId, answer })
        log.info(`Resolved question ${requestId} via direct input for session ${sessionId}`)
        return true
      }
    }
    return false
  }

  /** Check if a session has any pending questions. */
  hasPending(sessionId: string): boolean {
    for (const entry of this.pending.values()) {
      if (entry.sessionId === sessionId) return true
    }
    return false
  }

  /**
   * Cancel all pending questions (e.g. session stopped, error, shutdown).
   * Resolves all Promises with `cancelled: true` so handlers exit gracefully.
   */
  cancelAll(): void {
    if (this.pending.size === 0) return
    log.info(`Cancelling ${this.pending.size} pending question(s)`)
    for (const [requestId, entry] of this.pending) {
      entry.resolve({ requestId, answer: '', cancelled: true })
    }
    this.pending.clear()
  }

  /**
   * Cancel all pending questions for a specific session.
   * Used when a single session stops while others may still be active.
   */
  cancelBySession(sessionId: string): void {
    for (const [requestId, entry] of this.pending) {
      if (entry.sessionId === sessionId) {
        this.pending.delete(requestId)
        entry.resolve({ requestId, answer: '', cancelled: true })
        log.info(`Cancelled question ${requestId} for session ${sessionId}`)
      }
    }
  }

  get size(): number {
    return this.pending.size
  }
}
