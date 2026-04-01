// SPDX-License-Identifier: Apache-2.0

import { createSessionLifecycle, type SessionLifecycle } from './sessionLifecycle'
import {
  isIMPlatformSource,
  type AIEngineKind,
  type ApiProvider,
  type CodexReasoningEffort,
  type CommandDefaults,
  type ContentBlock,
  type DataBusEvent,
  type DocumentMediaType,
  type ImageMediaType,
  type ManagedSessionInfo,
  type SessionOrigin,
  type SessionSnapshot,
  type StartSessionNativeToolAllowItem,
  type StartSessionPolicy,
  type SessionStopReason,
  type StartSessionInput,
  type UserMessageContent,
} from '../../src/shared/types'
import { getOriginIssueId } from '../../src/shared/types'
import { ManagedSession } from './managedSession'
import { ManagedSessionStore } from '../services/managedSessionStore'
import { buildSDKHooks } from '../hooks/buildSDKHooks'
import { resolveExecutionContext } from './resolveExecutionContext'
import type { GitCommandExecutor } from '../services/git/gitCommandExecutor'
import type { NativeCapabilityRegistry } from '../nativeCapabilities/registry'
import type { NativeCapabilityToolContext, NativeToolDescriptor } from '../nativeCapabilities/types'
import { toClaudeToolDefinitions } from '../nativeCapabilities/claudeToolAdapter'
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import type { BrowserService } from '../browser/browserService'
import type { PendingQuestionRegistry } from '../nativeCapabilities/interaction/pendingQuestionRegistry'
import type { CapabilityCenter } from '../services/capabilityCenter'
import { createLogger } from '../platform/logger'
import { getShellEnvironmentSafe } from '../platform/shellPath'
import { ToolProgressRelay } from '../utils/toolProgressRelay'
import { SessionTimerScope } from './sessionTimerScope'
import { StreamState } from './streamState'
import { SessionContext } from './sessionContext'
import { getBaseSystemPrompt } from './baseSystemPrompt'
import { getIdentityPrompt } from './identityPrompt'
import { composeSystemPrompt, type SystemPromptLayers } from './systemPromptComposer'
import { EngineCapabilityRuntime } from './engineCapabilityRuntime'
import type { CodexNativeBridgeManager } from './codexNativeBridgeManager'
import { mergeCodexMcpServers } from './codexMcpConfigBuilder'
import { ConversationEventPipeline } from '../conversation/pipeline'
import {
  EngineBootstrapRegistry,
  type CodexAuthConfig,
} from './engineBootstrapOptions'
import {
  applyClaudeSessionPolicy,
} from './enginePolicy'
import { type SessionLaunchOptions, toSdkOptions } from './sessionLaunchOptions'
import type { SessionRuntime, SessionCompletionCallback, SessionCompletionResult } from './sessionRuntime'
import { planSessionPolicy } from './policy/sessionPolicyPlanner'
import { decideSessionReconfiguration } from './policy/sessionReconfigurationCoordinator'
import { buildConversationSummary } from './conversationSummary'
import { dispatchSessionTerminal as dispatchSessionTerminalEvent } from './sessionTerminalDispatcher'

const log = createLogger('Orchestrator')

type Dispatch = (event: DataBusEvent) => void

export interface OrchestratorDeps {
  dispatch: Dispatch
  getProxyEnv: () => Record<string, string>
  getProviderEnv: (engineKind: AIEngineKind) => Promise<Record<string, string>>
  getCodexAuthConfig: (engineKind: AIEngineKind) => Promise<CodexAuthConfig | null>
  getProviderDefaultModel: (engineKind: AIEngineKind) => string | undefined
  getProviderDefaultReasoningEffort: (engineKind: AIEngineKind) => CodexReasoningEffort | undefined
  /** Returns the current active provider mode for the given engine (synchronous in-memory read). */
  getActiveProviderMode: (engineKind: AIEngineKind) => ApiProvider | null
  getCommandDefaults: () => CommandDefaults
  store: ManagedSessionStore
  /** Optional NativeCapabilityRegistry — injects OpenCow built-in native capability tools into sessions. */
  nativeCapabilityRegistry?: NativeCapabilityRegistry
  /**
   * Optional BrowserService reference — used to release per-session browser
   * views when a session finishes, freeing WebContentsView resources.
   */
  browserService?: BrowserService
  /**
   * Optional PendingQuestionRegistry — manages blocking Promises for the
   * MCP ask_user_question tool. When present, sendMessage() checks for
   * awaiting_question state and routes answers to resolve the blocked handler.
   */
  pendingQuestionRegistry?: PendingQuestionRegistry
  /**
   * Optional CapabilityCenter — injects managed capabilities (skills, rules, hooks,
   * MCP servers) into sessions via the 4-layer prompt system.
   * v3.1 #5: new dependency for Capability Center integration.
   */
  capabilityCenter?: CapabilityCenter
  /**
   * Optional GitCommandExecutor — stateless git CLI wrapper used to resolve
   * execution context (branch, detached state) for managed sessions.
   * When absent, execution context is created with gitBranch=null.
   */
  gitCommandExecutor?: GitCommandExecutor
  /**
   * Optional CodexNativeBridgeManager — bridges OpenCow native capabilities
   * into Codex via a stdio MCP command process.
   */
  codexNativeBridgeManager?: CodexNativeBridgeManager
  /** Optional EngineBootstrapRegistry — engine-specific lifecycle option policy. */
  engineBootstrapRegistry?: EngineBootstrapRegistry
  /** Optional memory context provider — injects persistent memories into system prompt. */
  getMemoryContext?: (projectId: string | null) => Promise<{ formatted: string; memories: Array<{ id: string }> } | null>
}

// Re-export for downstream consumers (e.g. marketplace service)
export type { SessionCompletionResult } from './sessionRuntime'

/** Convert UserMessageContent to internal ContentBlock[] for message storage. */
function userContentToBlocks(content: UserMessageContent): ContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  return content.map((block): ContentBlock => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text }
      case 'slash_command':
        return {
          type: 'slash_command',
          name: block.name,
          category: block.category,
          label: block.label,
          execution: block.execution,
          expandedText: block.expandedText,
        }
      case 'image':
        return {
          type: 'image',
          mediaType: block.mediaType as ImageMediaType,
          data: block.data,
          sizeBytes: block.sizeBytes,
        }
      case 'document':
        return {
          type: 'document',
          mediaType: block.mediaType as DocumentMediaType,
          data: block.data,
          sizeBytes: block.sizeBytes,
          title: block.title,
        }
      default: {
        const _exhaustive: never = block
        return _exhaustive
      }
    }
  })
}

/**
 * Classify spawn-related errors into categories for appropriate handling.
 *
 * - 'process_corrupted': EBADF — file descriptor leak in parent process.
 *   NOT retryable within the same Electron process. The only fix is app restart.
 *
 * - 'transient': EMFILE/ENFILE/EAGAIN — temporary OS resource pressure.
 *   May succeed on retry after a brief delay.
 *
 * - null: Not a spawn error — use default error handling.
 */
function classifySpawnError(err: unknown): 'process_corrupted' | 'transient' | null {
  if (!(err instanceof Error)) return null
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'EBADF') return 'process_corrupted'
  if (code === 'EMFILE' || code === 'ENFILE' || code === 'EAGAIN') return 'transient'
  return null
}

/** How often to run the session health audit (ms). */
const HEALTH_AUDIT_INTERVAL_MS = 15_000

/** Max consecutive transient spawn errors before escalating to permanent error. */
const MAX_TRANSIENT_RETRIES = 2

/**
 * Backend-only extension of StartSessionInput for internal callers.
 *
 * Adds fields that cannot cross IPC boundaries (function refs, MCP server
 * configs). External/IPC callers still pass `StartSessionInput` (which is
 * a valid subset of `SessionStartOptions`).
 */
export interface SessionStartOptions extends StartSessionInput {
  /** Per-session MCP server configs (e.g., marketplace analysis sandbox tools). */
  customMcpServers?: Record<string, Record<string, unknown>>
  /**
   * Per-session custom tool descriptors — engine-agnostic.
   *
   * Unlike `customMcpServers` (which requires engine-specific MCP server config),
   * this accepts raw NativeToolDescriptor[] and lets SessionOrchestrator handle
   * engine-appropriate injection:
   * - Claude: creates an in-process MCP server via createSdkMcpServer()
   * - Codex:  registers tools with CodexNativeBridgeManager's HTTP bridge
   *
   * Used by RepoAnalyzer for per-analysis sandboxed tools.
   */
  customTools?: { name: string; tools: NativeToolDescriptor[] }
  /** One-shot completion callback — registered via onSessionComplete() automatically. */
  onComplete?: SessionCompletionCallback
}

