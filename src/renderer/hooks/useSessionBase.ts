// SPDX-License-Identifier: Apache-2.0

/**
 * useSessionBase — Shared foundation for session-based hooks.
 *
 * Extracts the common patterns shared by `useAgentSession` and
 * `useCapabilityCreatorSession`:
 *   - Session lookup from managedSessions
 *   - Project resolution
 *   - State derivation (isProcessing, isPaused)
 *   - Stale reference auto-cleanup
 *   - Send / resume / stop wiring
 *   - Message queue integration
 *   - Unified sendOrQueue dispatch
 *
 * Each consumer provides its own session ID management and start logic,
 * then composes on top of the base return value.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useCommandStore } from '@/stores/commandStore'
import { startSession as startSessionAction } from '@/actions/commandActions'
import { useMessageQueue, type UseMessageQueueReturn } from '@/hooks/useMessageQueue'
import type {
  SessionSnapshot,
  ManagedSessionState,
  StartSessionInput,
  UserMessageContent
} from '@shared/types'

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface UseSessionBaseOptions {
  /**
   * Current session ID — can come from global store (useAgentSession)
   * or local state (useCapabilityCreatorSession).
   */
  sessionId: string | null
  /**
   * Callback invoked when the session ID should be cleared
   * (e.g. when a stale reference is detected).
   */
  onSessionIdClear: () => void
}

export interface SessionBaseHandle {
  /** Current managed session (null if not found). */
  session: SessionSnapshot | null
  /** Current session state shortcut. */
  state: ManagedSessionState | null
  /** Whether the agent is actively processing (creating or streaming). */
  isProcessing: boolean
  /** Whether the session is paused (idle / stopped / error). */
  isPaused: boolean
  /** Selected project path. */
  projectPath: string | undefined
  /** Selected project name. */
  projectName: string | null
  /** Selected project ID. */
  selectedProjectId: string | null

  /** Send a message to the active session. */
  handleSend: (message: UserMessageContent) => Promise<boolean>
  /** Resume a paused session with a message. */
  handleResume: (message: UserMessageContent) => Promise<boolean>
  /** Stop the current session. */
  handleStop: () => void
  /** Message queue handle. */
  messageQueue: UseMessageQueueReturn

  /**
   * Unified send/queue — handles streaming, paused, and default states.
   * Does NOT handle starting new sessions (that's the consumer's job).
   */
  sendOrQueueExisting: (message: UserMessageContent) => Promise<boolean>

  /** Whether a new session is being created (managed locally). */
  isStarting: boolean
  /** Set the isStarting flag. */
  setIsStarting: (v: boolean) => void

  /** Start a new session (delegated to appStore). */
  startSession: (input: StartSessionInput) => Promise<string>
}

// ═══════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════

export function useSessionBase(options: UseSessionBaseOptions): SessionBaseHandle {
  const { sessionId, onSessionIdClear } = options

  const selectedProjectId = useAppStore(selectProjectId)
  const projects = useAppStore((s) => s.projects)
  // Narrow subscription: subscribe to THIS session only, not the entire
  // sessionById map.  Previously `useCommandStore((s) => s.sessionById)`
  // would trigger re-renders on ANY session metadata update — now only
  // the specific session's changes trigger a re-render.
  // `shallow` equality prevents re-renders when the snapshot reference
  // changes but all top-level fields are identical (common during metadata
  // re-emission).
  const session: SessionSnapshot | null = useStoreWithEqualityFn(
    useCommandStore,
    (s) => (sessionId ? (s.sessionById[sessionId] ?? null) : null),
    shallow,
  )
  const sendMessage = useCommandStore((s) => s.sendMessage)
  const resumeSession = useCommandStore((s) => s.resumeSession)
  const stopSession = useCommandStore((s) => s.stopSession)

  const [isStarting, setIsStarting] = useState(false)

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  )

  const projectPath = selectedProject?.path
  const projectName = selectedProject?.name ?? null

  const state = session?.state ?? null
  const isProcessing = state === 'creating' || state === 'streaming'
  const isPaused = state === 'idle' || state === 'stopped' || state === 'error'

  // Auto-clear sessionId if session is removed from managedSessions
  useEffect(() => {
    if (sessionId && !session) {
      onSessionIdClear()
    }
  }, [sessionId, session, onSessionIdClear])

  // ── Core actions ─────────────────────────────────────────────

  const handleSend = useCallback(
    async (message: UserMessageContent): Promise<boolean> => {
      if (!sessionId) return false
      return sendMessage(sessionId, message)
    },
    [sessionId, sendMessage]
  )

  const handleResume = useCallback(
    async (message: UserMessageContent): Promise<boolean> => {
      if (!sessionId) return false
      return resumeSession(sessionId, message)
    },
    [sessionId, resumeSession]
  )

  const handleStop = useCallback(() => {
    if (sessionId) stopSession(sessionId)
  }, [sessionId, stopSession])

  // ── Message Queue ──────────────────────────────────────────────

  const messageQueue = useMessageQueue({
    sessionId: sessionId ?? '',
  })

  // ── Unified send/queue (without start) ─────────────────────────

  const sendOrQueueExisting = useCallback(
    async (message: UserMessageContent): Promise<boolean> => {
      if (state === 'streaming' || state === 'creating') {
        messageQueue.enqueue(message)
        return true
      }
      if (isPaused) {
        return handleResume(message)
      }
      return handleSend(message)
    },
    [state, isPaused, handleSend, handleResume, messageQueue]
  )

  return {
    session,
    state,
    isProcessing,
    isPaused,
    projectPath,
    projectName,
    selectedProjectId,
    handleSend,
    handleResume,
    handleStop,
    messageQueue,
    sendOrQueueExisting,
    isStarting,
    setIsStarting,
    startSession: startSessionAction
  }
}
