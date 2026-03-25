// SPDX-License-Identifier: Apache-2.0

/**
 * IMSessionRouter — shared session-finding and message-routing logic for all IM platforms.
 *
 * Every IM bot needs the same core flow:
 *   1. Find the most relevant session for a chat (excluding terminal states, including idle)
 *   2. Route an incoming message: busy → hint, active/idle → send/resume, none → new session
 *
 * This logic is 100% platform-agnostic — it depends only on:
 *   - `IMOrchestratorDeps` (startSession, sendMessage, resumeSession, listSessions)
 *   - `getIMConnectionId()` / `getIMChatId()` helpers (already unified)
 *
 * Platform adapters provide only the platform-specific pieces:
 *   - How to construct the `SessionOrigin`
 *   - How to send text to the chat (for "busy" hints and error messages)
 *   - Workspace/project defaults from bot configuration
 *
 * ## Why this exists
 *
 * Previously each platform (Telegram, Discord, Feishu, WeChat) independently implemented
 * `findActiveSession()` and `handleChat()`. This led to subtle behavioral divergence:
 * Discord and WeChat both filtered out `idle` sessions (losing multi-turn context),
 * while Telegram and Feishu correctly preserved them. Centralizing the logic here
 * makes it impossible for such drift to reoccur.
 */

import type {
  SessionSnapshot,
  SessionOrigin,
  UserMessageContent,
  IMOrchestratorDeps,
  IMPlatformType,
  StartSessionInput,
} from '../../../src/shared/types'
import { getIMConnectionId, getIMChatId } from './types'
import { createLogger } from '../../platform/logger'

const log = createLogger('IMSessionRouter')

// ─── Route result ─────────────────────────────────────────────────────────────

export type RouteMessageResult =
  | { outcome: 'sent' }
  | { outcome: 'new_session' }
  | { outcome: 'busy' }
  | { outcome: 'error'; error: unknown }

// ─── Session finder ───────────────────────────────────────────────────────────

/**
 * Find the most relevant active session for a given IM chat.
 *
 * - Excludes terminal states (`stopped`, `error`, `stopping`) — these sessions should not be reused.
 * - Keeps `idle` sessions so the user can resume multi-turn conversations.
 * - Sorts by interactive priority first, then by recency (most recent first).
 */
export async function findActiveIMSession(params: {
  orchestrator: IMOrchestratorDeps
  platform: IMPlatformType
  connectionId: string
  chatId: string
}): Promise<SessionSnapshot | null> {
  const { orchestrator, platform, connectionId, chatId } = params
  const sessions = await orchestrator.listSessions()

  const candidates = sessions.filter(
    (s) =>
      s.origin?.source === platform &&
      getIMConnectionId(s.origin) === connectionId &&
      getIMChatId(s.origin) === chatId &&
      s.state !== 'stopped' &&
      s.state !== 'error' &&
      s.state !== 'stopping',
  )

  if (candidates.length === 0) return null

  const priority = (state: string): number => {
    switch (state) {
      case 'awaiting_input':
      case 'awaiting_question': return 0
      case 'streaming':
      case 'creating':          return 1
      case 'idle':              return 2
      default:                  return 3
    }
  }

  candidates.sort((a, b) => {
    const p = priority(a.state) - priority(b.state)
    return p !== 0 ? p : b.lastActivity - a.lastActivity
  })

  return candidates[0]
}

// ─── Message router ───────────────────────────────────────────────────────────

/**
 * Route an incoming IM message to the correct session, creating a new one if needed.
 *
 * Decision tree:
 *   1. No active session → start a new session
 *   2. Session busy (streaming/creating) → return 'busy' (caller sends platform-specific hint)
 *   3. Session available → try sendMessage, then resumeSession, then fallback to new session
 *
 * On `startSession` failure, returns `{ outcome: 'error' }` so the caller can show
 * a platform-specific error message. This replaces the per-platform try-catch that
 * previously existed in each bot's `startNewSession()` method.
 */
export async function routeIMMessage(params: {
  orchestrator: IMOrchestratorDeps
  content: UserMessageContent
  origin: SessionOrigin
  connectionId: string
  chatId: string
  /** Defaults for new session creation (workspace path, project ID, etc.) */
  newSessionDefaults?: Omit<StartSessionInput, 'prompt' | 'origin'>
}): Promise<RouteMessageResult> {
  const { orchestrator, content, origin, connectionId, chatId, newSessionDefaults } = params

  const session = await findActiveIMSession({
    orchestrator,
    platform: origin.source as IMPlatformType,
    connectionId,
    chatId,
  })

  // No active session → start new
  if (!session) {
    return startNewSession(orchestrator, content, origin, newSessionDefaults)
  }

  // Session is busy → caller should show a platform-specific hint
  if (session.state === 'streaming' || session.state === 'creating') {
    return { outcome: 'busy' }
  }

  // Try send → try resume → fallback to new session
  const ok =
    await orchestrator.sendMessage(session.id, content) ||
    await orchestrator.resumeSession(session.id, content)

  if (ok) {
    return { outcome: 'sent' }
  }

  // Both failed (session terminated, engineSessionRef missing, etc.) → start new
  return startNewSession(orchestrator, content, origin, newSessionDefaults)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function startNewSession(
  orchestrator: IMOrchestratorDeps,
  content: UserMessageContent,
  origin: SessionOrigin,
  defaults?: Omit<StartSessionInput, 'prompt' | 'origin'>,
): Promise<RouteMessageResult> {
  try {
    await orchestrator.startSession({
      prompt: content,
      origin,
      ...defaults,
    })
    return { outcome: 'new_session' }
  } catch (err) {
    log.error('Failed to start new session', err instanceof Error ? err.message : String(err))
    return { outcome: 'error', error: err }
  }
}