export class SessionOrchestrator {
  /** Single aggregate map for all per-session tracking state. */
  private runtimes = new Map<string, SessionRuntime>()
  private deps: OrchestratorDeps
  private store: ManagedSessionStore
  private readonly capabilityRuntime: EngineCapabilityRuntime
  private readonly engineBootstrapRegistry: EngineBootstrapRegistry
  private auditTimer: ReturnType<typeof setInterval> | null = null

  constructor(deps: OrchestratorDeps) {
    this.deps = deps
    this.store = deps.store
    this.capabilityRuntime = new EngineCapabilityRuntime({ capabilityCenter: deps.capabilityCenter })
    this.engineBootstrapRegistry = deps.engineBootstrapRegistry ?? new EngineBootstrapRegistry()
  }

  async start(): Promise<void> {
    const startedAt = Date.now()
    // Load persisted sessions from previous app runs
    await this.store.load()
    const persistedCount = (await this.store.list()).length

    // Start periodic health audit
    this.auditTimer = setInterval(() => this.auditSessions(), HEALTH_AUDIT_INTERVAL_MS)
    log.info('SessionOrchestrator started', {
      persistedSessions: persistedCount,
      durationMs: Date.now() - startedAt,
      healthAuditIntervalMs: HEALTH_AUDIT_INTERVAL_MS,
    })
  }

  /**
   * Register a one-time callback invoked when session `sessionId` lifecycle ends.
   *
   * The callback fires when the session's `lifecycleDone` promise resolves — this
   * covers ALL exit paths: normal completion, SDK errors, transient spawn errors,
   * and silent exits caught by `auditSessions`. It does NOT cover app restarts
   * (startup cleanup handles orphaned records instead).
   *
   * If the session already completed before this is called, the callback is
   * invoked asynchronously in the next microtask with the cached result.
   */
  onSessionComplete(sessionId: string, callback: SessionCompletionCallback): void {
    const rt = this.runtimes.get(sessionId)
    if (!rt) return
    if (rt.pendingCompletion !== undefined) {
      const pending = rt.pendingCompletion
      rt.pendingCompletion = undefined
      void Promise.resolve()
        .then(() => callback(pending))
        .catch((err) => log.error(`[Orchestrator] Completion callback failed for ${sessionId}`, err))
      return
    }
    rt.onComplete = callback
  }

  /**
   * Fire the registered completion callback for `sessionId`.
   * If no callback is registered yet, caches the result so `onSessionComplete`
   * can deliver it when the callback is eventually registered.
   *
   * Idempotent: subsequent calls for the same sessionId are silently ignored.
   * This is essential because both `onResultReceived` (immediate, fired by
   * handleResult inside the for-await loop) and `lifecycleDone.then()` (deferred,
   * fired when the SDK stream ends) trigger this method.
   */
  private fireCompletion(sessionId: string, result: SessionCompletionResult): void {
    const rt = this.runtimes.get(sessionId)
    if (!rt || rt.completionFired) return
    rt.completionFired = true

    if (rt.onComplete) {
      const callback = rt.onComplete
      rt.onComplete = undefined
      void Promise.resolve()
        .then(() => callback(result))
        .catch((err) => log.error(`[Orchestrator] Completion callback failed for ${sessionId}`, err))
      return
    }
    // No callback registered yet — store for when onSessionComplete is called
    rt.pendingCompletion = result
  }

  /**
   * Periodic health audit — catches the edge case where the SDK child process
   * exits silently (no result message, no error thrown) and the for-await loop
   * ends without going through handleSessionError. In this scenario the runtime
   * stays in the map with lifecycle.stopped === true but session still in an
   * active state. We recover to idle and persist so the session can be resumed.
   */
  private auditSessions(): void {
    const toDelete: string[] = []
    for (const [id, rt] of this.runtimes) {
      const state = rt.session.getState()
      const isActiveState = state === 'streaming' || state === 'awaiting_input' || state === 'awaiting_question' || state === 'creating'

      if (rt.lifecycle.stopped && isActiveState) {
        log.warn(`Health audit: session ${id} state=${state} but lifecycle stopped — recovering to idle`)
        rt.session.transition({ type: 'lifecycle_exited_silently' })
        this.dispatchFinalizedAssistantSnapshots(rt.session)
        toDelete.push(id)
        this.dispatchSessionTerminal({
          sessionId: id,
          session: rt.session,
          terminalEvent: 'idle',
          stopReason: 'completed',
        })
        // Persist so resumeSession can find this session from the store
        this.store.save(rt.session.toPersistenceRecord()).catch((err) => {
          log.error(`Health audit: failed to persist session ${id}`, err)
        })
      }
    }
    for (const id of toDelete) this.runtimes.delete(id)
  }

  async startSession(input: SessionStartOptions): Promise<string> {
    const origin: SessionOrigin = input.origin ?? { source: 'agent' }
    const defaultEngine = this.deps.getCommandDefaults().defaultEngine
    const engineKind: AIEngineKind = input.engineKind ?? defaultEngine
    log.info('startSession requested', {
      origin: origin.source,
      engineKind,
      projectId: input.projectId ?? null,
      hasCustomMcpServers: !!(input.customMcpServers && Object.keys(input.customMcpServers).length > 0),
    })

    // Idempotency: for issue and IM origins, prevent duplicate active sessions
    // for the same context (same issueId, or same chat pair for IM platforms).
    //
    // Note: idle sessions are NOT matched here — the caller (TelegramBotService.chat)
    // resumes idle sessions via sendMessage/resumeSession before falling back to startSession.
    if (origin.source === 'issue' || isIMPlatformSource(origin.source)) {
      for (const [id, rt] of this.runtimes) {
        const s = rt.session
        const st = s.getState()
        if (st === 'stopped' || st === 'idle' || st === 'error') continue

        const o = s.origin
        if (origin.source === 'issue' && o.source === 'issue' && o.issueId === origin.issueId) {
          log.info('startSession deduplicated to active issue session', {
            sessionId: id,
            issueId: origin.issueId,
          })
          return id
        }
        if (
          origin.source === 'telegram' &&
          o.source === 'telegram' &&
          o.botId === origin.botId &&
          o.chatId === origin.chatId
        ) {
          log.info('startSession deduplicated to active telegram session', {
            sessionId: id,
            chatId: origin.chatId,
          })
          return id
        }
        if (
          origin.source === 'feishu' &&
          o.source === 'feishu' &&
          o.appId === origin.appId &&
          o.chatId === origin.chatId
        ) {
          log.info('startSession deduplicated to active feishu session', {
            sessionId: id,
            chatId: origin.chatId,
          })
          return id
        }
        if (
          origin.source === 'discord' &&
          o.source === 'discord' &&
          o.botId === origin.botId &&
          o.channelId === origin.channelId
        ) {
          log.info('startSession deduplicated to active discord session', {
            sessionId: id,
            channelId: origin.channelId,
          })
          return id
        }
        if (
          origin.source === 'weixin' &&
          o.source === 'weixin' &&
          o.connectionId === origin.connectionId &&
          o.userId === origin.userId
        ) {
          log.info('startSession deduplicated to active weixin session', {
            sessionId: id,
            userId: origin.userId,
          })
          return id
        }
      }
    }

    const session = new ManagedSession({
      prompt: input.prompt,
      origin,
      engineKind,
      projectPath: input.projectPath,
      projectId: input.projectId,
      model: input.model,
      maxTurns: input.maxTurns,
      // Browser Agent extensions
      systemPrompt: input.systemPrompt,
      policy: input.policy,
      contextSystemPrompt: input.contextSystemPrompt,
      // Per-session custom MCP servers (marketplace analysis, etc.)
      customMcpServers: input.customMcpServers,
    })

    const lifecycle = createSessionLifecycle(engineKind)
    const tempId = session.id

    // Broadcast creation
    this.deps.dispatch({
      type: 'command:session:created',
      payload: session.snapshot()
    })

    // Register runtime BEFORE starting runSession to prevent race condition:
    // if runSession fails synchronously, the .catch → handleSessionError needs
    // to find the runtime in the map.
    const rt: SessionRuntime = {
      session,
      lifecycle,
      lifecycleDone: Promise.resolve(),
      pipeline: null,
      policy: null,
      providerMode: null,
      spawnErrorCount: 0,
      onComplete: input.onComplete,
      completionFired: false,
      customTools: input.customTools,
    }
    this.runtimes.set(tempId, rt)

    rt.lifecycleDone = this.runSession(session, lifecycle, input.prompt)
      .catch(async (err) => this.handleSessionError(tempId, err))

    // Safety-net: fire completion callbacks once the full lifecycle (including
    // error handling) has settled. In the normal case `onResultReceived` already
    // fired completion immediately — the idempotency guard in `fireCompletion`
    // ensures this second call is a no-op. This path is kept as a fallback for
    // silent exits, transient spawn errors, and audit-recovered sessions.
    void rt.lifecycleDone.then(() => {
      const snap = session.snapshot()
      this.fireCompletion(tempId, {
        stopReason: snap.stopReason,
        error: snap.error ?? undefined,
      })
      // Lifecycle fully settled — clean up idempotency guard
      const rtAfter = this.runtimes.get(tempId)
      if (rtAfter) rtAfter.completionFired = false
    })

    log.info('Session created and lifecycle started', {
      sessionId: tempId,
      origin: session.origin.source,
      engineKind,
    })
    return tempId
  }

