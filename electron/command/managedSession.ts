// SPDX-License-Identifier: Apache-2.0

import { nanoid } from 'nanoid'
import type {
  AIEngineKind,
  ManagedSessionConfig,
  ManagedSessionState,
  ManagedSessionInfo,
  ManagedSessionMessage,
  SessionSnapshot,
  ContentBlock,
  ToolUseBlock,
  SystemEvent,
  SessionStopReason,
  SessionOrigin,
  SessionExecutionContext,
  SessionContextState,
  SessionContextTelemetry,
  EvoseRelayEvent,
  EvoseProgressBlock,
  EvoseToolCallBlock,
} from '../../src/shared/types'
import type { SessionLifecycleEvent } from './sessionStateMachine'
import { createLogger } from '../platform/logger'

const log = createLogger('ManagedSession')

/**
 * Dynamic engine switch parameters.
 *
 * Structured as an object to keep the call site self-documenting
 * and extensible without changing the method signature.
 */
export interface SwitchEngineParams {
  /** Target engine to switch to. */
  newEngine: AIEngineKind
  /** Conversation summary injected as context for the new engine. */
  contextSummary?: string
  /**
   * Original context system prompt (from issue/project).
   * Passed explicitly so switchEngine replaces — not appends to —
   * any prior engine-switch summary, preventing unbounded growth.
   */
  originalContext?: string
}

export interface ManagedSessionRuntimeConfig extends ManagedSessionConfig {
  customMcpServers?: Record<string, Record<string, unknown>>
}

// ---------------------------------------------------------------------------
// Active-state classification
// ---------------------------------------------------------------------------

/**
 * States where the session is actively working (agent processing).
 * Only time spent in these states counts toward `activeDurationMs`.
 */
const ACTIVE_STATES: ReadonlySet<ManagedSessionState> = new Set([
  'creating',
  'streaming',
  'stopping',
])

function isActiveState(state: ManagedSessionState): boolean {
  return ACTIVE_STATES.has(state)
}

const CONTEXT_SNAPSHOT_MIN_INTERVAL_MS = 120
const CONTEXT_SNAPSHOT_MIN_USED_DELTA = 32

function normalizeUsedTokens(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.trunc(value)
}

function normalizeLimitTokens(value: number | null | undefined): number | null {
  if (value == null) return null
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.max(1, Math.trunc(value))
}

function normalizeContextSource(source: string): string {
  return source.trim().length > 0 ? source : 'unknown'
}

function normalizeUpdatedAtMs(updatedAtMs: number | undefined): number {
  if (updatedAtMs == null) return Date.now()
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return Date.now()
  return Math.trunc(updatedAtMs)
}

function normalizeContextState(params: {
  usedTokens: number
  limitTokens: number | null
  source: string
  confidence: SessionContextState['confidence']
  updatedAtMs?: number
}): SessionContextState {
  return {
    usedTokens: normalizeUsedTokens(params.usedTokens),
    limitTokens: normalizeLimitTokens(params.limitTokens),
    source: normalizeContextSource(params.source),
    confidence: params.confidence === 'authoritative' ? 'authoritative' : 'estimated',
    updatedAtMs: normalizeUpdatedAtMs(params.updatedAtMs),
  }
}

function toContextTelemetry(state: SessionContextState | null): SessionContextTelemetry | null {
  if (!state || state.limitTokens == null) return null
  const remainingTokens = Math.max(0, state.limitTokens - state.usedTokens)
  const remainingPct = Math.max(0, Math.min(100, (remainingTokens / state.limitTokens) * 100))
  return {
    usedTokens: state.usedTokens,
    limitTokens: state.limitTokens,
    remainingTokens,
    remainingPct,
    source: state.source,
    confidence: state.confidence,
    updatedAtMs: state.updatedAtMs,
  }
}

/**
 * Tracks the state and messages of a single Claude Code session
 * managed by OpenCow. Does NOT own the SDK query — that's the
 * SessionOrchestrator's job. This is pure state management.
 */
