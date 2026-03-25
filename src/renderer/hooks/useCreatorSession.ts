// SPDX-License-Identifier: Apache-2.0

/**
 * useCreatorSession — Generic session hook for all AI Creators.
 *
 * Extracts the common lifecycle shared by `useIssueCreatorSession`,
 * `useScheduleCreatorSession`, and `useCapabilityCreatorSession`:
 *   - Ephemeral session ID management (local state, not persisted)
 *   - Session start with domain-specific system prompt
 *   - Auto-parsing of assistant messages for structured output
 *   - Unified send/queue dispatch (with auto-start)
 *   - Optional auto-continuation for incomplete output
 *   - Cleanup (stop + delete) on unmount
 *
 * Each domain hook provides a `CreatorSessionConfig<TParsed>` that
 * parameterizes identity, prompt building, output extraction, and
 * optional auto-continuation behavior — turning domain hooks into
 * ~30-line config wrappers.
 *
 * Built on `useSessionBase` for shared session lifecycle infrastructure.
 *
 * @module
 */

import { useCallback, useMemo, useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useCommandStore, selectSessionMessages } from '@/stores/commandStore'
import { deleteSession } from '@/actions/commandActions'
import { useSessionBase } from '@/hooks/useSessionBase'
import type { UseMessageQueueReturn } from '@/hooks/useMessageQueue'
import type {
  SessionSnapshot,
  ManagedSessionMessage,
  ManagedSessionState,
  SessionOrigin,
  UserMessageContent
} from '@shared/types'

// ═══════════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════════

/** Configuration for auto-continuation of incomplete AI output. */
export interface AutoContinuationConfig<TParsed> {
  /**
   * Determine whether the parsed output needs continuation.
   * Called when the session is paused and parsedOutput is non-null.
   */
  shouldContinue: (output: TParsed) => boolean
  /**
   * Build a recovery prompt that asks the AI to complete the output.
   * Should reference specific missing parts for targeted recovery.
   */
  buildRecoveryPrompt: (output: TParsed) => string
  /** Maximum auto-continuation attempts per conversation. @default 1 */
  maxAttempts?: number
  /** Delay (ms) before sending recovery prompt. @default 300 */
  delayMs?: number
}

/** Full configuration for a creator session. */
export interface CreatorSessionConfig<TParsed> {
  /** Session identity — determines the origin tag for this creator type. */
  identity: {
    origin: SessionOrigin
  }

  /** System prompt construction. */
  prompt: {
    /** Build the system prompt from the current locale. */
    build: (locale: string) => string
  }

  /** Output extraction from assistant messages. */
  output: {
    /**
     * Extract the latest structured output from session messages.
     * Returns null if no valid output is found.
     */
    extract: (messages: ManagedSessionMessage[]) => TParsed | null
  }

  /**
   * Optional auto-continuation for incomplete output.
   * When configured, the hook will automatically send a recovery prompt
   * if the AI output is detected as incomplete after the session pauses.
   */
  autoContinuation?: AutoContinuationConfig<TParsed>

  /** Project context for the creator session. */
  project?: {
    id?: string | null
  }
}

// ═══════════════════════════════════════════════════════════════════
// Handle
// ═══════════════════════════════════════════════════════════════════

/** Return type for all creator session hooks. */
export interface CreatorSessionHandle<TParsed> {
  /** Current managed session (null before creation). */
  session: SessionSnapshot | null
  /** Whether a new session is being created. */
  isStarting: boolean
  /** Whether the agent is actively processing (creating or streaming). */
  isProcessing: boolean
  /** Whether the session is paused (idle / stopped / error). */
  isPaused: boolean
  /** Current session state shortcut. */
  state: ManagedSessionState | null

  /** Parsed output extracted from the conversation. */
  parsedOutput: TParsed | null

  /**
   * Send or queue a message. Handles:
   * - Starting a new session (if no active session)
   * - Sending to an active session
   * - Resuming a paused session
   * - Queuing when the agent is busy
   */
  sendOrQueue: (message: UserMessageContent) => Promise<boolean>
  /** Stop the current session. */
  stop: () => void
  /** Message queue handle for queue UI display. */
  messageQueue: UseMessageQueueReturn
  /** Clean up the session (stop + delete). Call on unmount. */
  cleanup: () => Promise<void>
}

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_MAX_CONTINUATIONS = 1
const DEFAULT_CONTINUATION_DELAY_MS = 300

