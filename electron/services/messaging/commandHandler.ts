// SPDX-License-Identifier: Apache-2.0

/**
 * CommandHandler — shared command execution layer for all IM platforms.
 *
 * Implements the Execution Layer of the three-layer command architecture:
 *   1. Parsing Layer   — `CommandRouter.parse()` (text → action + args)
 *   2. Execution Layer  — `executeCommand()` (action → semantic result)  ← THIS FILE
 *   3. Presentation Layer — platform adapters (semantic result → platform UX)
 *
 * Design principles:
 *   - `CommandResult` is **purely semantic** — zero user-facing strings.
 *     Platform adapters are responsible for translating results into
 *     localised, platform-appropriate UX (text, cards, embeds, etc.).
 *   - `chat` action is NOT handled here — it uses `routeIMMessage()` in
 *     the platform adapter's message handler, which already implements the
 *     full session-routing decision tree (find → busy/send/resume/new).
 *   - All orchestrator calls are wrapped in try-catch — errors surface as
 *     `{ type: 'error' }` results, never as thrown exceptions.
 *
 * Used by: TelegramBotService, FeishuBotService, DiscordBotService
 */

import type {
  IMOrchestratorDeps,
  IMPlatformType,
  SessionWorkspaceInput,
} from '../../../src/shared/types'
import { findActiveIMSession } from './sessionRouter'
import { getIMConnectionId } from './types'
import { createLogger } from '../../platform/logger'

const log = createLogger('CommandHandler')

// ─── Session Summary ────────────────────────────────────────────────────────

/** Minimal session info returned in list results. */
export interface SessionSummary {
  readonly id: string
  readonly state: string
  readonly activity: string | null
}

// ─── Command Result (purely semantic) ────────────────────────────────────────

export type CommandResult =
  /** Command executed, no reply needed (streaming response is the feedback). */
  | { type: 'noop' }

  /** /new without prompt — platform should ask user for input. */
  | { type: 'prompt_required'; command: 'new' }

  /** Required argument missing (e.g. /reply without message). */
  | { type: 'missing_argument'; command: string; argument: string }

  /** /clear succeeded — current session terminated, next message starts fresh. */
  | { type: 'session_cleared'; sessionId: string }

  /** /stop succeeded — specified session stopped. */
  | { type: 'session_stopped'; sessionId: string }

  /** /reply succeeded — message sent to session. */
  | { type: 'reply_sent'; sessionId: string }

  /** /reply failed — session could not accept the message. */
  | { type: 'reply_failed'; sessionId: string }

  /** Target session (by ID/prefix) not found. */
  | { type: 'session_not_found'; query: string }

  /** No active session in the current chat. */
  | { type: 'no_active_session' }

  /** Session is busy (streaming/creating). */
  | { type: 'session_busy'; sessionId: string }

  /** /stop failed — orchestrator returned false. */
  | { type: 'stop_failed'; sessionId: string }

  /** /status or /sessions — list of sessions for this context. */
  | { type: 'session_list'; sessions: SessionSummary[] }

  /** /help */
  | { type: 'help' }

  /** /menu */
  | { type: 'menu' }

  /** /issues */
  | { type: 'issues' }

  /** /inbox */
  | { type: 'inbox' }

  /** Internal error during command execution. */
  | { type: 'error'; cause: unknown }

// ─── Command Context ─────────────────────────────────────────────────────────

/**
 * Everything a command needs to execute — injected by the platform adapter.
 *
 * This interface decouples command execution from platform-specific details.
 * The adapter constructs the context once per incoming message and passes it
 * to `executeCommand()`.
 */