export class ManagedSession {
  private sessionId: string
  private engineKind: AIEngineKind
  private engineSessionRef: string | null = null
  private engineState: Record<string, unknown> | null = null
  private state: ManagedSessionState = 'creating'
  private config: ManagedSessionRuntimeConfig
  private messages: ManagedSessionMessage[] = []
  private model: string | null
  private createdAt: number
  private lastActivity: number
  /** Cumulative ms spent in active states (creating/streaming/stopping). */
  private activeDurationMs = 0
  /** Epoch ms when the session last entered an active state; null when inactive. */
  private activeStartedAt: number | null = null
  private totalCostUsd = 0
  private inputTokens = 0
  private outputTokens = 0
  private contextState: SessionContextState | null = null
  private activity: string | null = null
  private error: string | null = null
  private _stopReason: SessionStopReason | null = null
  private systemEventIndex = new Map<string, string>()
  private executionContext: SessionExecutionContext | null = null

  constructor(config: ManagedSessionRuntimeConfig) {
    this.sessionId = `ccb-${nanoid(12)}`
    const engineKind: AIEngineKind = config.engineKind ?? 'claude'
    const engineState: Record<string, unknown> | null = config.engineState ?? null
    this.config = {
      ...config,
      engineKind,
      engineState,
    }
    this.engineKind = engineKind
    this.engineState = engineState
    this.model = config.model ?? null
    const now = Date.now()
    this.createdAt = now
    this.lastActivity = now
    // Initial state is 'creating' which is active
    this.activeStartedAt = now
  }

  get id(): string {
    return this.sessionId
  }

  /** Cheap accessor — avoids a full getInfo() copy in hot dispatch paths. */
  get origin(): SessionOrigin {
    return this.config.origin
  }

  /** Store the real engine session/thread reference from SDK init (does NOT change public id). */
  setEngineSessionRef(engineSessionRef: string): void {
    this.engineSessionRef = engineSessionRef
  }

  setEngineState(engineState: Record<string, unknown> | null): void {
    this.engineState = engineState
    this.lastActivity = Date.now()
  }

  private setState(state: ManagedSessionState): void {
    this.settleActiveDuration(state)
    this.state = state
    this.lastActivity = Date.now()
  }

  /** Fast O(1) state accessor — avoids the full messages copy of getInfo(). */
  getState(): ManagedSessionState {
    return this.state
  }

  /** Cheap engine accessor for projection/runtime logic. */
  getEngineKind(): AIEngineKind {
    return this.engineKind
  }

  /**
   * Switch the session to a different AI engine.
   *
   * Clears engine-specific state (ref, checkpoint) since they cannot cross
   * engine boundaries. Injects a system event marker into the message timeline.
   *
   * This method is purely state mutation — it does NOT create or start a new
   * lifecycle. The caller (SessionOrchestrator) is responsible for restarting
   * the lifecycle after calling this.
   */
  switchEngine(params: SwitchEngineParams): void {
    const { newEngine, contextSummary, originalContext } = params
    const oldEngine = this.engineKind
    if (oldEngine === newEngine) return

    // 1. Update both storage locations (dual storage invariant)
    this.engineKind = newEngine
    this.config = { ...this.config, engineKind: newEngine }

    // 2. Clear engine-specific state (cannot resume cross-engine)
    this.engineSessionRef = null
    this.engineState = null

    // 3. Set context system prompt: original context + engine switch summary.
    //    Replace (not append) to prevent unbounded growth on A→B→A cycles.
    if (contextSummary) {
      this.config = {
        ...this.config,
        contextSystemPrompt: originalContext
          ? `${originalContext}\n\n${contextSummary}`
          : contextSummary,
      }
    }

    // 4. Insert engine switch marker into message timeline
    this.addSystemEvent({ type: 'engine_switch', fromEngine: oldEngine, toEngine: newEngine })

    log.info('switchEngine', {
      sessionId: this.sessionId,
      from: oldEngine,
      to: newEngine,
      summaryLength: contextSummary?.length ?? 0,
    })
    this.lastActivity = Date.now()
  }

