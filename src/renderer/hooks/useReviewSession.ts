// SPDX-License-Identifier: Apache-2.0

/**
 * useReviewSession — Manages the lifecycle of a review chat session.
 *
 * Responsibilities:
 *   - Find an existing review session from persistent managedSessions
 *   - Create a new session on first message (lazy initialization)
 *   - Route subsequent messages via send / resume
 *   - Inject file change context via contextSystemPrompt
 *
 * This hook extracts all session business logic out of ReviewChatPanel,
 * keeping the UI component purely presentational.
 */
import { useState, useCallback } from 'react'
import { useCommandStore, selectSessionMessages } from '@/stores/commandStore'
import { startSession } from '@/actions/commandActions'
import { useProjectScope } from '@/contexts/ProjectScopeContext'
import { findReviewSession, buildReviewOrigin } from '@/components/DetailPanel/SessionPanel/reviewTypes'
import { buildReviewContextPrompt } from '@/components/DetailPanel/SessionPanel/reviewChatUtils'
import type { ReviewContext } from '@/components/DetailPanel/SessionPanel/reviewTypes'
import type { FileChangesResult } from '@/components/DetailPanel/SessionPanel/extractFileChanges'
import type { UserMessageContent, SessionSnapshot, ManagedSessionState, ManagedSessionMessage } from '@shared/types'

// ─── Return type ─────────────────────────────────────────────────────────────

export interface ReviewSessionState {
  /** The review session (from persistent store or just-created), or undefined */
  session: SessionSnapshot | undefined
  /** Messages from the review session */
  messages: ManagedSessionMessage[]
  /** Current session state */
  sessionState: ManagedSessionState | undefined
  /** Whether the agent is actively processing */
  isProcessing: boolean
  /** Whether a new session is being created (first message) */
  isCreating: boolean
  /** Whether a message is being sent */
  isSending: boolean
  /**
   * Send a message to the review session.
   * On first call, creates the session; subsequent calls use send/resume.
   * Accepts structured UserMessageContent (string or block array).
   * Returns true on success, false on failure.
   */
  send: (content: UserMessageContent) => Promise<boolean>
  /** Stop the review session. No-op if no session is active. */
  stop: () => void
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useReviewSession(
  context: ReviewContext,
  fileChanges: FileChangesResult,
): ReviewSessionState {
  const { projectPath } = useProjectScope()

  // ── Store ──
  const sendMessage = useCommandStore((s) => s.sendMessage)
  const resumeSession = useCommandStore((s) => s.resumeSession)
  const stopSession = useCommandStore((s) => s.stopSession)
  // Bridge state: holds the session ID between creation and it appearing in managedSessions
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isSending, setIsSending] = useState(false)

  // ── Restore existing session by matching origin fields ──
  //
  // Two-phase ID-first lookup:
  //   Phase 1 — Find the review session ID via origin matching (returns a
  //             primitive string, so `Object.is` is value-based and stable).
  //   Phase 2 — Look up the full SessionSnapshot by the resolved ID using
  //             a narrow `sessionById[id]` selector.
  //
  // This design is robust by construction: Phase 1 returns a primitive
  // (not an object reference), so it never re-renders due to store-internal
  // reference replacement during batch upserts.  Phase 2 indexes into
  // `sessionById` by a specific ID, so changes to OTHER sessions are
  // invisible.  Only changes to THIS session trigger re-render — which is
  // the correct behavior for displaying state/error/duration.
  const existingSessionId = useCommandStore((s) =>
    findReviewSession(s.managedSessions, context)?.id ?? null,
  )

  // Resolve the final session ID: existing (persisted) takes priority over
  // just-created (bridge state before store sync).
  const resolvedSessionId = existingSessionId ?? createdSessionId

  // ── Derived session ──
  const session: SessionSnapshot | undefined = useCommandStore((s) =>
    resolvedSessionId ? (s.sessionById[resolvedSessionId] ?? undefined) : undefined,
  )

  const sessionState = session?.state
  const isProcessing = sessionState === 'creating' || sessionState === 'streaming'
  const isResumable =
    sessionState === 'idle' || sessionState === 'stopped' || sessionState === 'error'
  // Read messages from decoupled sessionMessages store for streaming performance.
  const messages = useCommandStore((s) => selectSessionMessages(s, session?.id ?? null))

  // ── Send ──
  const send = useCallback(
    async (content: UserMessageContent): Promise<boolean> => {
      // Guard: empty content
      const isEmpty =
        typeof content === 'string'
          ? content.trim().length === 0
          : !Array.isArray(content) || content.length === 0
      if (isEmpty || isSending || isCreating) return false

      setIsSending(true)
      try {
        if (!resolvedSessionId) {
          // First message — create session with file change context
          setIsCreating(true)
          const contextPrompt = buildReviewContextPrompt(fileChanges, context)
          const origin = buildReviewOrigin(context)

          const newId = await startSession({
            prompt: content,
            origin,
            projectPath,
            contextSystemPrompt: contextPrompt,
          })

          if (newId) {
            setCreatedSessionId(newId)
            setIsCreating(false)
            return true
          }
          setIsCreating(false)
          return false
        }

        // Subsequent messages — send or resume
        if (isResumable) {
          return resumeSession(resolvedSessionId, content)
        }
        return sendMessage(resolvedSessionId, content)
      } finally {
        setIsSending(false)
        setIsCreating(false)
      }
    },
    [
      isSending, isCreating, resolvedSessionId, isResumable,
      fileChanges, context, projectPath,
      sendMessage, resumeSession,
    ],
  )

  // ── Stop ──
  const stop = useCallback(() => {
    if (resolvedSessionId) {
      stopSession(resolvedSessionId)
    }
  }, [resolvedSessionId, stopSession])

  return {
    session,
    messages,
    sessionState,
    isProcessing,
    isCreating,
    isSending,
    send,
    stop,
  }
}