  private async runSession(
    session: ManagedSession,
    lifecycle: SessionLifecycle,
    initialPrompt: UserMessageContent,
    extra?: { resume?: string; skipAddMessage?: boolean }
  ): Promise<void> {
    const sessionId = session.id

    // Only add user message if this is not coming from resumeSession
    // (resumeSession adds the user message before calling runSession).
    // skipAddMessage decouples "message already added" from "has resume ref"
    // — needed for engine switch where there's no resume ref but message
    // was already added by resumeSessionInternal.
    if (!extra?.resume && !extra?.skipAddMessage) {
      session.addMessage('user', userContentToBlocks(initialPrompt))
      const userMsg = session.getLastMessage()
      if (userMsg) {
        this.deps.dispatch({
          type: 'command:session:message',
          payload: { sessionId, origin: session.origin, message: userMsg }
        })
      }
    }

    const config = session.getConfig()
    const engineKind: AIEngineKind = config.engineKind ?? 'claude'
    const isClaudeEngine = engineKind === 'claude'
    const policyPlan = planSessionPolicy({
      engineKind,
      origin: config.origin,
      policy: config.policy,
      prompt: initialPrompt,
    })
    const sessionPolicy = policyPlan.effectivePolicy
    const rt = this.runtimes.get(sessionId)
    if (rt) rt.policy = sessionPolicy
    log.debug('Session lifecycle bootstrapping', {
      sessionId,
      engineKind,
      resume: !!extra?.resume,
      origin: session.origin.source,
    })

    // Build session env: frozen shell PATH (immune to process.env mutations) + provider + proxy.
    const shellEnv = getShellEnvironmentSafe()
    const sessionEnv: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) sessionEnv[k] = v
    }
    sessionEnv.PATH = shellEnv.path

    // ── Sanitize Electron-specific env vars ──
    // Electron injects runtime-internal env vars (ELECTRON_*, NODE_OPTIONS with
    // --require for asar support, NODE_PATH pointing to Electron modules, etc.)
    // that must NOT leak into child processes — they can cause native binaries
    // (Codex) and their Node.js subprocesses (MCP servers) to crash silently.
    const removedEnvKeys = sanitizeChildProcessEnv(sessionEnv)
    if (removedEnvKeys.length > 0) {
      log.info(`Sanitized ${removedEnvKeys.length} Electron-specific env vars from session env: ${removedEnvKeys.join(', ')}`)
    }

    if (!shellEnv.nodeBinDir) {
      log.warn('node binary was not found at startup — session will likely fail with ENOENT')
    }

    // Layer provider credentials (highest priority — overrides any system-level tokens)
    const providerEnv = await this.deps.getProviderEnv(engineKind)
    Object.assign(sessionEnv, providerEnv)

    // Record the provider mode active at lifecycle spawn time — used by
    // sendMessage() to detect mid-session provider switches.
    if (rt) rt.providerMode = this.deps.getActiveProviderMode(engineKind)

    // Layer proxy settings (settings > process.env, already in sessionEnv)
    const settingsProxy = this.deps.getProxyEnv()
    for (const key of ['https_proxy', 'http_proxy', 'all_proxy', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'no_proxy', 'NO_PROXY']) {
      const value = settingsProxy[key]
      if (value) sessionEnv[key] = value
    }

    const defaults = this.deps.getCommandDefaults()
    const options: SessionLaunchOptions = {
      maxTurns: config.maxTurns ?? defaults.maxTurns,
      includePartialMessages: true,
      permissionMode: config.permissionMode ?? defaults.permissionMode,
      allowDangerouslySkipPermissions: true,
      env: sessionEnv,
    }

    await this.engineBootstrapRegistry.apply({
      engineKind,
      config,
      resume: extra?.resume,
      sessionEnv,
      options,
      deps: {
        getProviderDefaultModel: this.deps.getProviderDefaultModel,
        getProviderDefaultReasoningEffort: this.deps.getProviderDefaultReasoningEffort,
        getCodexAuthConfig: this.deps.getCodexAuthConfig,
      },
      logger: log,
    })

    // ── System prompt layer stack ──
    // Build the layer object now; L3 (session) and L4 (capability) may be
    // adjusted later by the CapabilityCenter. The final string is composed
    // ONCE via composeSystemPrompt() after all adjustments are applied.
    // Resolve memory context (fire-and-forget on failure)
    let memoryPrompt: string | undefined
    if (this.deps.getMemoryContext) {
      try {
        const mc = await this.deps.getMemoryContext(config.projectId ?? null)
        if (mc?.formatted) memoryPrompt = mc.formatted
      } catch (err) {
        log.warn('Memory context injection failed (non-fatal)', err)
      }
    }

    let promptLayers: SystemPromptLayers = {
      identity: getIdentityPrompt(),
      context: config.contextSystemPrompt,
      memory: memoryPrompt,
      base: getBaseSystemPrompt(config.origin.source),
      session: config.systemPrompt,
    }

    if (isClaudeEngine) {
      // Claude-specific runtime policy lives in enginePolicy.ts.
      applyClaudeSessionPolicy({
        options,
        builtinToolsEnabled: sessionPolicy.tools.builtin.enabled,
        logger: log,
      })
    }

    // ── Per-session infrastructure (replaces closure variables) ──
    const timers = new SessionTimerScope()
    const streamState = new StreamState()
    const relay = new ToolProgressRelay()
    const ctx = new SessionContext({
      session,
      dispatch: this.deps.dispatch,
      timers,
      stream: streamState,
      relay,
      isSessionAlive: () => this.runtimes.has(session.id),
      persistSession: () => this.store.save(session.toPersistenceRecord()),
      onStreamStarted: () => {
        const rtInner = this.runtimes.get(session.id)
        if (rtInner) rtInner.spawnErrorCount = 0

        // Resolve initial execution context (branch, worktree) from the session's cwd.
        // Fire-and-forget — failure is non-fatal (executionContext stays null).
        const initialCwd = config.projectPath || process.cwd()
        resolveExecutionContext(initialCwd, config.projectPath ?? null, this.deps.gitCommandExecutor ?? null)
          .then((ctx) => {
            session.initExecutionContext(ctx)
            this.deps.dispatch({ type: 'command:session:updated', payload: session.snapshot() })
            this.store.save(session.toPersistenceRecord()).catch((err) =>
              log.error(`Failed to persist initial execution context for ${sessionId}`, err),
            )
          })
          .catch((err) => log.error(`Failed to resolve initial execution context for ${sessionId}`, err))
      },
      onResultReceived: () => {
        // ── Immediate completion notification ──────────────────────────────
        //
        // The SDK's MessageQueue keeps the stream alive for multi-turn
        // conversations even after a `result` event. For non-interactive
        // sessions (schedule-triggered), nobody will ever push another
        // message, so `lifecycleDone` would never resolve and the
        // execution record would stay stuck in `running` forever.
        //
        // Fix: fire completion immediately when the result is received,
        // then proactively close the lifecycle for schedule sessions to
        // free the SDK child process.
        //
        const snap = session.snapshot()
        this.fireCompletion(sessionId, {
          stopReason: snap.stopReason,
          error: snap.error ?? undefined,
        })

        // Auto-close lifecycle for non-interactive sessions.
        // Scheduled on the macrotask queue so the current event handler
        // fully returns to the for-await loop before the stream is closed.
        if (session.origin.source === 'schedule') {
          setTimeout(() => {
            lifecycle.stop().catch((err) => {
              log.warn(`Auto-close lifecycle failed for schedule session ${sessionId}`, err)
            })
          }, 0)
        }
      },
    })

    // ── Capability & prompt injection ───────────────────────────────────────
    let hookCleanup: (() => void) | undefined
    let activeMcpServerNames: ReadonlySet<string> | undefined

    // Built-in observational hooks (Claude only). Capability hooks are merged later by runtime.
    let hooks: ReturnType<typeof buildSDKHooks> | undefined
    if (isClaudeEngine) {
      hooks = buildSDKHooks(
        (e) => this.deps.dispatch(e),
        sessionId,
        (newCwd) => {
          resolveExecutionContext(newCwd, config.projectPath ?? null, this.deps.gitCommandExecutor ?? null)
            .then((ctx) => {
              if (session.updateExecutionContext(ctx)) {
                this.deps.dispatch({ type: 'command:session:updated', payload: session.snapshot() })
                this.store.save(session.toPersistenceRecord()).catch((err) =>
                  log.error(`Failed to persist execution context update for ${sessionId}`, err),
                )
              }
            })
            .catch((err) => log.error(`Failed to resolve execution context change for ${sessionId}`, err))
        },
      )
    }

    const capabilityOutput = await this.capabilityRuntime.apply({
      engineKind,
      planInput: {
        projectId: config.projectId,
        request: {
          session: {
            engineKind,
            agentName: config.agentName,
          },
          policy: {
            maxSkillChars: sessionPolicy.capabilities.skill.maxChars,
          },
          activation: {
            explicitSkillNames: sessionPolicy.capabilities.skill.explicit,
            implicitQuery: sessionPolicy.capabilities.skill.implicitQuery,
          },
        },
      },
      promptLayers,
      options,
      builtInHooks: hooks,
    })

    promptLayers = capabilityOutput.promptLayers
    if (Object.keys(capabilityOutput.optionPatch).length > 0) {
      Object.assign(options, capabilityOutput.optionPatch)
    }
    if (capabilityOutput.hooks) {
      hooks = capabilityOutput.hooks
    }
    if (capabilityOutput.hookCleanup) {
      hookCleanup = capabilityOutput.hookCleanup
    }
    if (capabilityOutput.activeMcpServerNames && capabilityOutput.activeMcpServerNames.size > 0) {
      activeMcpServerNames = capabilityOutput.activeMcpServerNames
    }

    // Merge native tool requirements inferred from capability injection
    // (e.g. implicitly activated Evose skills) into the policy allowlist
    // BEFORE creating MCP servers for either engine. This closes the
    // temporal gap where implicit skill activation could inject prompts
    // referencing native tools that the initial policy never included.
    if (capabilityOutput.nativeRequirements && capabilityOutput.nativeRequirements.length > 0) {
      const existing = sessionPolicy.tools.native.mode === 'allowlist'
        ? sessionPolicy.tools.native.allow
        : []
      sessionPolicy.tools.native = {
        mode: 'allowlist',
        allow: mergeNativeAllowlists(existing, capabilityOutput.nativeRequirements),
      }
    }

    // Per-session custom tools (engine-agnostic NativeToolDescriptor[]).
    // Injected as in-process MCP server (Claude) or via HTTP bridge (Codex).
    const customTools = this.runtimes.get(sessionId)?.customTools

    if (isClaudeEngine) {
      // Per-session custom MCP servers (marketplace analysis tools, etc.)
      // Applied after capability servers so custom servers take precedence.
      if (config.customMcpServers && Object.keys(config.customMcpServers).length > 0) {
        options.mcpServers = { ...(options.mcpServers ?? {}), ...config.customMcpServers }
      }

      // Per-session custom tool descriptors → in-process MCP server
      if (customTools && customTools.tools.length > 0) {
        const claudeTools = toClaudeToolDefinitions(customTools.tools)
        const mcpServerConfig = createSdkMcpServer({
          name: customTools.name,
          version: '1.0.0',
          tools: claudeTools,
        })
        options.mcpServers = { ...(options.mcpServers ?? {}), [customTools.name]: mcpServerConfig }
      }

      // Compose final system prompt after all layer adjustments.
      options.systemPrompt = composeSystemPrompt(promptLayers)

      // Built-in native capability tools (after injection plan + allowlist merge).
      if (this.deps.nativeCapabilityRegistry) {
        const toolContext: NativeCapabilityToolContext = {
          session: { sessionId, projectId: config.projectId ?? null, originSource: config.origin.source },
          relay,
          activeMcpServerNames,
        }
        const nativeToolPolicy = sessionPolicy.tools.native
        const serverConfig = nativeToolPolicy.mode === 'allowlist'
          ? this.deps.nativeCapabilityRegistry.createMcpServerConfigForAllowlist(nativeToolPolicy.allow, toolContext)
          : undefined
        if (serverConfig) {
          options.mcpServers = { ...(options.mcpServers ?? {}), ...serverConfig.mcpServers }
        }
      }

      if (hooks) {
        options.hooks = hooks
      }
    } else {
      const mergedWithCustom = mergeCodexMcpServers({
        baseConfig: options.codexConfig,
        overlays: [config.customMcpServers],
      })

      // Built-in native capability tools via Codex stdio bridge.
      let finalCodexConfig = mergedWithCustom.config
      if (this.deps.codexNativeBridgeManager) {
        const bridgeServer = await this.deps.codexNativeBridgeManager.registerSession({
          session: { sessionId, projectId: config.projectId ?? null, originSource: config.origin.source },
          relay,
          nativeToolAllowlist: sessionPolicy.tools.native.mode === 'allowlist'
            ? sessionPolicy.tools.native.allow
            : [],
          activeMcpServerNames: mergedWithCustom.activeServerNames.size > 0
            ? mergedWithCustom.activeServerNames
            : activeMcpServerNames,
          additionalTools: customTools?.tools,
        })
        if (bridgeServer) {
          finalCodexConfig = mergeCodexMcpServers({
            baseConfig: mergedWithCustom.config,
            overlays: [bridgeServer],
          }).config
        }
      }

      if (finalCodexConfig) {
        options.codexConfig = finalCodexConfig
      }

      // Codex SDK currently has no direct equivalent to Claude's systemPrompt/tool hooks,
      // so we pass a composed prompt that the Codex lifecycle prepends on first turn.
      options.codexSystemPrompt = composeSystemPrompt(promptLayers)
    }

    // Conversation V3 pipeline state (runtime -> domain -> projection)
    const pipeline = new ConversationEventPipeline({
      initialPhase: session.getState(),
    })
    if (rt) rt.pipeline = pipeline

    // ── Pre-flight summary (single log for the entire request payload) ────
    const startTime = Date.now()
    log.info('Session pre-flight summary', {
      sessionId,
      engineKind,
      model: options.model ?? 'default',
      promptLayers: {
        identity: !!promptLayers.identity,
        context: promptLayers.context?.length ?? 0,
        memory: promptLayers.memory?.length ?? 0,
        base: promptLayers.base?.length ?? 0,
        session: promptLayers.session?.length ?? 0,
        capability: promptLayers.capability?.length ?? 0,
      },
      systemPromptLength: (options.systemPrompt ?? options.codexSystemPrompt ?? '').length,
      messageCount: session.getMessages().length,
      mcpServerCount: Object.keys(options.mcpServers ?? {}).length,
      hasHooks: !!options.hooks,
      maxTurns: options.maxTurns,
    })

    // Track whether the for-await loop completed normally (not via throw).
    // When the stream throws, handleSessionError (via .catch on lifecycleDone)
    // handles the state transition — the safety net must NOT interfere.
    let streamEndedCleanly = false

    try {
      // stopSession() may run before lifecycle.start() is reached (startup race).
      // In that case the lifecycle is already closed; skip start entirely to avoid
      // throwing "already stopped" and incorrectly downgrading session state to error.
      if (session.getState() === 'stopped' || lifecycle.stopped) {
        log.info('Session lifecycle start skipped because session is already stopped', { sessionId })
        return
      }

      const runtimeEventStream = lifecycle.start(initialPrompt, toSdkOptions(options))
      for await (const runtimeEvent of runtimeEventStream) {
        // Hard stop guard: manual stop sets session state to `stopped`
        // synchronously, but the runtime stream may still yield buffered
        // events before close fully propagates. Ignore those events to
        // prevent post-stop streaming resurrection.
        if (session.getState() === 'stopped') {
          continue
        }

        const projectionResult = pipeline.applyRuntimeEvent({
          runtimeEvent,
          ctx,
        })
        if (projectionResult.shouldAbortLifecycle) {
          await lifecycle.stop().catch((err) => {
            log.warn(`Failed to stop lifecycle after protocol violation for ${sessionId}`, err)
          })
          break
        }
      }
      streamEndedCleanly = true
      log.info('Session lifecycle completed', {
        sessionId,
        engineKind,
        finalState: session.getState(),
        totalMessages: session.getMessages().length,
        durationMs: Date.now() - startTime,
      })
    } finally {
      if (!isClaudeEngine && this.deps.codexNativeBridgeManager) {
        await this.deps.codexNativeBridgeManager.unregisterSession(sessionId).catch((err) => {
          log.warn(`Failed to unregister Codex native bridge session ${sessionId}`, err)
        })
      }
      const rtCleanup = this.runtimes.get(sessionId)
      if (rtCleanup) {
        rtCleanup.pipeline = null
        rtCleanup.policy = null
      }
      hookCleanup?.()  // v3.1 #31: cleanup signal listeners

      // ── Safety net ──────────────────────────────────────────────────
      // If the SDK stream ended cleanly but WITHOUT sending a `result`
      // event, the session is still in an active state (creating /
      // streaming / stopping) with no agent process behind it.
      // Transition to idle so the frontend stops the timer and shows
      // the correct dot colour.
      if (streamEndedCleanly) {
        const finalState = session.getState()
        if (finalState === 'creating' || finalState === 'streaming' || finalState === 'stopping') {
          log.warn(`Session ${sessionId} stream ended in active state '${finalState}' without result — forcing idle`)
          session.transition({ type: 'stream_ended_clean' })
          this.dispatchFinalizedAssistantSnapshots(session)
          this.dispatchSessionTerminal({
            sessionId,
            session,
            terminalEvent: 'idle',
            stopReason: 'completed',
          })
          ctx.persistSession().catch((err) => {
            log.error(`Failed to persist safety-net idle for session ${sessionId}`, err)
          })
        }
      }

      ctx.dispose()
    }
  }

  /**
   * Push a message to an active session's SDK queue (fast path).
   *
   * When the SDK process is still alive (multi-turn mode), pushing directly
   * to the prompt queue avoids the expensive kill-and-restart cycle of
   * resumeSession(). This eliminates the unnecessary `creating` ("Starting...")
   * state that previously occurred for every message sent from `idle`.
   *
   * Returns true if the message was successfully pushed.
   */
  private pushToActiveSession(sessionId: string, rt: SessionRuntime, content: UserMessageContent): boolean {
    if (rt.lifecycle.stopped) return false

    const currentState = rt.session.getState()
    if (currentState !== 'awaiting_input' && currentState !== 'idle' && currentState !== 'error') return false

    rt.lifecycle.pushMessage(content)
    rt.pipeline?.prepareForNextTurn({ phase: 'streaming' })
    rt.session.addMessage('user', userContentToBlocks(content))
    rt.session.transition({ type: 'push_to_active' })

    if (currentState === 'idle' || currentState === 'error') {
      // Reset completion tracking so the next `result` event can fire
      // the callback. Without this, the idempotency guard silently
      // swallows subsequent completions for the same session.
      rt.completionFired = false
    }

    const lastMsg = rt.session.getLastMessage()
    if (lastMsg) {
      this.deps.dispatch({
        type: 'command:session:message',
        payload: {
          sessionId,
          origin: rt.session.origin,
          message: lastMsg,
        }
      })
    }
    this.deps.dispatch({ type: 'command:session:updated', payload: rt.session.snapshot() })

    return true
  }

  async sendMessage(sessionId: string, content: UserMessageContent): Promise<boolean> {
    const rt = this.runtimes.get(sessionId)
    log.debug('sendMessage entered', {
      sessionId,
      hasRuntime: !!rt,
      sessionState: rt?.session.getState() ?? 'no-runtime',
      sessionEngine: rt?.session.getEngineKind() ?? 'unknown',
      defaultEngine: this.deps.getCommandDefaults().defaultEngine,
    })

    // MCP ask_user_question is blocking — route answer to PendingQuestionRegistry
    if (rt && rt.session.getState() === 'awaiting_question' && this.deps.pendingQuestionRegistry) {
      const text = typeof content === 'string'
        ? content
        : content.map(b => b.type === 'text' ? b.text : '').join('\n').trim()

      const resolved = this.deps.pendingQuestionRegistry.resolveBySession(sessionId, text)
      if (resolved) {
        log.debug('sendMessage resolved pending question', { sessionId })
        // Record the user message in session history (for UI display)
        rt.session.addMessage('user', userContentToBlocks(content))
        // State will transition to 'streaming' when the MCP handler resumes (via exitQuestionState)

        const lastMsg = rt.session.getLastMessage()
        if (lastMsg) {
          this.deps.dispatch({
            type: 'command:session:message',
            payload: {
              sessionId,
              origin: rt.session.origin,
              message: lastMsg,
            }
          })
        }
        this.deps.dispatch({ type: 'command:session:updated', payload: rt.session.snapshot() })
        return true
      }
    }

    // ── Lifecycle restart checks ──────────────────────────────────────────
    // Both checks detect conditions where the running SDK subprocess cannot
    // serve the incoming message and needs a fresh lifecycle. Early returns
    // ensure at most one restart per sendMessage call.
    if (rt) {
      // 1. Native capability reconfiguration: check whether this message
      //    requires native tools (explicit via slash commands, or implicit
      //    via plain-text skill references) not present in the current lifecycle.
      let capabilitySnapshot = undefined
      if (this.deps.capabilityCenter) {
        try {
          capabilitySnapshot = await this.deps.capabilityCenter.getSnapshot(
            rt.session.getConfig().projectId,
          )
        } catch (err) {
          log.warn('Failed to load capability snapshot for reconfiguration check — implicit matching skipped', err)
        }
      }

      const reconfigureDecision = decideSessionReconfiguration({
        currentPolicy: rt.policy ?? undefined,
        message: content,
        capabilitySnapshot,
      })
      if (reconfigureDecision.action === 'restart') {
        log.info('sendMessage forcing lifecycle rebootstrap for native capability activation', {
          sessionId,
          reason: reconfigureDecision.reason,
          triggeringRequirements: reconfigureDecision.triggeringRequirements?.map((r) => r.capability),
        })
        return await this.resumeSessionInternal(sessionId, content, { forceRestart: true })
      }

      // 2. Provider mode drift: SDK subprocess env is frozen at spawn. If the
      //    user switched provider mode mid-session, force a lifecycle restart
      //    to pick up fresh credentials.
      const engineKind = rt.session.getEngineKind()
      const currentMode = this.deps.getActiveProviderMode(engineKind)
      const sessionMode = rt.providerMode ?? null
      if (currentMode !== sessionMode) {
        log.info('sendMessage: provider mode drift detected, restarting lifecycle', {
          sessionId,
          from: sessionMode,
          to: currentMode,
        })
        return await this.resumeSessionInternal(sessionId, content, { forceRestart: true })
      }

      // 3. Engine kind drift: user switched default engine since this session started.
      //    Pattern identical to provider mode drift above.
      if (this.detectAndApplyEngineDrift(rt.session)) {
        return await this.resumeSessionInternal(sessionId, content, { forceRestart: true })
      }
    }

    // Active session with live lifecycle — push to SDK queue directly.
    if (rt && this.pushToActiveSession(sessionId, rt, content)) {
      log.debug('sendMessage pushed to active lifecycle queue', { sessionId })
      return true
    }

    // Race-condition recovery: renderer allowed the send based on stale state
    // (most commonly caused by manual compact setting 'awaiting_input' that was
    // immediately recovered to 'streaming' by the next SDK event before the
    // renderer IPC arrived). The lifecycle is still alive, so queue the message
    // for the next turn instead of dropping it.
    if (rt && !rt.lifecycle.stopped) {
      const activeState = rt.session.getState()
      if (activeState === 'streaming' || activeState === 'creating') {
        rt.lifecycle.pushMessage(content)
        rt.session.addMessage('user', userContentToBlocks(content))

        const lastMsg = rt.session.getLastMessage()
        if (lastMsg) {
          this.deps.dispatch({
            type: 'command:session:message',
            payload: {
              sessionId,
              origin: rt.session.origin,
              message: lastMsg,
            },
          })
        }
        this.deps.dispatch({ type: 'command:session:updated', payload: rt.session.snapshot() })

        log.info('sendMessage queued for active session (renderer–backend race recovery)', {
          sessionId,
          activeState,
        })
        return true
      }
    }

    // Stopped/idle session without active lifecycle — resume with new SDK query.
    // This path is taken when the SDK process has exited (lifecycle.stopped === true)
    // or the session was loaded from persisted storage (no active runtime).
    const session = rt?.session
    const snap = session?.snapshot() ?? await this.store.get(sessionId)
    if (snap && (snap.state === 'idle' || snap.state === 'stopped' || snap.state === 'error')) {
      log.info('sendMessage resuming persisted/idle session', { sessionId, priorState: snap.state })
      return await this.resumeSession(sessionId, content)
    }

    // Diagnostic: include session state and lifecycle status to aid debugging.
    // Remaining causes (after the race-recovery path above):
    //  1. Session in 'stopping' / 'awaiting_question' with no pendingQuestionRegistry.
    //  2. Session lifecycle crashed and handleSessionError() removed the runtime
    //     before async store.save() persisted the new 'error' state.
    //  3. Session not found in either active map or persistent store.
    const currentState = snap?.state ?? (rt ? rt.session.getState() : undefined)
    const lifecycleStopped = rt ? rt.lifecycle.stopped : undefined
    log.warn('sendMessage ignored because session is not available for message push', {
      sessionId,
      sessionState: currentState ?? 'unknown',
      hasActiveRuntime: !!rt,
      lifecycleStopped,
    })
    return false
  }

  async resumeSession(sessionId: string, message: UserMessageContent): Promise<boolean> {
    return this.resumeSessionInternal(sessionId, message, { forceRestart: false })
  }

  private async resumeSessionInternal(
    sessionId: string,
    message: UserMessageContent,
    options: { forceRestart: boolean },
  ): Promise<boolean> {
    log.debug('resumeSessionInternal entered', {
      sessionId,
      forceRestart: options.forceRestart,
      defaultEngine: this.deps.getCommandDefaults().defaultEngine,
    })

    const existing = this.runtimes.get(sessionId)
    let forceRestart = options.forceRestart

    // ── Engine drift check (must run BEFORE the fast path) ────────────────
    // The fast path pushes messages into the existing lifecycle queue, which
    // would silently bypass engine switching. Detect drift first; if the
    // engine changed, skip the fast path and fall through to full restart.
    if (existing && !forceRestart && this.detectAndApplyEngineDrift(existing.session)) {
      log.info('resumeSessionInternal: engine drift detected, skipping fast path for full restart', { sessionId })
      forceRestart = true
    }

    // Fast path: if the SDK process is still alive (multi-turn wait mode),
    // push to the existing queue instead of the expensive kill → restart cycle.
    // This is the primary entry point from the renderer for `idle` sessions
    // (the renderer routes idle → onResume → resumeSession).
    if (!forceRestart && existing && this.pushToActiveSession(sessionId, existing, message)) {
      log.debug('resumeSession fast path: reused active lifecycle', { sessionId })
      return true
    }

    // Full restart: stop existing lifecycle, start fresh SDK query.
    if (existing) {
      log.info('resumeSession full restart: stopping existing lifecycle first', { sessionId })
      await existing.lifecycle.stop()
      await existing.lifecycleDone.catch(() => {})
    }

    // Find the session — check active runtimes first, then persisted store
    let session: ManagedSession | null = existing?.session ?? null

    if (!session) {
      const persisted = await this.store.get(sessionId)
      if (!persisted) return false
      session = ManagedSession.fromInfo(persisted)
    }

    // Engine kind drift check — covers persisted sessions restored from store
    // (no active runtime). Idempotent: no-op if already applied above.
    const engineSwitched = this.detectAndApplyEngineDrift(session)

    const engineSessionRef = session.getEngineRef()
    if (!engineSessionRef && !forceRestart && !engineSwitched) {
      log.warn('resumeSession failed: missing engine session ref', { sessionId })
      return false
    }

    // Create fresh lifecycle (one-shot, never reused)
    const lifecycle = createSessionLifecycle(session.getEngineKind())

    session.addMessage('user', userContentToBlocks(message))
    session.transition({ type: 'resume_session' })

    // Dispatch user message + state update
    const lastMsg = session.getLastMessage()
    if (lastMsg) {
      this.deps.dispatch({
        type: 'command:session:message',
        payload: {
          sessionId,
          origin: session.origin,
          message: lastMsg,
        }
      })
    }
    this.deps.dispatch({ type: 'command:session:updated', payload: session.snapshot() })

    // Register runtime BEFORE starting runSession (same race-prevention as startSession).
    // Carry over spawnErrorCount from the previous runtime (if any) so transient
    // retry counting survives across lifecycle restarts.
    const rt: SessionRuntime = {
      session,
      lifecycle,
      lifecycleDone: Promise.resolve(),
      pipeline: null,
      policy: null,
      providerMode: null,
      spawnErrorCount: existing?.spawnErrorCount ?? 0,
      completionFired: false,
    }
    this.runtimes.set(sessionId, rt)

    rt.lifecycleDone = this.runSession(
      session, lifecycle, message,
      engineSessionRef
        ? { resume: engineSessionRef }
        : { skipAddMessage: true },  // engine switch or fresh start: message already added above
    ).catch(async (err) => this.handleSessionError(sessionId, err))

    log.info('resumeSession started new lifecycle', { sessionId })
    return true
  }

  // ── Engine drift helpers ─────────────────────────────────────────────

  /**
   * Detect and apply engine kind drift: if the session's engine differs from
   * the current default, switch it in-place and dispatch UI updates.
   *
   * @returns `true` if an engine switch was performed.
   */
  private detectAndApplyEngineDrift(session: ManagedSession): boolean {
    const currentDefaultEngine = this.deps.getCommandDefaults().defaultEngine
    const sessionEngine = session.getEngineKind()
    if (sessionEngine === currentDefaultEngine) return false

    const messageCount = session.getMessages().length
    log.info('engine kind drift detected, switching engine', {
      sessionId: session.id,
      origin: session.origin.source,
      from: sessionEngine,
      to: currentDefaultEngine,
      messageCount,
    })
    const summary = buildConversationSummary({
      messages: session.getMessages(),
      fromEngine: sessionEngine,
    })
    session.switchEngine({
      newEngine: currentDefaultEngine,
      contextSummary: summary,
      originalContext: session.getConfig().contextSystemPrompt,
    })
    log.info('engine switch applied', {
      sessionId: session.id,
      newEngine: currentDefaultEngine,
      summaryLength: summary.length,
      hasOriginalContext: !!session.getConfig().contextSystemPrompt,
    })

    // Dispatch snapshot + system event so renderer updates immediately
    this.dispatchSessionUpdate(session)
    this.dispatchLastSystemEvent(session)
    return true
  }

  // ── Dispatch helpers ──────────────────────────────────────────────────

  private dispatchSessionUpdate(session: ManagedSession): void {
    this.deps.dispatch({ type: 'command:session:updated', payload: session.snapshot() })
  }

  private dispatchSessionTerminal(params: {
    sessionId: string
    session: ManagedSession
    terminalEvent: 'idle' | 'stopped' | 'error'
    stopReason?: SessionStopReason
    result?: string
    error?: string
  }): SessionSnapshot {
    return dispatchSessionTerminalEvent({
      sessionId: params.sessionId,
      session: params.session,
      dispatch: this.deps.dispatch,
      terminalEvent: params.terminalEvent,
      stopReason: params.stopReason,
      result: params.result,
      error: params.error,
    })
  }

  private dispatchMessageById(session: ManagedSession, messageId: string): void {
    const message = session.getMessageById(messageId)
    if (!message) return
    this.deps.dispatch({
      type: 'command:session:message',
      payload: { sessionId: session.id, origin: session.origin, message },
    })
  }

  private finalizeTerminalAssistantMessages(session: ManagedSession): string[] {
    const finalizedIds: string[] = []
    for (const message of session.getMessages()) {
      if (message.role !== 'assistant') continue
      let touched = false
      if (message.isStreaming === true) {
        session.finalizeStreamingMessage(message.id)
        touched = true
      }
      if (message.activeToolUseId != null) {
        session.setActiveToolUseId(message.id, null)
        touched = true
      }
      if (touched) finalizedIds.push(message.id)
    }
    return finalizedIds
  }

  private dispatchFinalizedAssistantSnapshots(session: ManagedSession): void {
    const finalizedIds = this.finalizeTerminalAssistantMessages(session)
    for (const messageId of finalizedIds) {
      this.dispatchMessageById(session, messageId)
    }
  }

  private dispatchLastSystemEvent(session: ManagedSession): void {
    const lastMsg = session.getLastMessage()
    if (lastMsg && lastMsg.role === 'system') {
      this.deps.dispatch({
        type: 'command:session:message',
        payload: { sessionId: session.id, origin: session.origin, message: lastMsg },
      })
    }
  }

  // ── Session lifecycle ───────────────────────────────────────────────

  async stopSession(sessionId: string): Promise<boolean> {
    const rt = this.runtimes.get(sessionId)
    if (!rt) {
      log.debug('stopSession ignored: session not active', { sessionId })
      return false
    }
    log.info('stopSession requested', { sessionId })

    // Cancel any pending question before stopping — unblocks the MCP handler
    this.deps.pendingQuestionRegistry?.cancelBySession(sessionId)

    // Set final state and persist BEFORE async lifecycle cleanup.
    // This ensures the session survives force-kills (e.g. electron-vite dev restart).
    rt.session.transition({ type: 'user_stopped' })

    // Stop lifecycle immediately after entering `stopped` to minimize the
    // window where buffered runtime events can still arrive.
    const stopPromise = rt.lifecycle.stop()

    this.dispatchFinalizedAssistantSnapshots(rt.session)

    try {
      await this.store.save(rt.session.toPersistenceRecord())
    } catch (err) {
      log.error(`Failed to persist session ${sessionId}`, err)
    }

    this.dispatchSessionTerminal({
      sessionId,
      session: rt.session,
      terminalEvent: 'stopped',
      stopReason: 'user_stopped',
    })

    // Deterministic cleanup: wait for close + stream drain
    await stopPromise
    await rt.lifecycleDone.catch(() => {})

    this.runtimes.delete(sessionId)

    // NOTE: We intentionally do NOT release the browser view here.
    // Stopping a response ≠ ending the session — the user may still want to
    // inspect the page or send follow-up messages that reuse the same view.
    // Browser views are released only on deleteSession() or fatal error paths.

    log.info('stopSession completed', { sessionId })
    return true
  }

  /**
   * Permanently delete a session and all its in-memory/persisted state.
   *
   * Active sessions are stopped first (SDK process shutdown + browser view release),
   * then the database record is removed. Idempotent: returns false if the session
   * does not exist in either the active map or the persistent store.
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    log.info('deleteSession requested', { sessionId })
    const rt = this.runtimes.get(sessionId)

    // Phase 1: If the session is active, stop it first (releases SDK process).
    // stopSession intentionally keeps the browser view alive for user inspection,
    // so we explicitly release it here since the session is being permanently deleted.
    const fallbackIssueId = rt
      ? getOriginIssueId(rt.session.snapshot().origin) ?? undefined
      : undefined
    if (rt) {
      await this.stopSession(sessionId)
    }
    this.deps.browserService?.releaseSessionView(sessionId, fallbackIssueId).catch((err) => {
      log.warn(`Failed to release browser view for deleted session ${sessionId}`, err)
    })

    // Phase 2: Remove from persistent store (idempotent — no-op if not found)
    if (!rt) {
      const persisted = await this.store.get(sessionId)
      if (!persisted) {
        log.debug('deleteSession ignored: session not found', { sessionId })
        return false
      }
    }
    await this.store.remove(sessionId)

    // Phase 3: Broadcast deletion event
    this.deps.dispatch({
      type: 'command:session:deleted',
      payload: { sessionId },
    })

    log.info('deleteSession completed', { sessionId })
    return true
  }

  private async handleSessionError(sessionId: string, err: unknown): Promise<void> {
    log.error(`Session ${sessionId} failed`, err)

    // Cancel any pending question — unblocks the MCP handler so it can exit cleanly
    this.deps.pendingQuestionRegistry?.cancelBySession(sessionId)

    // Snapshot the runtime BEFORE touching the map — avoids race with resumeSession
    // which may have already replaced the runtime by the time this .catch() runs.
    const rt = this.runtimes.get(sessionId)
    if (!rt) return
    const session = rt.session

    // User-initiated stop has already converged this session to terminal "stopped".
    // Late lifecycle errors after shutdown must not overwrite that state.
    if (session.getState() === 'stopped') {
      log.info(`Ignoring late runtime error for already-stopped session ${sessionId}`)
      return
    }

    this.dispatchFinalizedAssistantSnapshots(session)

    // Capture fallback issue ID BEFORE potentially removing the runtime.
    // Use session.origin directly — avoids the O(n) deep-copy of getInfo().
    const fallbackIssueId = getOriginIssueId(session.origin) ?? undefined

    const spawnCategory = classifySpawnError(err)
    let snap: SessionSnapshot

    if (spawnCategory === 'process_corrupted') {
      // EBADF: file descriptor leak in the Electron process.
      // NOT retryable — will fail again with the same error every time.
      // Give the user a clear, immediate error with actionable guidance.
      const code = (err as NodeJS.ErrnoException).code ?? 'EBADF'
      session.transition({
        type: 'process_corrupted',
        message: `Session process failed (${code}). Please restart OpenCow to recover.`,
      })
      this.runtimes.delete(sessionId)
      snap = this.dispatchSessionTerminal({
        sessionId,
        session,
        terminalEvent: 'error',
        error: `Session process failed (${code}). Please restart OpenCow to recover.`,
      })
    } else if (spawnCategory === 'transient') {
      // EMFILE/ENFILE/EAGAIN: temporary OS resource pressure.
      // May succeed after retry — track count and allow limited retries.
      const count = rt.spawnErrorCount + 1
      rt.spawnErrorCount = count

      if (count <= MAX_TRANSIENT_RETRIES) {
        log.warn(`Transient spawn error for ${sessionId} (${count}/${MAX_TRANSIENT_RETRIES}) — setting idle`)
        session.transition({ type: 'spawn_error_transient' })
        // Keep runtime alive so spawnErrorCount survives for the next retry.
        // Clear operational fields since the lifecycle is dead.
        rt.pipeline = null
        rt.policy = null
        snap = this.dispatchSessionTerminal({
          sessionId,
          session,
          terminalEvent: 'idle',
          stopReason: 'completed',
        })
      } else {
        log.error(`Transient retries exhausted for ${sessionId} (${count})`)
        const code = (err as NodeJS.ErrnoException).code ?? 'unknown'
        session.transition({
          type: 'spawn_error_permanent',
          message: `Session process failed (${code}) after ${count} retries. Please restart OpenCow.`,
        })
        this.runtimes.delete(sessionId)
        snap = this.dispatchSessionTerminal({
          sessionId,
          session,
          terminalEvent: 'error',
          error: `Session process failed (${code}) after ${count} retries. Please restart OpenCow.`,
        })
      }
    } else {
      // Non-spawn error — permanent error state
      session.transition({
        type: 'spawn_error_permanent',
        message: err instanceof Error ? err.message : String(err),
      })
      this.runtimes.delete(sessionId)
      snap = this.dispatchSessionTerminal({
        sessionId,
        session,
        terminalEvent: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // Release browser view and restore display ownership.
    // Without this, a crashed session's WebContentsView leaks, and _focusedSessionId
    // is never cleared, preventing future sessions from auto-claiming the display.
    this.deps.browserService?.releaseSessionView(sessionId, fallbackIssueId).catch((releaseErr) => {
      log.warn(`Failed to release browser view for errored session ${sessionId}`, releaseErr)
    })

    try {
      await this.store.save(session.toPersistenceRecord())
    } catch (persistErr) {
      log.error(`Failed to persist errored session ${sessionId}`, persistErr)
    }
  }

  async listSessions(): Promise<SessionSnapshot[]> {
    // Active sessions take precedence; supplement with persisted stopped/errored sessions
    const active = Array.from(this.runtimes.values()).map((rt) => rt.session.snapshot())
    const activeIds = new Set(active.map((s) => s.id))
    const persisted = (await this.store.list()).filter((s) => !activeIds.has(s.id))
    return [...active, ...persisted]
  }

  async getSession(sessionId: string): Promise<SessionSnapshot | null> {
    // Check active sessions first, then fall back to persisted
    return this.runtimes.get(sessionId)?.session.snapshot() ?? await this.store.get(sessionId)
  }

  /**
   * Get the full session record including messages — O(n) deep copy.
   *
   * Use only for operations that genuinely need the message array
   * (artifact capture, transcript building). For hot paths, use `getSession()`.
   */
  async getFullSession(sessionId: string): Promise<ManagedSessionInfo | null> {
    const rt = this.runtimes.get(sessionId)
    if (rt) return rt.session.toPersistenceRecord()
    return this.store.get(sessionId)
  }

  /**
   * List all sessions with full message content — O(Σn) deep copy.
   *
   * Use only for batch operations that need messages (artifact backfill).
   * For hot paths, use `listSessions()`.
   */
  async listFullSessions(): Promise<ManagedSessionInfo[]> {
    const active = Array.from(this.runtimes.values()).map((rt) => rt.session.toPersistenceRecord())
    const activeIds = new Set(active.map((s) => s.id))
    const persisted = (await this.store.list()).filter((s) => !activeIds.has(s.id))
    return [...active, ...persisted]
  }

  /**
   * Resolve a session by any candidate reference (OpenCow ID or engine ref).
   *
   * Active in-memory sessions are always preferred over persisted rows.
   */
  async getSessionByRefs(sessionRefs: string[]): Promise<SessionSnapshot | null> {
    const refs = new Set(sessionRefs.filter((v) => typeof v === 'string' && v.length > 0))
    if (refs.size === 0) return null

    for (const ref of refs) {
      const active = this.findActiveRuntime(ref)
      if (active) return active.session.snapshot()
    }

    return this.store.findBySessionRefs([...refs])
  }

  /**
   * Switch session to 'awaiting_question' state.
   *
   * Called by InteractionNativeCapability when the ask_user_question MCP tool
   * blocks for user input.  Enables the input bar and card Confirm button.
   */
  enterQuestionState(sessionId: string): boolean {
    const rt = this.runtimes.get(sessionId)
    if (!rt) return false
    if (rt.session.getState() !== 'streaming') {
      log.warn(`enterQuestionState called but session ${sessionId} is in '${rt.session.getState()}' state — skipping`)
      return false
    }
    rt.session.transition({ type: 'question_asked' })
    this.deps.dispatch({ type: 'command:session:updated', payload: rt.session.snapshot() })
    return true
  }

  /**
   * Restore session to 'streaming' state after user answers a question.
   *
   * Called by InteractionNativeCapability when the user submits an answer
   * and the SDK handler is about to resume.
   */
  exitQuestionState(sessionId: string): void {
    const rt = this.runtimes.get(sessionId)
    if (!rt) return
    if (rt.session.getState() !== 'awaiting_question') {
      log.warn(`exitQuestionState called but session ${sessionId} is in '${rt.session.getState()}' state — skipping`)
      return
    }
    rt.session.transition({ type: 'question_answered' })
    this.deps.dispatch({ type: 'command:session:updated', payload: rt.session.snapshot() })
  }

  /** Expose the PendingQuestionRegistry for IPC handlers. */
  getPendingQuestionRegistry(): PendingQuestionRegistry | undefined {
    return this.deps.pendingQuestionRegistry
  }

  /**
   * Check whether a sessionId belongs to a currently active managed session.
   *
   * Checks both the OpenCow-generated session ID (`ccb-XXXX`) and the SDK's
   * internal engine session ref (UUID), because CLI hook events use the SDK's
   * `session_id` while OpenCow uses its own ID internally.
   */
  isManagedSession(sessionId: string): boolean {
    return this.findActiveRuntime(sessionId) !== null
  }

  /**
   * HookSource skip policy for managed sessions.
   *
   * Only Claude managed sessions should be skipped because Claude emits
   * authoritative SDK hooks directly into DataBus. Codex does not provide
   * equivalent SDK hooks, so its hook-log events must continue flowing.
   */
  shouldSkipHookSourceEvent(sessionId: string): boolean {
    const rt = this.findActiveRuntime(sessionId)
    if (!rt) return false
    return rt.session.getEngineKind() === 'claude'
  }

  private findActiveRuntime(sessionRef: string): SessionRuntime | null {
    const direct = this.runtimes.get(sessionRef)
    if (direct) return direct

    for (const rt of this.runtimes.values()) {
      if (rt.session.getEngineRef() === sessionRef) {
        return rt
      }
    }

    return null
  }

  /** Called on app.on('before-quit') — awaits all session persistence */
  async shutdown(): Promise<void> {
    const startedAt = Date.now()
    log.info('SessionOrchestrator shutdown started', {
      activeSessions: this.runtimes.size,
    })
    // Stop health audit timer
    if (this.auditTimer) {
      clearInterval(this.auditTimer)
      this.auditTimer = null
    }

    // Cancel all pending questions — unblocks MCP handlers so they can exit
    this.deps.pendingQuestionRegistry?.cancelAll()

    // Phase 1: Persist ALL active sessions immediately.
    // This must complete before any async lifecycle cleanup because
    // the process may be force-killed at any moment (e.g. electron-vite dev restart).
    for (const [id, rt] of this.runtimes) {
      rt.session.transition({ type: 'shutdown' })
      try {
        await this.store.save(rt.session.toPersistenceRecord())
      } catch (err) {
        log.error(`Failed to persist session ${id} during shutdown`, err)
      }
    }

    // Phase 2: Best-effort lifecycle cleanup (close SDK processes).
    // Run concurrently — we've already persisted everything.
    await Promise.allSettled(
      Array.from(this.runtimes.values()).map((rt) =>
        rt.lifecycle.stop().catch(() => {})
      )
    )

    if (this.deps.codexNativeBridgeManager) {
      await this.deps.codexNativeBridgeManager.dispose().catch((err) => {
        log.warn('Failed to dispose Codex native bridge manager during shutdown', err)
      })
    }

    this.runtimes.clear()
    log.info('SessionOrchestrator shutdown completed', {
      durationMs: Date.now() - startedAt,
    })
  }

  /** Expose the store for testing */
  getStore(): ManagedSessionStore {
    return this.store
  }
}