  /** Cheap model accessor for projection/runtime logic. */
  getModel(): string | null {
    return this.model
  }

  private setError(message: string): void {
    this.error = message
    this.settleActiveDuration('error')
    this.state = 'error'
    this.lastActivity = Date.now()
  }

  private clearError(): void {
    if (this.error === null) return
    this.error = null
    this.lastActivity = Date.now()
  }

  // ---------------------------------------------------------------------------
  // Active duration bookkeeping
  // ---------------------------------------------------------------------------

  /**
   * Settle the active-duration accumulator on a state transition.
   *
   * Called **before** the state field is actually updated so that
   * `this.state` still reflects the *old* state.
   *
   *  - Leaving an active state → flush elapsed active time into `activeDurationMs`.
   *  - Entering an active state → record `activeStartedAt`.
   *  - Entering an inactive state → clear `activeStartedAt`.
   */
  private settleActiveDuration(nextState: ManagedSessionState): void {
    const now = Date.now()
    // Flush elapsed active time from the *outgoing* state
    if (isActiveState(this.state) && this.activeStartedAt != null) {
      this.activeDurationMs += now - this.activeStartedAt
    }
    // Set up tracking for the *incoming* state
    this.activeStartedAt = isActiveState(nextState) ? now : null
  }

  private setStopReason(reason: SessionStopReason | null): void {
    this._stopReason = reason
  }

  setModel(model: string): void {
    const prev = this.contextState
    this.model = model
    // Model-level metadata (e.g. dynamic context window limit) is model-scoped,
    // so it must be cleared on model change. However, the usedTokens value from
    // the previous turn is still a useful *estimate* of current context size and
    // prevents the context ring from vanishing while the new turn is in-flight.
    // Downgrade to estimated confidence so the UI can distinguish stale data.
    if (prev && prev.usedTokens > 0) {
      this.contextState = {
        usedTokens: prev.usedTokens,
        limitTokens: null, // invalidate model-scoped limit
        source: prev.source,
        confidence: 'estimated',
        updatedAtMs: prev.updatedAtMs,
      }
    } else {
      this.contextState = null
    }
  }

  setCostUsd(cost: number): void {
    this.totalCostUsd = cost
  }

  /** @deprecated Use recordTurnUsage() or setFinalTokenUsage() instead. */
  addTokenUsage(input: number, output: number): void {
    this.inputTokens += input
    this.outputTokens += output
  }

  /**
   * Record per-turn token usage (incremental).
   * Called by the assistant message handler for each SDK turn.
   */
  recordTurnUsage(input: number, output: number): void {
    this.inputTokens += input
    this.outputTokens += output
  }

  /**
   * Set final aggregate token usage from the SDK result message.
   * **Overwrites** the accumulated per-turn values — single source of truth.
   * Fixes the double-counting bug where both per-turn and aggregate paths
   * called addTokenUsage().
   */
  setFinalTokenUsage(input: number, output: number): void {
    this.inputTokens = input
    this.outputTokens = output
  }

  private applyContextState(next: SessionContextState): boolean {
    const prev = this.contextState
    if (
      prev &&
      prev.usedTokens === next.usedTokens &&
      prev.limitTokens === next.limitTokens &&
      prev.source === next.source &&
      prev.confidence === next.confidence &&
      prev.updatedAtMs === next.updatedAtMs
    ) {
      return false
    }
    this.contextState = next
    this.lastActivity = Date.now()
    return true
  }