// ═══════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════

export function useCreatorSession<TParsed>(
  config: CreatorSessionConfig<TParsed>
): CreatorSessionHandle<TParsed> {
  const { i18n } = useTranslation()
  const stopSession = useCommandStore((s) => s.stopSession)

  // ── Ephemeral session ID (not persisted in global store) ────────

  const [sessionId, setSessionId] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  // Keep ref in sync for cleanup (ref survives unmount)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  const clearSessionId = useCallback(() => setSessionId(null), [])

  const base = useSessionBase({
    sessionId,
    onSessionIdClear: clearSessionId
  })

  // ── Output extraction ──────────────────────────────────────────
  // Use ref for extract function to avoid re-parsing when config
  // object is recreated (extract is a stable module-level function).

  const extractRef = useRef(config.output.extract)
  extractRef.current = config.output.extract

  // Read messages from decoupled sessionMessages store for streaming performance.
  const messages = useCommandStore((s) => selectSessionMessages(s, base.session?.id ?? null))
  const parsedOutput: TParsed | null = useMemo(
    () => (messages.length > 0 ? extractRef.current(messages) : null),
    [messages]
  )

  // ── Auto-continuation for incomplete output ────────────────────
  //
  // When configured and the session goes idle with an incomplete output,
  // automatically send a recovery prompt to complete the generation.

  const autoContinuationCount = useRef(0)
  const continuation = config.autoContinuation

  useEffect(() => {
    if (
      continuation &&
      base.isPaused &&
      parsedOutput != null &&
      continuation.shouldContinue(parsedOutput) &&
      autoContinuationCount.current < (continuation.maxAttempts ?? DEFAULT_MAX_CONTINUATIONS)
    ) {
      autoContinuationCount.current++
      const prompt = continuation.buildRecoveryPrompt(parsedOutput)
      const delay = continuation.delayMs ?? DEFAULT_CONTINUATION_DELAY_MS

      const timer = setTimeout(() => {
        base.sendOrQueueExisting(prompt).catch(() => {
          // Swallow — session may have been cleaned up
        })
      }, delay)
      return () => clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.isPaused, parsedOutput, continuation])

  // ── Start new session ──────────────────────────────────────────

  const handleStartChat = useCallback(
    async (message: UserMessageContent): Promise<boolean> => {
      if (base.isStarting) return false
      base.setIsStarting(true)
      // Reset auto-continuation counter for new conversations
      autoContinuationCount.current = 0
      try {
        const systemPrompt = config.prompt.build(i18n.language)
        const id = await base.startSession({
          prompt: message,
          projectPath: base.projectPath,
          projectId: config.project?.id ?? base.selectedProjectId ?? undefined,
          origin: config.identity.origin,
          systemPrompt
        })
        if (id) {
          setSessionId(id)
          return true
        }
        return false
      } catch {
        return false
      } finally {
        base.setIsStarting(false)
      }
    },
    [base, config.identity.origin, config.prompt, config.project?.id, i18n.language]
  )

  // ── Unified send/queue (with auto-start) ───────────────────────

  const sendOrQueue = useCallback(
    async (message: UserMessageContent): Promise<boolean> => {
      if (!base.session && !base.isStarting) {
        return handleStartChat(message)
      }
      // User-initiated message — reset auto-continuation counter
      autoContinuationCount.current = 0
      return base.sendOrQueueExisting(message)
    },
    [base, handleStartChat]
  )

  // ── Cleanup ────────────────────────────────────────────────────

  const cleanup = useCallback(async () => {
    const id = sessionIdRef.current
    if (!id) return
    try {
      await stopSession(id)
    } catch {
      // Session may already be stopped
    }
    try {
      await deleteSession(id)
    } catch {
      // Session may already be deleted
    }
    setSessionId(null)
  }, [stopSession])

  // ── Return ─────────────────────────────────────────────────────

  return {
    session: base.session,
    isStarting: base.isStarting,
    isProcessing: base.isProcessing,
    isPaused: base.isPaused,
    state: base.state,
    parsedOutput,
    sendOrQueue,
    stop: base.handleStop,
    messageQueue: base.messageQueue,
    cleanup
  }
}