/**
 * Merge two native tool allowlists, deduplicating by `capability::tool` key.
 *
 * Used to combine the initial policy allowlist (from explicit slash commands)
 * with requirements discovered during capability injection (from implicitly
 * activated skills like Evose apps).
 */
function mergeNativeAllowlists(
  base: readonly StartSessionNativeToolAllowItem[],
  extra: readonly StartSessionNativeToolAllowItem[],
): StartSessionNativeToolAllowItem[] {
  const seen = new Set<string>()
  const merged: StartSessionNativeToolAllowItem[] = []

  const add = (item: StartSessionNativeToolAllowItem): void => {
    const key = `${item.capability}::${item.tool ?? '*'}`
    if (seen.has(key)) return
    seen.add(key)
    merged.push(item.tool ? { capability: item.capability, tool: item.tool } : { capability: item.capability })
  }

  for (const item of base) add(item)
  for (const item of extra) add(item)
  return merged
}

// ── Electron env sanitization ─────────────────────────────────────────
//
// Electron injects runtime-internal env vars that can silently break child
// processes — especially native binaries (Codex) and their Node.js
// subprocesses (MCP servers).
//
// Known problematic categories:
//  • ELECTRON_*       – Electron internal state (ELECTRON_RUN_AS_NODE,
//                       ELECTRON_EXEC_PATH, ELECTRON_CLI_ARGS, etc.)
//  • NODE_OPTIONS     – often contains --require for Electron asar support
//                       that doesn't exist outside the Electron process
//  • NODE_PATH        – may point to Electron's internal module directories
//  • NODE_CHANNEL_FD  – Electron IPC file descriptor, meaningless outside
//  • NODE_ENV_ELECTRON_VITE – build tool artifact
//  • ORIGINAL_XDG_CURRENT_DESKTOP – Electron Linux desktop override
//  • CHROME_DESKTOP   – Electron Linux desktop identifier
//
// This function mutates `env` in place and returns the list of removed keys.