  private applyEstimatedContextPatch(patch: {
    usedTokens?: number
    limitTokens?: number | null
    source: string
    updatedAtMs?: number
  }): boolean {
    const prev = this.contextState
    const normalizedLimit = patch.limitTokens === undefined
      ? undefined
      : normalizeLimitTokens(patch.limitTokens)
    const normalizedUsed = patch.usedTokens === undefined
      ? undefined
      : normalizeUsedTokens(patch.usedTokens)
    const updatedAtMs = normalizeUpdatedAtMs(patch.updatedAtMs)

    if (prev?.confidence === 'authoritative') {
      // Never downgrade authoritative snapshots with estimated data.
      // The only allowed merge is filling an absent limit.
      if (prev.limitTokens == null && normalizedLimit != null) {
        return this.applyContextState({
          ...prev,
          limitTokens: normalizedLimit,
          updatedAtMs: Math.max(prev.updatedAtMs, updatedAtMs),
        })
      }
      return false
    }

    const next = normalizeContextState({
      usedTokens: normalizedUsed ?? prev?.usedTokens ?? 0,
      limitTokens: normalizedLimit !== undefined ? normalizedLimit : (prev?.limitTokens ?? null),
      source: patch.source,
      confidence: 'estimated',
      updatedAtMs: prev ? Math.max(prev.updatedAtMs, updatedAtMs) : updatedAtMs,
    })
    return this.applyContextState(next)
  }

  /**
   * Apply a context snapshot from engine runtime events.
   *
   * Handles both authoritative (e.g. Codex token_count) and estimated
   * (e.g. Claude assistant_usage) snapshots.
   *
   * When `limitTokens` is null the adapter doesn't know the limit —
   * the previously known limit is preserved (it arrives separately via
   * modelUsage.contextWindow in turn.result → setContextLimitFromModelUsage).
   */
  applyContextSnapshot(snapshot: {
    usedTokens: number
    limitTokens: number | null
    source: string
    confidence: 'authoritative' | 'estimated'
    updatedAtMs: number
  }): boolean {
    const normalized = normalizeContextState({
      usedTokens: snapshot.usedTokens,
      limitTokens: snapshot.limitTokens,
      source: snapshot.source,
      confidence: snapshot.confidence,
      updatedAtMs: snapshot.updatedAtMs,
    })

    if (normalized.confidence === 'estimated') {
      // For estimated snapshots with null limitTokens, pass undefined to
      // applyEstimatedContextPatch so it preserves the previously known limit.
      return this.applyEstimatedContextPatch({
        usedTokens: normalized.usedTokens,
        limitTokens: snapshot.limitTokens != null ? normalized.limitTokens : undefined,
        source: normalized.source,
        updatedAtMs: normalized.updatedAtMs,
      })
    }

    // Authoritative snapshot path — deduplication & rate limiting
    const prev = this.contextState
    if (prev?.confidence === 'authoritative') {
      if (normalized.updatedAtMs < prev.updatedAtMs) return false
      if (
        normalized.source === prev.source &&
        normalized.limitTokens === prev.limitTokens &&
        normalized.usedTokens === prev.usedTokens
      ) {
        return false
      }
      if (
        normalized.source === prev.source &&
        normalized.limitTokens === prev.limitTokens &&
        normalized.updatedAtMs - prev.updatedAtMs < CONTEXT_SNAPSHOT_MIN_INTERVAL_MS &&
        Math.abs(normalized.usedTokens - prev.usedTokens) < CONTEXT_SNAPSHOT_MIN_USED_DELTA
      ) {
        return false
      }
    }

    return this.applyContextState(normalized)
  }

  /**
   * Set the context window limit from provider-reported model metadata.
   * Called from turn.result with modelUsage.contextWindow.
   * Pass null to clear and fall back to static model limits.
   */
  setContextLimitFromModelUsage(limit: number | null): boolean {
    return this.applyEstimatedContextPatch({
      limitTokens: limit,
      source: 'turn.result.model_usage',
    })
  }

  /**
   * Clear context state after events that invalidate it (e.g. compact).
   * The next context.snapshot from an assistant message will restore tracking.
   */
  clearContextState(): void {
    if (!this.contextState) return
    this.contextState = null
    this.lastActivity = Date.now()
  }

