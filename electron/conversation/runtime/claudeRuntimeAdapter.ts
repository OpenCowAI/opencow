// SPDX-License-Identifier: Apache-2.0

import type { SDKMessage } from '@opencow-ai/opencow-agent-sdk'
import { normalizeContentBlocks, ensureThinkingBlocksFirst, type SDKContentBlock } from '../../command/contentBlocks'
import type { EngineRuntimeEvent, RuntimeModelUsage, RuntimeResultOutcome, RuntimeTurnUsage } from './events'
import { toConversationContentBlocks } from './contentBlockMapper'
import type { ConversationContentBlock } from '../domain/content'
import { createLogger } from '../../platform/logger'

const log = createLogger('ClaudeRuntimeAdapter')

// ── Helpers ─────────────────────────────────────────────────────────────────

interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  inputTokens?: number
  outputTokens?: number
}

interface RawModelUsage extends RawUsage {
  context_window?: number
  contextWindow?: number
  max_output_tokens?: number
  maxOutputTokens?: number
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function protocolViolation(params: {
  reason: string
  rawType: string
  rawSubtype: string | null
}): EngineRuntimeEvent {
  return {
    kind: 'protocol.violation',
    payload: {
      reason: params.reason,
      rawType: params.rawType,
      rawSubtype: params.rawSubtype,
    },
  }
}

function asTaskStatus(value: unknown): 'completed' | 'failed' | 'stopped' | null {
  return value === 'completed' || value === 'failed' || value === 'stopped' ? value : null
}

function asHookOutcome(value: unknown): 'success' | 'error' | 'cancelled' | null {
  return value === 'success' || value === 'error' || value === 'cancelled' ? value : null
}

function toTurnUsage(usage: RawUsage | undefined): RuntimeTurnUsage | undefined {
  if (!usage) return undefined
  return {
    inputTokens: usage.input_tokens ?? usage.inputTokens ?? 0,
    outputTokens: usage.output_tokens ?? usage.outputTokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  }
}

function mapResultOutcome(subtype: string | null): RuntimeResultOutcome | null {
  switch (subtype) {
    case 'success':
      return 'success'
    case 'error_max_turns':
      return 'max_turns'
    case 'error_during_execution':
      return 'execution_error'
    case 'error_max_budget_usd':
      return 'budget_exceeded'
    case 'error_max_structured_output_retries':
      return 'structured_output_error'
    default:
      return null
  }
}

/**
 * Normalize SDK content blocks and compensate for a known Claude SDK quirk:
 * when extended thinking is enabled, streaming partial events may place
 * thinking blocks AFTER text blocks. We enforce thinking-first ordering
 * here at the adapter boundary so the rest of the pipeline receives
 * correctly ordered blocks.
 */
function normalizeAndOrderBlocks(sdkContent: SDKContentBlock[]): ConversationContentBlock[] {
  const normalized = normalizeContentBlocks(sdkContent)
  const ordered = ensureThinkingBlocksFirst(normalized)
  return toConversationContentBlocks(ordered)
}

function extractModelUsage(raw: Record<string, unknown>): Record<string, RuntimeModelUsage> | undefined {
  const usageObject =
    (raw.model_usage as Record<string, RawModelUsage> | undefined) ??
    (raw.modelUsage as Record<string, RawModelUsage> | undefined)
  if (!usageObject) return undefined

  const entries = Object.entries(usageObject)
  if (entries.length === 0) return undefined

  const mapped: Record<string, RuntimeModelUsage> = {}
  for (const [model, usage] of entries) {
    const contextWindow =
      typeof usage.contextWindow === 'number'
        ? usage.contextWindow
        : (typeof usage.context_window === 'number' ? usage.context_window : undefined)
    const maxOutputTokens =
      typeof usage.maxOutputTokens === 'number'
        ? usage.maxOutputTokens
        : (typeof usage.max_output_tokens === 'number' ? usage.max_output_tokens : undefined)

    mapped[model] = {
      inputTokens: usage.input_tokens ?? usage.inputTokens ?? 0,
      outputTokens: usage.output_tokens ?? usage.outputTokens ?? 0,
      contextWindow,
      maxOutputTokens,
    }
  }
  return mapped
}

// ── Block parsers ───────────────────────────────────────────────────────────

function parseAssistantBlocks(raw: Record<string, unknown>): EngineRuntimeEvent[] {
  const messageObj = raw.message as { content?: SDKContentBlock[]; usage?: RawUsage } | undefined
  const events: EngineRuntimeEvent[] = [{
    kind: 'assistant.final',
    payload: {
      blocks: normalizeAndOrderBlocks(messageObj?.content ?? []),
    },
  }]
  // Check both raw.message.usage and raw.usage for SDK compatibility.
  // Some SDK versions may surface usage at the top-level instead of nested
  // under the message object.
  const usage = toTurnUsage(
    messageObj?.usage ?? (raw.usage as RawUsage | undefined)
  )
  if (usage) {
    // Token accounting path (unchanged — feeds recordTurnUsage)
    events.push({
      kind: 'turn.usage',
      payload: usage,
    })

    // Context window tracking path:
    // BetaMessage.usage represents a single API call. For Claude Code, each call
    // sends the full conversation history, so the sum of all input token categories
    // equals the current context window occupancy.
    const contextWindowUsed = usage.inputTokens
      + usage.cacheReadInputTokens
      + usage.cacheCreationInputTokens
    if (contextWindowUsed > 0) {
      events.push({
        kind: 'context.snapshot',
        payload: {
          metricKind: 'context_occupancy',
          usedTokens: contextWindowUsed,
          limitTokens: null,       // unknown at adapter level; arrives via modelUsage.contextWindow in turn.result
          remainingTokens: null,
          remainingPct: null,
          source: 'claude.assistant_usage',
          confidence: 'estimated',
        },
      })
    }
  }
  return events
}

function parsePartialBlocks(raw: Record<string, unknown>): EngineRuntimeEvent {
  const messageObj = raw.message as { content?: SDKContentBlock[] } | undefined
  return {
    kind: 'assistant.partial',
    payload: { blocks: normalizeAndOrderBlocks(messageObj?.content ?? []) },
  }
}

// ── Main adapter ────────────────────────────────────────────────────────────

/**
 * Set of SDK event signatures (`type` or `type:subtype`) that are known
 * informational events. These are logged at debug level and silently dropped —
 * the conversation pipeline does not need to act on them.
 *
 * Adding entries here is the correct way to handle new SDK events that
 * carry no actionable data for OpenCow. This avoids protocol violation
 * noise when the SDK evolves.
 */
const KNOWN_INFORMATIONAL_EVENTS = new Set([
  // File persistence notifications (SDK v0.2.50+)
  'system:files_persisted',
  // Task progress updates (todo list tracking)
  'system:task_progress',
  // Session state transitions (idle/running/requires_action)
  'system:session_state_changed',
  // MCP elicitation completion
  'system:elicitation_complete',
  // Local command output (/voice, /cost etc.)
  'system:local_command_output',
  // Prompt suggestions (predicted next user input)
  'prompt_suggestion',
  // Authentication status updates
  'auth_status',
  // Tool use summaries
  'tool_use_summary',
  // User message echoes
  'user',
])

export function adaptClaudeSdkMessage(message: SDKMessage): EngineRuntimeEvent[] {
  const raw = message as Record<string, unknown>
  const type = typeof raw.type === 'string' ? raw.type : ''
  const subtype = typeof raw.subtype === 'string' ? raw.subtype : null
  const eventSignature = subtype ? `${type}:${subtype}` : type

  // ── Actionable events (mapped to EngineRuntimeEvent) ──────────────────

  if (type === 'system' && subtype === 'init') {
    return [{
      kind: 'session.initialized',
      payload: {
        sessionRef: typeof raw.session_id === 'string' ? raw.session_id : undefined,
        model: typeof raw.model === 'string' ? raw.model : undefined,
      },
    }]
  }

  if ((type === 'assistant' && subtype === 'partial') || type === 'stream_event') {
    return [parsePartialBlocks(raw)]
  }

  if ((type === 'assistant' && subtype === 'tool_progress') || type === 'tool_progress') {
    const toolUseId = typeof raw.tool_use_id === 'string' ? raw.tool_use_id : ''
    const chunk = typeof raw.content === 'string' ? raw.content : ''
    if (toolUseId.length > 0 && chunk.length > 0) {
      return [{
        kind: 'tool.progress',
        payload: { toolUseId, chunk },
      }]
    }
    return [protocolViolation({
      reason: 'Malformed tool progress event',
      rawType: type,
      rawSubtype: subtype,
    })]
  }

  if (type === 'assistant' && subtype == null) {
    return parseAssistantBlocks(raw)
  }

  if (type === 'result') {
    const outcome = mapResultOutcome(subtype)
    if (!outcome) {
      return [protocolViolation({
        reason: `Unknown result subtype: ${subtype ?? 'null'}`,
        rawType: type,
        rawSubtype: subtype,
      })]
    }

    if (raw.errors != null && (!Array.isArray(raw.errors) || !raw.errors.every((item) => typeof item === 'string'))) {
      return [protocolViolation({
        reason: 'Malformed result.errors field',
        rawType: type,
        rawSubtype: subtype,
      })]
    }

    return [{
      kind: 'turn.result',
      payload: {
        outcome,
        errors: Array.isArray(raw.errors) ? raw.errors : undefined,
        result: typeof raw.result === 'string' ? raw.result : undefined,
        modelUsage: extractModelUsage(raw),
        costUsd: typeof raw.total_cost_usd === 'number' ? raw.total_cost_usd : undefined,
      },
    }]
  }

  if (type === 'system' && subtype === 'compact_boundary') {
    const compactMetadata = raw.compact_metadata as {
      trigger?: 'manual' | 'auto'
      pre_tokens?: number
    } | undefined

    return [{
      kind: 'system.compact_boundary',
      payload: {
        trigger: compactMetadata?.trigger ?? 'auto',
        preTokens: compactMetadata?.pre_tokens ?? 0,
      },
    }]
  }

  if (type === 'system' && subtype === 'task_started') {
    const taskId = asNonEmptyString(raw.task_id)
    const description = asNonEmptyString(raw.description)
    if (!taskId || !description) {
      return [protocolViolation({
        reason: 'Malformed task_started payload',
        rawType: type,
        rawSubtype: subtype,
      })]
    }

    return [{
      kind: 'system.task_started',
      payload: {
        taskId,
        toolUseId: asOptionalString(raw.tool_use_id),
        description,
        taskType: asOptionalString(raw.task_type),
      },
    }]
  }

  if (type === 'system' && subtype === 'task_notification') {
    const taskId = asNonEmptyString(raw.task_id)
    const status = asTaskStatus(raw.status)
    const summary = asNonEmptyString(raw.summary)
    if (!taskId || !status || !summary) {
      return [protocolViolation({
        reason: 'Malformed task_notification payload',
        rawType: type,
        rawSubtype: subtype,
      })]
    }

    const usage = raw.usage as { total_tokens: number; tool_uses: number; duration_ms: number } | undefined
    if (usage && (
      typeof usage.total_tokens !== 'number' ||
      typeof usage.tool_uses !== 'number' ||
      typeof usage.duration_ms !== 'number'
    )) {
      return [protocolViolation({
        reason: 'Malformed task_notification usage payload',
        rawType: type,
        rawSubtype: subtype,
      })]
    }

    return [{
      kind: 'system.task_notification',
      payload: {
        taskId,
        toolUseId: asOptionalString(raw.tool_use_id),
        status,
        summary,
        outputFile: asOptionalString(raw.output_file),
        usage: usage
          ? {
              totalTokens: usage.total_tokens,
              toolUses: usage.tool_uses,
              durationMs: usage.duration_ms,
            }
          : undefined,
      },
    }]
  }

  if (type === 'system' && subtype === 'hook_started') {
    const hookId = asNonEmptyString(raw.hook_id)
    const hookName = asNonEmptyString(raw.hook_name)
    const hookTrigger = asNonEmptyString(raw.hook_event)
    if (!hookId || !hookName || !hookTrigger) {
      return [protocolViolation({
        reason: 'Malformed hook_started payload',
        rawType: type,
        rawSubtype: subtype,
      })]
    }

    return [{
      kind: 'system.hook_started',
      payload: {
        hookId,
        hookName,
        hookTrigger,
      },
    }]
  }

  if (type === 'system' && subtype === 'hook_progress') {
    const hookId = asNonEmptyString(raw.hook_id)
    const output = typeof raw.output === 'string'
      ? raw.output
      : `${String(raw.stdout ?? '')}${String(raw.stderr ?? '')}`
    if (!hookId || output.length === 0) {
      return [protocolViolation({
        reason: 'Malformed hook_progress payload',
        rawType: type,
        rawSubtype: subtype,
      })]
    }

    return [{
      kind: 'system.hook_progress',
      payload: {
        hookId,
        output,
      },
    }]
  }

  if (type === 'system' && subtype === 'hook_response') {
    const hookId = asNonEmptyString(raw.hook_id)
    const outcome = asHookOutcome(raw.outcome)
    const output = typeof raw.output === 'string'
      ? raw.output
      : `${String(raw.stdout ?? '')}${String(raw.stderr ?? '')}`
    if (!hookId || !outcome || output.length === 0) {
      return [protocolViolation({
        reason: 'Malformed hook_response payload',
        rawType: type,
        rawSubtype: subtype,
      })]
    }

    return [{
      kind: 'system.hook_response',
      payload: {
        hookId,
        outcome,
        exitCode: typeof raw.exit_code === 'number' ? raw.exit_code : undefined,
        output,
      },
    }]
  }

  // ── Diagnostic events (mapped to engine.diagnostic) ───────────────────

  if (type === 'system' && subtype === 'status') {
    const status = raw.status as string | null
    if (status === 'compacting') {
      return [{
        kind: 'engine.diagnostic',
        payload: {
          code: 'claude.status.compacting',
          severity: 'info' as const,
          message: 'Context compaction in progress',
          terminal: false,
          source: 'claude-sdk',
        },
      }]
    }
    // status === null or other values: session returned to normal
    return []
  }

  if (type === 'system' && subtype === 'api_retry') {
    const attempt = typeof raw.attempt === 'number' ? raw.attempt : 0
    const maxRetries = typeof raw.max_retries === 'number' ? raw.max_retries : undefined
    // SDK v0.2.83+ emits retry_delay_ms; keep legacy `delay` fallback for
    // forward/backward compatibility with older bridge payload variants.
    const delay = typeof raw.retry_delay_ms === 'number'
      ? raw.retry_delay_ms
      : (typeof raw.delay === 'number' ? raw.delay : 0)
    const errorStatus = typeof raw.error_status === 'number' ? raw.error_status : undefined
    const errorType = typeof raw.error === 'string' ? raw.error : undefined
    const attemptLabel = maxRetries ? `${attempt}/${maxRetries}` : `${attempt}`
    log.info(`API retry: attempt ${attemptLabel}, delay ${delay}ms`, { errorStatus, errorType })
    return [{
      kind: 'engine.diagnostic',
      payload: {
        code: 'claude.api_retry',
        severity: 'warning' as const,
        message:
          `API retry attempt ${attemptLabel}` +
          `${errorStatus ? ` (HTTP ${errorStatus})` : ''}` +
          `${errorType ? ` [${errorType}]` : ''}` +
          `, retrying in ${delay}ms`,
        terminal: false,
        source: 'claude-sdk',
      },
    }]
  }

  if (type === 'rate_limit_event') {
    const rateLimitInfo = raw.rate_limit_info as {
      status?: unknown
      rateLimitType?: unknown
      resetsAt?: unknown
    } | undefined
    const status = typeof rateLimitInfo?.status === 'string'
      ? rateLimitInfo.status
      : (typeof raw.status === 'string' ? raw.status : 'unknown')
    const rateLimitType = typeof rateLimitInfo?.rateLimitType === 'string' ? rateLimitInfo.rateLimitType : undefined
    const resetsAt = typeof rateLimitInfo?.resetsAt === 'number' ? rateLimitInfo.resetsAt : undefined
    log.info(`Rate limit event: ${status}`, { rateLimitType, resetsAt })
    const detailParts = [rateLimitType, resetsAt ? `resetsAt=${new Date(resetsAt).toISOString()}` : undefined]
      .filter((part): part is string => typeof part === 'string')
    const detail = detailParts.length > 0 ? ` (${detailParts.join(', ')})` : ''
    return [{
      kind: 'engine.diagnostic',
      payload: {
        code: 'claude.rate_limit',
        severity: 'warning' as const,
        message: `Rate limit: ${status}${detail}`,
        terminal: false,
        source: 'claude-sdk',
      },
    }]
  }

  // ── Known informational events (no-op, debug logged) ──────────────────

  if (KNOWN_INFORMATIONAL_EVENTS.has(eventSignature) || KNOWN_INFORMATIONAL_EVENTS.has(type)) {
    log.debug(`SDK event (informational, no-op): ${eventSignature}`)
    return []
  }

  // ── Unknown events ────────────────────────────────────────────────────
  // Forward-compatible: new SDK events that we haven't explicitly handled
  // are logged at info level for diagnostics, NOT treated as protocol
  // violations. Protocol violations are reserved for genuinely malformed
  // messages (missing type, broken payloads).
  log.info(`Unhandled SDK event type: ${eventSignature} — ignoring (SDK may be newer than adapter)`)
  return []
}