/**
 * Env var key prefixes / exact names that should never leak from the
 * Electron host into child processes.
 */
const ELECTRON_ENV_BLOCKLIST_PREFIXES = [
  'ELECTRON_',
]

const ELECTRON_ENV_BLOCKLIST_EXACT = new Set([
  'NODE_OPTIONS',
  'NODE_CHANNEL_FD',
  'NODE_ENV_ELECTRON_VITE',
  'ORIGINAL_XDG_CURRENT_DESKTOP',
  'CHROME_DESKTOP',
  'GOOGLE_API_KEY',
  'GOOGLE_DEFAULT_CLIENT_ID',
  'GOOGLE_DEFAULT_CLIENT_SECRET',
])

/**
 * Remove Electron-specific env vars from a session env dict.
 *
 * @returns Array of removed key names (for diagnostic logging).
 */
export function sanitizeChildProcessEnv(env: Record<string, string>): string[] {
  const removed: string[] = []
  for (const key of Object.keys(env)) {
    if (ELECTRON_ENV_BLOCKLIST_EXACT.has(key)) {
      delete env[key]
      removed.push(key)
      continue
    }
    for (const prefix of ELECTRON_ENV_BLOCKLIST_PREFIXES) {
      if (key.startsWith(prefix)) {
        delete env[key]
        removed.push(key)
        break
      }
    }
  }
  return removed
}