  /**
   * Fast O(1) accessor for the current context window usage in tokens.
   * Returns 0 when no context tracking data is available yet.
   * Used by the effect projector to decide whether a turn.result fallback
   * should supply estimated context usage.
   */
  getContextUsedTokens(): number {
    return this.contextState?.usedTokens ?? 0
  }

  setActivity(activity: string | null): void {
    this.activity = activity
  }

  // ---------------------------------------------------------------------------
  // Centralized state machine
  // ---------------------------------------------------------------------------

  /**
   * Centralized lifecycle state transition.
   *
   * All session state mutations (setState/setError/clearError/setStopReason)
   * flow through this method. The private setters are no longer accessible
   * from outside ManagedSession, making illegal transitions impossible.
   */
  transition(event: SessionLifecycleEvent): void {
    const fromState = this.state
    log.debug('transition', { sessionId: this.sessionId, event: event.type, fromState })
    switch (event.type) {
      case 'engine_initialized':
      case 'recover_from_awaiting_input':
        this.setState('streaming')
        break

      case 'turn_completed':
        this.setActivity(null)
        this.setStopReason(event.stopReason)
        this.setState('idle')
        break

      case 'turn_error':
        this.setActivity(null)
        this.setError(event.message)
        break

      case 'stream_ended_clean':
      case 'lifecycle_exited_silently':
      case 'spawn_error_transient':
        this.setStopReason('completed')
        this.setState('idle')
        this.setActivity(null)
        break

      case 'user_stopped':
      case 'shutdown':
        this.setStopReason('user_stopped')
        this.setState('stopped')
        break

      case 'resume_session':
        this.clearError()
        this.setState('creating')
        this.setStopReason(null)
        break

      case 'push_to_active':
        this.clearError()
        this.setState('streaming')
        this.setStopReason(null)
        break

      case 'awaiting_input':
        this.setActivity(null)
        this.setState('awaiting_input')
        break

      case 'question_asked':
        this.setActivity(null)
        this.setState('awaiting_question')
        break

      case 'question_answered':
        this.setState('streaming')
        break

      case 'spawn_error_permanent':
      case 'process_corrupted':
        this.setError(event.message)
        break

      case 'protocol_violation':
        this.setStopReason('execution_error')
        this.setError(event.message)
        break

      default: {
        const _exhaustive: never = event
        throw new Error(`Unhandled transition event: ${(event as { type: string }).type}`)
      }
    }
  }

  addMessage(role: 'user' | 'assistant', blocks: ContentBlock[], isStreaming = false): string {
    const id = nanoid(8)
    const timestamp = Date.now()

    if (role === 'assistant') {
      this.messages.push({ id, role, content: blocks, timestamp, isStreaming })
    } else {
      this.messages.push({ id, role, content: blocks, timestamp })
    }

    log.debug('addMessage', { sessionId: this.sessionId, messageId: id, role, blockCount: blocks.length })
    this.lastActivity = timestamp
    return id
  }

  updateMessageBlocks(messageId: string, blocks: ContentBlock[], isStreaming: boolean): void {
    const msg = this.messages.find((m) => m.id === messageId)
    if (msg && msg.role === 'assistant') {
      msg.content = blocks
      msg.isStreaming = isStreaming
      this.lastActivity = Date.now()
    }
  }

  /**
   * Finalize a streaming message — set isStreaming to false without changing content.
   * Used when the SDK stream ends (result message) before a complete assistant message
   * was received (e.g. max_turns mid-stream), preventing phantom streaming cursors.
   */
  finalizeStreamingMessage(messageId: string): void {
    const msg = this.messages.find((m) => m.id === messageId)
    if (msg && msg.role === 'assistant' && msg.isStreaming) {
      msg.isStreaming = false
      msg.activeToolUseId = undefined
      this.lastActivity = Date.now()
    }
  }

  setActiveToolUseId(messageId: string, toolUseId: string | null): void {
    const msg = this.messages.find((m) => m.id === messageId)
    if (msg && msg.role === 'assistant') {
      msg.activeToolUseId = toolUseId
      this.lastActivity = Date.now()
    }
  }