export interface CommandContext {
  /** Orchestrator interface for session lifecycle operations. */
  readonly orchestrator: IMOrchestratorDeps
  /** IM platform identifier (e.g. 'telegram', 'discord'). */
  readonly platform: IMPlatformType
  /** Bot/app connection ID (config.id). */
  readonly connectionId: string
  /** Chat/channel identifier for session scoping. */
  readonly chatId: string
  /** Defaults for new session creation. */
  readonly newSessionDefaults?: {
    readonly workspace?: SessionWorkspaceInput
  }
  /** Session origin for new session creation. */
  readonly origin: import('../../../src/shared/types').SessionOrigin
  /**
   * Called when a session ends (cleared or stopped) — platform injects cleanup logic.
   *
   * This keeps session-lifecycle side effects (streaming state cleanup, placeholder
   * removal, etc.) in the Execution Layer rather than leaking into the Presentation
   * Layer (`renderCommandResult`).
   */
  readonly onSessionEnd?: (sessionId: string) => void
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Execute a parsed command and return a purely semantic result.
 *
 * The caller (platform adapter) is responsible for:
 *   1. Parsing raw text via `CommandRouter.parse()`
 *   2. Routing `chat` action to `routeIMMessage()` (NOT here)
 *   3. Calling `executeCommand()` for all other actions
 *   4. Translating the `CommandResult` into platform-specific UX
 *
 * @param action - The parsed command action (from CommandRouter)
 * @param args   - The parsed command arguments (from CommandRouter)
 * @param ctx    - Execution context injected by the platform adapter
 */
export async function executeCommand(
  action: string,
  args: Record<string, string>,
  ctx: CommandContext,
): Promise<CommandResult> {
  try {
    switch (action) {
      case 'new':
      case 'ask':
        return await executeNew(args, ctx)

      case 'clear':
        return await executeClear(ctx)

      case 'stop':
        return await executeStop(args, ctx)

      case 'reply':
        return await executeReply(args, ctx)

      case 'status':
      case 'sessions':
        return await executeStatus(ctx)

      case 'issues':
        return { type: 'issues' }

      case 'inbox':
        return { type: 'inbox' }

      case 'menu':
        return { type: 'menu' }

      case 'help':
      default:
        return { type: 'help' }
    }
  } catch (err) {
    log.error(`Error executing command "${action}"`, err instanceof Error ? err.message : String(err))
    return { type: 'error', cause: err }
  }
}

// ─── Shared Utilities ────────────────────────────────────────────────────────

/**
 * Resolve a session ID prefix to a full session ID.
 *
 * Users can type a short prefix (e.g. "ccb-a7") and it will match the full
 * session ID (e.g. "ccb-a7981ec3b4f2"). Exact match takes priority over
 * prefix match.
 *
 * **Intentionally global (not scoped to platform/connection):**
 * `/stop <id>` and `/reply <id>` should work across all sessions regardless
 * of origin, as a power-user feature. Scoped listing uses
 * `listSessionsForContext()` instead.
 */
export async function resolveSessionId(
  prefix: string,
  orchestrator: IMOrchestratorDeps,
): Promise<string | null> {
  const sessions = await orchestrator.listSessions()
  const match = sessions.find((s) => s.id === prefix || s.id.startsWith(prefix))
  return match?.id ?? null
}

/**
 * List sessions scoped to a specific IM context (platform + connection).
 *
 * Filters out terminal states (stopped, error, stopping) and scopes to
 * the given platform and connection ID. This is the canonical session list
 * for IM `/status` commands — all platforms use the same filtering logic.
 */
export async function listSessionsForContext(params: {
  orchestrator: IMOrchestratorDeps
  platform: IMPlatformType
  connectionId: string
}): Promise<SessionSummary[]> {
  const { orchestrator, platform, connectionId } = params
  const sessions = await orchestrator.listSessions()

  return sessions
    .filter(
      (s) =>
        s.origin?.source === platform &&
        getIMConnectionId(s.origin) === connectionId &&
        s.state !== 'stopped' &&
        s.state !== 'error' &&
        s.state !== 'stopping',
    )
    .map((s) => ({
      id: s.id,
      state: s.state,
      activity: s.activity,
    }))
}

// ─── Action Handlers ─────────────────────────────────────────────────────────

async function executeNew(
  args: Record<string, string>,
  ctx: CommandContext,
): Promise<CommandResult> {
  const prompt = args.prompt?.trim()

  if (!prompt) {
    return { type: 'prompt_required', command: 'new' }
  }

  // Start a new session — streaming response is the feedback
  await ctx.orchestrator.startSession({
    prompt: [{ type: 'text', text: prompt }],
    origin: ctx.origin,
    ...ctx.newSessionDefaults,
  })
  return { type: 'noop' }
}

async function executeClear(ctx: CommandContext): Promise<CommandResult> {
  const session = await findActiveIMSession({
    orchestrator: ctx.orchestrator,
    platform: ctx.platform,
    connectionId: ctx.connectionId,
    chatId: ctx.chatId,
  })

  if (!session) {
    return { type: 'no_active_session' }
  }

  const ok = await ctx.orchestrator.stopSession(session.id)
  if (ok) {
    ctx.onSessionEnd?.(session.id)
    return { type: 'session_cleared', sessionId: session.id }
  }
  return { type: 'stop_failed', sessionId: session.id }
}

async function executeStop(
  args: Record<string, string>,
  ctx: CommandContext,
): Promise<CommandResult> {
  const targetPrefix = args.sessionId?.trim()

  // No ID → stop current chat's active session
  if (!targetPrefix) {
    const session = await findActiveIMSession({
      orchestrator: ctx.orchestrator,
      platform: ctx.platform,
      connectionId: ctx.connectionId,
      chatId: ctx.chatId,
    })

    if (!session) {
      return { type: 'no_active_session' }
    }

    const ok = await ctx.orchestrator.stopSession(session.id)
    if (ok) {
      ctx.onSessionEnd?.(session.id)
      return { type: 'session_stopped', sessionId: session.id }
    }
    return { type: 'stop_failed', sessionId: session.id }
  }

  // Resolve prefix → full ID
  const fullId = await resolveSessionId(targetPrefix, ctx.orchestrator)
  if (!fullId) {
    return { type: 'session_not_found', query: targetPrefix }
  }

  const ok = await ctx.orchestrator.stopSession(fullId)
  if (ok) {
    ctx.onSessionEnd?.(fullId)
    return { type: 'session_stopped', sessionId: fullId }
  }
  return { type: 'stop_failed', sessionId: fullId }
}

async function executeReply(
  args: Record<string, string>,
  ctx: CommandContext,
): Promise<CommandResult> {
  const { sessionId: rawId, message } = args

  if (!rawId) {
    return { type: 'missing_argument', command: 'reply', argument: 'sessionId' }
  }

  const fullId = await resolveSessionId(rawId, ctx.orchestrator)
  if (!fullId) {
    return { type: 'session_not_found', query: rawId }
  }

  if (!message) {
    return { type: 'missing_argument', command: 'reply', argument: 'message' }
  }

  // Check if target session is busy before attempting send
  const sessions = await ctx.orchestrator.listSessions()
  const target = sessions.find((s) => s.id === fullId)
  if (target && (target.state === 'streaming' || target.state === 'creating')) {
    return { type: 'session_busy', sessionId: fullId }
  }

  const content = [{ type: 'text' as const, text: message }]
  const ok =
    (await ctx.orchestrator.sendMessage(fullId, content)) ||
    (await ctx.orchestrator.resumeSession(fullId, content))

  return ok
    ? { type: 'reply_sent', sessionId: fullId }
    : { type: 'reply_failed', sessionId: fullId }
}

async function executeStatus(ctx: CommandContext): Promise<CommandResult> {
  const sessions = await listSessionsForContext({
    orchestrator: ctx.orchestrator,
    platform: ctx.platform,
    connectionId: ctx.connectionId,
  })

  return { type: 'session_list', sessions }
}
