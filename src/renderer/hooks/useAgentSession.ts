// SPDX-License-Identifier: Apache-2.0

import { useCallback } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useAppStore } from '@/stores/appStore'
import { useCommandStore } from '@/stores/commandStore'
import { useSessionBase } from '@/hooks/useSessionBase'
import type { UseMessageQueueReturn } from '@/hooks/useMessageQueue'
import type {
  SessionSnapshot,
  ManagedSessionState,
  SessionWorkspaceInput,
  UserMessageContent,
} from '@shared/types'

/**
 * Session origin sources eligible for the [Chat] tab.
 * Includes the UI agent + all IM bots (Telegram, Feishu, Discord, WeChat).
 */
const CHAT_ELIGIBLE_SOURCES: ReadonlySet<string> = new Set([
  'agent',
  'telegram',
  'feishu',
  'discord',
  'weixin',
])

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface AgentSessionHandle {
  /** Current managed session (null if no session selected or session removed). */
  session: SessionSnapshot | null
  /** Whether a new session is being created. */
  isStarting: boolean
  /** Whether the agent is actively processing (creating or streaming). */
  isProcessing: boolean
  /** Whether the session is paused (idle / stopped / error). */
  isPaused: boolean
  /** Current session state shortcut. */
  state: ManagedSessionState | null
  /** Selected project path (for scoped operations). */
  projectPath: string | undefined
  /** Selected project ID (for Capability Center resolution). */
  projectId: string | null
  /** Selected project name (for display). */
  projectName: string | null

  /**
   * Send or queue a message. Handles:
   * - Starting a new session (if no active session)
   * - Sending to an active session
   * - Resuming a paused session
   * - Queuing when the agent is busy (streaming/creating)
   */
  sendOrQueue: (message: UserMessageContent) => Promise<boolean>
  /** Stop the current session. */
  stop: () => void
  /** Message queue handle for queue UI display. */
  messageQueue: UseMessageQueueReturn

  // ── Session navigation ────────────────────────────────────────

  /** Chat-eligible sessions (agent + IM bots) sorted by most recent. */
  sessions: SessionSnapshot[]
  /** Switch to a different session (or null to clear → shows empty chat). */
  selectSession: (sessionId: string | null) => void
}

// ═══════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════

/**
 * Structural equality for session lists — re-renders only when the list
 * membership (IDs) or display-relevant fields (state) change.
 *
 * During streaming, session.state stays 'streaming' and the set of
 * chat-eligible sessions is stable, so this returns `true` and the
 * component skips re-render.  Token/cost metadata changes (the
 * majority of streaming updates) are invisible to this comparator.
 *
 * Note: `lastActivity` is intentionally excluded. It changes on every
 * metadata flush, which would defeat the optimization. The downstream
 * `SidebarSessionItem` shows `formatRelativeTime(session.lastActivity)`
 * which displays "just now" during streaming (correct) and updates when
 * the session state transitions (state change triggers comparator failure).
 */
function sessionListEqual(a: SessionSnapshot[], b: SessionSnapshot[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].state !== b[i].state) return false
  }
  return true
}

export interface UseAgentSessionOptions {
  /**
   * Override the session workspace used when starting a NEW chat.  When
   * provided, takes precedence over the project-derived default from
   * `useSessionBase` (which binds to `selectedProjectId`).  Used by the
   * sidebar Chat panel's folder picker to scope new sessions to an
   * arbitrary directory without mutating project navigation state.
   *
   * Has no effect on existing sessions — a started session is bound to
   * its workspace at creation time.
   */
  workspaceOverride?: SessionWorkspaceInput
}

/**
 * useAgentSession — Encapsulates agent chat session lifecycle.
 *
 * Built on top of `useSessionBase` for shared session operations,
 * adding agent-specific concerns:
 *   - Session list filtering (agent + IM bot origins)
 *   - Global session ID persistence (via appStore)
 *   - Session selection / navigation
 */
export function useAgentSession(options?: UseAgentSessionOptions): AgentSessionHandle {
  const workspaceOverride = options?.workspaceOverride
  const chatSessionId = useAppStore((s) => s.agentChatSessionId)
  const setChatSessionId = useAppStore((s) => s.setAgentChatSessionId)

  const clearSessionId = useCallback(() => setChatSessionId(null), [setChatSessionId])

  const base = useSessionBase({
    sessionId: chatSessionId,
    onSessionIdClear: clearSessionId
  })

  // Chat-eligible sessions: agent (UI) + all IM bots, scoped per view.
  //
  // Three scoping modes:
  //   1. Chat home (current project's path === `$HOME`)  →  only
  //      orphan sessions (`!projectId`). These are claude runs that
  //      happened in `$HOME` outside OpenCow's project model, and the
  //      Chat home tab is their dedicated landing place.
  //   2. Specific project selected  →  sessions belonging to that
  //      project (`ms.projectId === selectedProjectId`).
  //   3. No project selected (project list view)  →  all chat-eligible.
  //
  // Uses a structural equality comparator (id + state) so the component
  // only re-renders when sessions are added/removed or their state
  // transitions — NOT on every metadata flush (cost, tokens, context)
  // during streaming.
  const selectedProjectId = base.selectedProjectId
  const isChatHome = useAppStore((s) => {
    if (!selectedProjectId || !s.homeDir) return false
    const proj = s.projects.find((p) => p.id === selectedProjectId)
    return proj?.path === s.homeDir
  })
  const sessions: SessionSnapshot[] = useStoreWithEqualityFn(
    useCommandStore,
    (s) =>
      s.managedSessions
        .filter((ms) => {
          if (!CHAT_ELIGIBLE_SOURCES.has(ms.origin.source)) return false
          if (isChatHome) return !ms.projectId
          if (selectedProjectId) return ms.projectId === selectedProjectId
          return true
        })
        .sort((a, b) => b.createdAt - a.createdAt),
    sessionListEqual,
  )

  const selectSession = useCallback(
    (sessionId: string | null) => setChatSessionId(sessionId),
    [setChatSessionId]
  )

  // ── Start new session ─────────────────────────────────────────

  const handleStartChat = useCallback(
    async (message: UserMessageContent): Promise<boolean> => {
      if (base.isStarting) return false
      base.setIsStarting(true)
      try {
        const sessionId = await base.startSession({
          prompt: message,
          workspace: workspaceOverride ?? base.startWorkspace,
        })
        if (sessionId) {
          setChatSessionId(sessionId)
          return true
        }
        return false
      } catch {
        return false
      } finally {
        base.setIsStarting(false)
      }
    },
    [base, setChatSessionId, workspaceOverride]
  )

  // ── Unified send/queue (with start) ───────────────────────────

  const sendOrQueue = useCallback(
    async (message: UserMessageContent): Promise<boolean> => {
      if (!base.session && !base.isStarting) {
        return handleStartChat(message)
      }
      return base.sendOrQueueExisting(message)
    },
    [base, handleStartChat]
  )

  return {
    session: base.session,
    isStarting: base.isStarting,
    isProcessing: base.isProcessing,
    isPaused: base.isPaused,
    state: base.state,
    projectPath: base.projectPath,
    projectId: base.selectedProjectId,
    projectName: base.projectName,
    sendOrQueue,
    stop: base.handleStop,
    messageQueue: base.messageQueue,
    sessions,
    selectSession
  }
}