  appendToolProgress(messageId: string, toolUseId: string, content: string): void {
    const msg = this.messages.find((m) => m.id === messageId)
    if (!msg || msg.role === 'system') return
    const block = msg.content.find(
      (b): b is ToolUseBlock => b.type === 'tool_use' && b.id === toolUseId
    )
    if (block) {
      block.progress = (block.progress ?? '') + content
      this.lastActivity = Date.now()
    }
  }

  /**
   * Handle a typed Evose relay event — produces a new `progressBlocks` array
   * and replaces the ToolUseBlock in the content array with a new reference.
   *
   * **Immutability contract:** Every call produces a fresh `progressBlocks`
   * array AND a fresh block reference in `msg.content`.  This is required
   * because the downstream rendering pipeline (React memo, stableContent
   * useMemo, ContentBlockRenderer) relies on reference equality to detect
   * changes.  In-place mutation would be invisible to these mechanisms.
   *
   * Event → block mapping:
   *   text               → merge with last EvoseTextBlock or append new one
   *   tool_call_started  → append new EvoseToolCallBlock with status 'running'
   *   tool_call_completed→ replace matching block with updated status/result
   */
  handleEvoseRelayEvent(messageId: string, toolUseId: string, event: EvoseRelayEvent): void {
    const msg = this.messages.find((m) => m.id === messageId)
    if (!msg || msg.role === 'system') return
    const blockIdx = msg.content.findIndex(
      (b): b is ToolUseBlock => b.type === 'tool_use' && b.id === toolUseId,
    )
    if (blockIdx === -1) return
    const block = msg.content[blockIdx] as ToolUseBlock

    const prev = block.progressBlocks ?? []
    const next = this.applyEvoseEvent(prev, event)

    // Replace both progressBlocks AND the block reference — making the
    // change visible to every layer of the rendering pipeline:
    //   - commandStore: detects updated message via SLOW PATH (isStreaming=false)
    //   - stableContent: detects new block reference (block !== prevBlock)
    //   - ContentBlockRenderer memo: detects new block prop reference
    msg.content[blockIdx] = { ...block, progressBlocks: next }

    this.lastActivity = Date.now()
  }

  /**
   * Pure function: apply a single EvoseRelayEvent to a progressBlocks array.
   * Returns a NEW array — the input is never mutated.
   */
  private applyEvoseEvent(
    blocks: EvoseProgressBlock[],
    event: EvoseRelayEvent,
  ): EvoseProgressBlock[] {
    switch (event.type) {
      case 'text': {
        const last = blocks[blocks.length - 1]
        if (last && last.type === 'text') {
          // Merge consecutive text: clone array, replace last element
          const next = blocks.slice()
          next[next.length - 1] = { ...last, text: last.text + event.text }
          return next
        }
        return [...blocks, { type: 'text', text: event.text }]
      }

      case 'tool_call_started':
        return [...blocks, {
          type: 'tool_call' as const,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          title: event.title,
          status: 'running' as const,
          iconUrl: event.iconUrl,
          kwargs: event.kwargs,
        }]

      case 'tool_call_completed': {
        const idx = blocks.findIndex(
          (b): b is EvoseToolCallBlock =>
            b.type === 'tool_call' && b.toolCallId === event.toolCallId,
        )
        if (idx !== -1) {
          // Replace matched block with updated status/result
          const matched = blocks[idx] as EvoseToolCallBlock
          const next = blocks.slice()
          next[idx] = {
            ...matched,
            status: event.isError ? 'error' as const : 'completed' as const,
            result: event.result,
          }
          return next
        }
        // No matching started event (edge case) — create completed block directly
        return [...blocks, {
          type: 'tool_call' as const,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          title: event.title,
          status: (event.isError ? 'error' : 'completed') as 'error' | 'completed',
          result: event.result,
        }]
      }

      default:
        return blocks
    }
  }

  addSystemEvent(event: SystemEvent): string {
    const id = nanoid(8)
    this.messages.push({ id, role: 'system' as const, event, timestamp: Date.now() })

    const refId = this.extractEventRefId(event)
    if (refId) this.systemEventIndex.set(refId, id)

    this.lastActivity = Date.now()
    return id
  }

  /** Resolve a system event refId to its message ID. Returns undefined if not found. */
  getSystemEventMessageId(refId: string): string | undefined {
    return this.systemEventIndex.get(refId)
  }

  updateSystemEvent(refId: string, updater: (event: SystemEvent) => void): void {
    const msgId = this.systemEventIndex.get(refId)
    if (!msgId) return
    const msg = this.messages.find((m) => m.id === msgId)
    if (msg && msg.role === 'system') {
      updater(msg.event)
      this.lastActivity = Date.now()
    }
  }

  /** Update a system event by its message ID (useful for events without a refId, e.g. compact_boundary). */
  updateSystemEventById(messageId: string, updater: (event: SystemEvent) => void): void {
    const msg = this.messages.find((m) => m.id === messageId)
    if (msg && msg.role === 'system') {
      updater(msg.event)
      this.lastActivity = Date.now()
    }
  }

  private extractEventRefId(event: SystemEvent): string | null {
    switch (event.type) {
      case 'task_started': return `task:${event.taskId}`
      case 'task_notification': return `task-notif:${event.taskId}`
      case 'hook': return `hook:${event.hookId}`
      default: return null
    }
  }

  /**
   * Get a shallow copy of the last message. O(1).
   * Avoids the full O(n) messages copy of getInfo() in hot dispatch paths.
   */
  getLastMessage(): ManagedSessionMessage | null {
    const last = this.messages[this.messages.length - 1]
    return last ? { ...last } : null
  }

  /**
   * Get a shallow copy of a specific message by ID.
   * Used by relay onFlush/onDone callbacks that need a single message,
   * avoiding the O(n) full-copy of getInfo().
   */
  getMessageById(id: string): ManagedSessionMessage | null {
    const msg = this.messages.find((m) => m.id === id)
    return msg ? { ...msg } : null
  }

  /**
   * Initialize the execution context. Called once after SDK init completes
   * and the session's actual working environment is resolved.
   */
  initExecutionContext(ctx: SessionExecutionContext): void {
    this.executionContext = ctx
    this.lastActivity = Date.now()
  }

  /**
   * Update the execution context when cwd changes (e.g. EnterWorktree).
   * Returns true if the context actually changed, so the caller can
   * broadcast an update event only when needed.
   */
  updateExecutionContext(ctx: SessionExecutionContext): boolean {
    if (
      this.executionContext?.cwd === ctx.cwd &&
      this.executionContext?.gitBranch === ctx.gitBranch &&
      this.executionContext?.isDetached === ctx.isDetached &&
      this.executionContext?.isWorktree === ctx.isWorktree
    ) {
      return false
    }
    this.executionContext = ctx
    this.lastActivity = Date.now()
    return true
  }

  /**
   * O(1) lightweight metadata snapshot — no messages deep copy.
   *
   * Use this for DataBus dispatch, IPC queries, and any hot path
   * that only needs session metadata.
   */
  snapshot(): SessionSnapshot {
    const contextState = this.contextState ? { ...this.contextState } : null
    const contextTelemetry = toContextTelemetry(this.contextState)
    return {
      id: this.sessionId,
      engineKind: this.engineKind,
      engineSessionRef: this.engineSessionRef,
      engineState: this.engineState ? { ...this.engineState } : null,
      state: this.state,
      stopReason: this._stopReason,
      origin: this.config.origin,
      projectPath: this.config.projectPath ?? null,
      projectId: this.config.projectId ?? null,
      model: this.model,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      activeDurationMs: this.activeDurationMs,
      activeStartedAt: this.activeStartedAt,
      totalCostUsd: this.totalCostUsd,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      lastInputTokens: contextState?.usedTokens ?? 0,
      contextLimitOverride: contextState?.limitTokens ?? null,
      contextState,
      contextTelemetry,
      activity: this.activity,
      error: this.error,
      executionContext: this.executionContext ? { ...this.executionContext } : null,
    }
  }

  /**
   * O(n) full record including deep-copied messages — for persistence only.
   *
   * Use `snapshot()` instead for hot paths that don't need messages.
   */
  toPersistenceRecord(): ManagedSessionInfo {
    return {
      ...this.snapshot(),
      messages: this.messages.map((m) => ({ ...m })),
    }
  }

  /**
   * @deprecated Use `snapshot()` for metadata or `toPersistenceRecord()` for persistence.
   */
  getInfo(): ManagedSessionInfo {
    return this.toPersistenceRecord()
  }

  /** O(1) accessor for the engine session/thread reference. */
  getEngineRef(): string | null {
    return this.engineSessionRef
  }

  /**
   * O(1) read-only reference to the internal messages array.
   *
   * ⚠️ The returned array is **not** a copy — callers must NOT mutate it.
   * Use this only for iteration/read in hot paths (e.g. effect projector).
   * For a safe copy, use `toPersistenceRecord().messages`.
   */
  getMessages(): readonly ManagedSessionMessage[] {
    return this.messages
  }

  getConfig(): ManagedSessionRuntimeConfig {
    return { ...this.config }
  }

  /**
   * Reconstruct a ManagedSession from persisted ManagedSessionInfo.
   * Used when resuming a session that was persisted to disk.
   */
  static fromInfo(info: ManagedSessionInfo): ManagedSession {
    const session = new ManagedSession({
      prompt: '',
      origin: info.origin,
      engineKind: info.engineKind,
      engineState: info.engineState,
      projectPath: info.projectPath ?? undefined,
      projectId: info.projectId ?? undefined,
      model: info.model ?? undefined,
    })
    // Override auto-generated id with the persisted one
    session.sessionId = info.id
    if (info.engineSessionRef) {
      session.engineSessionRef = info.engineSessionRef
    }
    session.state = info.state
    session._stopReason = info.stopReason ?? null
    session.model = info.model
    session.messages = info.messages.map((m) => ({ ...m }))
    session.createdAt = info.createdAt
    session.lastActivity = info.lastActivity
    session.activeDurationMs = info.activeDurationMs
    session.activeStartedAt = info.activeStartedAt
    session.totalCostUsd = info.totalCostUsd
    session.inputTokens = info.inputTokens
    session.outputTokens = info.outputTokens
    if (info.contextState) {
      session.contextState = normalizeContextState({
        usedTokens: info.contextState.usedTokens,
        limitTokens: info.contextState.limitTokens ?? null,
        source: info.contextState.source,
        confidence: info.contextState.confidence,
        updatedAtMs: info.contextState.updatedAtMs,
      })
    } else if (info.contextTelemetry) {
      session.contextState = normalizeContextState({
        usedTokens: info.contextTelemetry.usedTokens,
        limitTokens: info.contextTelemetry.limitTokens,
        source: info.contextTelemetry.source,
        confidence: info.contextTelemetry.confidence,
        updatedAtMs: info.contextTelemetry.updatedAtMs,
      })
    } else {
      const legacyUsed = normalizeUsedTokens(info.lastInputTokens ?? 0)
      const legacyLimit = normalizeLimitTokens(info.contextLimitOverride ?? null)
      if (legacyUsed > 0 || legacyLimit != null) {
        session.contextState = normalizeContextState({
          usedTokens: legacyUsed,
          limitTokens: legacyLimit,
          source: 'legacy.session_info',
          confidence: 'estimated',
          updatedAtMs: info.lastActivity,
        })
      } else {
        session.contextState = null
      }
    }
    session.activity = info.activity
    session.error = info.error
    if (info.executionContext) {
      session.executionContext = { ...info.executionContext }
    }
    return session
  }
}
