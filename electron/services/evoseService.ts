// SPDX-License-Identifier: Apache-2.0

/**
 * EvoseService — API integration for Evose Agents & Workflows.
 *
 * Architecture:
 * - `fetchEvoseApps()` — stateless function that fetches all apps via paginated
 *   requests (used by IPC handler).  The caller provides a `fetch` function
 *   so proxy support is handled transparently via dependency injection.
 * - `EvoseService` class — tool execution at Claude call time.
 *   Reads config from SettingsService on every call (single source of truth).
 *   Receives a lazy `getProxyFetch` getter in its constructor deps, following
 *   the same DI pattern as WebhookService / TelegramBotManager — no hidden
 *   module-level state, no `configure*()` ceremony that can be forgotten.
 *
 * Network layer:
 * - All outbound requests use an explicitly injected fetch function.
 *   No module-level `_fetcher` state — dependencies are visible in the type
 *   signature, enforced by the compiler, and impossible to forget.
 * - Non-streaming requests (fetchEvoseApps) use `fetchWithTimeout()` for
 *   bounded execution.  SSE streams (runAgent / runWorkflow) call fetch
 *   directly — they are inherently long-running.
 *
 * Note: DEFAULT_EVOSE_SETTINGS is defined in src/shared/types.ts (co-located
 * with the interface) to avoid any circular import between this file and
 * settingsService.ts.
 */

import type { SettingsService } from './settingsService'
import { DEFAULT_EVOSE_SETTINGS, type EvoseApp } from '../../src/shared/types'
import { EvoseApiError, EvoseAgentCancelledError } from '../../src/shared/errors'
import { parseSseStream } from '../utils/sseStream'
import { createLogger } from '../platform/logger'

const log = createLogger('EvoseService')

// ─── Network Utilities ───────────────────────────────────────────────────────

/** Default network timeout for non-streaming Evose requests (ms). */
const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Fetch with an AbortSignal-based timeout.
 * Used for non-streaming requests (app list pagination) where unbounded
 * waits would freeze the Settings UI.
 */
async function fetchWithTimeout(
  fetcher: typeof globalThis.fetch,
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetcher(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function resolveEvoseBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  return trimmed || DEFAULT_EVOSE_SETTINGS.baseUrl
}

/**
 * Wrap network-level errors (DNS, timeout, connection refused, proxy failure)
 * into human-readable EvoseApiError so the UI shows actionable messages
 * instead of the opaque "fetch failed" from undici.
 *
 * IMPORTANT — undici error structure:
 *   undici's fetch() throws `TypeError("fetch failed")` for ALL network errors.
 *   The actual system error (ENOTFOUND, ECONNREFUSED, etc.) is buried in
 *   `err.cause` — NOT in the outer message.  We must inspect the cause chain
 *   to provide meaningful error classification.
 *
 *   TypeError: "fetch failed"           ← outer message is always generic
 *     cause: Error                      ← real error lives here
 *       code: "ENOTFOUND"              ← system error code (most reliable)
 *       message: "getaddrinfo ENOTFOUND api.example.com"
 */
function wrapNetworkError(err: unknown, context: string): EvoseApiError {
  if (err instanceof EvoseApiError) return err

  const message = err instanceof Error ? err.message : String(err)

  // Dig into undici's error cause chain for the real system error
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null
  const causeCode = (cause as NodeJS.ErrnoException | null)?.code ?? ''
  const causeMessage = cause?.message ?? ''

  // AbortError from our timeout controller
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new EvoseApiError(0, `Evose API request timed out (${context})`)
  }

  // ── Classify by system error code (from err.cause) — most reliable ─────

  if (causeCode === 'ENOTFOUND' || causeMessage.includes('getaddrinfo')) {
    return new EvoseApiError(
      0,
      `DNS resolution failed for Evose API (${context}). Please check the Base URL.`,
    )
  }
  if (causeCode === 'ECONNREFUSED') {
    return new EvoseApiError(
      0,
      `Connection refused (${context}). The Evose API server is not reachable.`,
    )
  }
  if (causeCode === 'ETIMEDOUT' || causeCode === 'ENETUNREACH' || causeCode === 'EHOSTUNREACH') {
    return new EvoseApiError(
      0,
      `Network unreachable (${context}). Please check your internet connection.`,
    )
  }
  if (causeCode === 'ECONNRESET' || causeCode === 'EPIPE') {
    return new EvoseApiError(
      0,
      `Connection reset (${context}). The server or proxy closed the connection unexpectedly.`,
    )
  }
  if (causeCode.startsWith('ERR_TLS') || causeMessage.includes('certificate')) {
    return new EvoseApiError(
      0,
      `TLS certificate error (${context}). Please check the Base URL or proxy configuration.`,
    )
  }

  // ── Generic "fetch failed" — include cause detail if available ─────────

  if (message.includes('fetch failed')) {
    const detail = causeMessage ? `: ${causeMessage}` : ''
    return new EvoseApiError(
      0,
      `Network connection failed (${context})${detail}. Please check your network and proxy settings.`,
    )
  }

  return new EvoseApiError(0, `${context}: ${message}`)
}

// ─── Agent SSE Raw Event Types ────────────────────────────────────────────────
//
// Derived from actual API responses (verified via evose-sse-*.log debug), differences from Evose official docs:
//   - tool_call_output event does not actually exist; tool output is in tool_call_completed.tool.tool_call_result
//   - tool_call_started / tool_call_completed data is in the `tool` field, not `content`
//   - All events carry a `thinking` field (currently always an empty string)

/** Tool call information for tool_call_started / tool_call_completed */
interface EvoseSseToolCall {
  tool_call_id:     string
  tool_name:        string
  tool_args: {
    kwargs?:     Record<string, unknown>
    /** Human-readable tool call title, e.g. "Search trending AI Agent topics" — used directly for UI display */
    title?:      string
    /** Tool icon URL */
    tool_icon?:  string
    [key: string]: unknown
  }
  /** false = success; string = error message; null = not completed (started phase) */
  tool_call_error:  false | string | null
  /** Tool call result text, only has a value in the completed phase */
  tool_call_result: string | null
  tool_call_extra:  unknown
}

/** Agent SSE raw event discriminated union (exhaustive enumeration, each type has an explicit shape) */
type EvoseSseEvent =
  | { type: 'run_started';         content: { session_id: string; user_conversation_id: string }; thinking: string }
  | { type: 'run_output';          content: string; thinking: string }
  | { type: 'run_error';           content: string; thinking: string }
  | { type: 'run_cancelled';       content?: unknown; thinking?: string }
  | { type: 'run_completed';       content: { assistant_conversation_id: string }; thinking: string }
  | { type: 'tool_call_started';   tool: EvoseSseToolCall; thinking: string }
  | { type: 'tool_call_completed'; tool: EvoseSseToolCall; thinking: string }

// ─── Public Event API ─────────────────────────────────────────────────────────

/**
 * Normalized Agent run events, consumed by EvoseNativeCapability.
 *
 * Design principle: hide internal SSE details (thinking field, raw tool structure, etc.)
 * and only expose the information callers actually need.
 */
export type AgentRunEvent =
  | { type: 'started' }
  | { type: 'output'; text: string }
  | {
      type: 'tool_call_started'
      toolCallId: string
      toolName: string
      title: string
      iconUrl?: string
      kwargs?: Record<string, unknown>
    }
  | {
      type: 'tool_call_completed'
      toolCallId: string
      toolName: string
      title: string
      result: string
      isError: boolean
    }
  | { type: 'cancelled' }
  | { type: 'completed' }

// ─── API Response Types ───────────────────────────────────────────────────────

/**
 * Evose API envelope — all responses wrap the payload in this structure.
 * code === 0 means success; any other value is a business-level error
 * (distinct from HTTP errors, which are caught separately).
 */
interface EvoseApiEnvelope<T> {
  code: number
  msg: string
  data: T
}

/** GET /open/v1/apps response shape */
interface AppsPageData {
  list: Array<Record<string, unknown>>
  page: number
  pagesize: number
  total: number
  total_pages: number
  has_next: boolean
  has_prev: boolean
}

/** Workflow SSE event — different shape from Agent SSE events */
interface WorkflowSseEvent {
  workflow_run_id: string
  type: string
  data: Record<string, unknown>
  is_sub_workflow_message: boolean
  sub_workflow_parent_node_id: string
}

// ─── Request Types ────────────────────────────────────────────────────────────

interface RunAgentRequest {
  appId:      string
  input:      string
  sessionId?: string
  signal?: AbortSignal
  /**
   * Called when each Agent run event arrives.
   * Event types cover the full lifecycle: started / output / tool_call_* / cancelled / completed.
   * Used for real-time UI streaming display (progress card).
   */
  onEvent?: (event: AgentRunEvent) => void
}

interface RunWorkflowRequest {
  appId: string
  /** Key-value inputs. Converted to [{name, value}] array for the API. */
  inputs: Record<string, unknown>
  signal?: AbortSignal
}

// ─── Stateless Function: fetchEvoseApps ───────────────────────────────────────

/** Items per page when fetching the full app list. */
const FETCH_APPS_PAGE_SIZE = 100
/** Safety cap to prevent runaway pagination loops (100 × 50 = 5 000 apps). */
const FETCH_APPS_MAX_PAGES = 50

/** Configuration for {@link fetchEvoseApps}. */
export interface FetchEvoseAppsConfig {
  apiKey: string
  baseUrl: string
  workspaceIds: string[]
  /**
   * Proxy-aware fetch function.
   * Injected by the caller (IPC handler) — keeps this function decoupled
   * from proxy infrastructure while making the dependency explicit.
   */
  fetch: typeof globalThis.fetch
}

/**
 * Fetch **all** apps across paginated API responses.
 *
 * Stateless function — no side effects, no module-level state.  Iterates
 * through pages using the `has_next` flag until all apps are collected.
 * Includes a safety cap ({@link FETCH_APPS_MAX_PAGES}) to prevent runaway loops.
 *
 * Used by IPC handler `evose:fetch-apps`.
 */
export async function fetchEvoseApps(config: FetchEvoseAppsConfig): Promise<EvoseApp[]> {
  const allApps: EvoseApp[] = []
  let page = 1
  const baseUrl = resolveEvoseBaseUrl(config.baseUrl)

  log.info(`Fetching Evose apps: workspaceIds=${config.workspaceIds.join(',')}`)

  try {
    while (page <= FETCH_APPS_MAX_PAGES) {
      const url = new URL(`${baseUrl}/open/v1/apps`)
      url.searchParams.set('workspace_ids', config.workspaceIds.join(','))
      url.searchParams.set('types', 'single_agent,chat_flow,workflow')
      url.searchParams.set('page', String(page))
      url.searchParams.set('pagesize', String(FETCH_APPS_PAGE_SIZE))

      const response = await fetchWithTimeout(config.fetch, url.toString(), {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      })

      if (!response.ok) throw await parseEvoseHttpError(response)

      const envelope = await response.json() as EvoseApiEnvelope<AppsPageData>

      // HTTP 200 does NOT guarantee business success — always check code field
      if (envelope.code !== 0) {
        throw new EvoseApiError(envelope.code, envelope.msg ?? `Evose API error (${envelope.code})`)
      }

      const { list, has_next } = envelope.data

      for (const item of list) {
        allApps.push({
          id:          item['id'] as string,
          name:        item['name'] as string,
          type:        normalizeAppType(item['type'] as string),
          description: (item['description'] as string | undefined) ?? '',
          avatar:      (item['avatar'] as string | undefined) || undefined,
        })
      }

      if (!has_next) break
      page++
    }
  } catch (err) {
    throw wrapNetworkError(err, 'fetch apps')
  }

  log.info(`Fetched ${allApps.length} Evose apps (${page} page(s))`)
  return allApps
}

// ─── EvoseService Class ───────────────────────────────────────────────────────

/**
 * Constructor dependencies for {@link EvoseService}.
 *
 * Follows the same DI pattern as {@link WebhookServiceParams}:
 * structured deps object with lazy getters for proxy-aware infrastructure.
 */
export interface EvoseServiceDeps {
  settingsService: SettingsService
  /**
   * Returns a proxy-aware fetch function.  Called lazily on every request
   * so proxy settings changes take effect immediately — no re-injection needed.
   *
   * Same pattern as `WebhookServiceParams.getProxyFetch` and
   * `TelegramBotManagerDeps.fetch` (getter).
   */
  getProxyFetch: () => typeof globalThis.fetch
}

/**
 * Handles tool execution (Agent run, Workflow run) at Claude call time.
 * Reads API credentials from SettingsService on every call — never caches config.
 */
export class EvoseService {
  private readonly settingsService: SettingsService
  private readonly getProxyFetch: () => typeof globalThis.fetch

  constructor(deps: EvoseServiceDeps) {
    this.settingsService = deps.settingsService
    this.getProxyFetch = deps.getProxyFetch
  }

  /**
   * Run an Evose Agent via streaming SSE.
   *
   * Agent SSE events (verified against real API responses):
   *   run_started          → content: { session_id, user_conversation_id }
   *   run_output           → content: string  (text chunk, may repeat 1000+ times)
   *   run_error            → content: string  (error message) → throws
   *   run_cancelled        → (no meaningful content)          → throws EvoseAgentCancelledError
   *   run_completed        → content: { assistant_conversation_id }
   *   tool_call_started    → tool: { tool_name, tool_args.title, ... }
   *   tool_call_completed  → tool: { ..., tool_call_result, tool_call_error }
   *
   * Note: tool_call_output does NOT exist in this API — result is in tool_call_completed.
   */
  async runAgent(req: RunAgentRequest): Promise<string> {
    const { apiKey, baseUrl: rawBaseUrl } = this.settingsService.getSettings().evose
    const baseUrl = resolveEvoseBaseUrl(rawBaseUrl)
    log.info(`Running Evose agent: appId=${req.appId}`)

    if (req.signal?.aborted) {
      req.onEvent?.({ type: 'cancelled' })
      throw new EvoseAgentCancelledError()
    }

    let response: Response
    try {
      // SSE streams are long-running — call fetch directly without timeout
      response = await this.getProxyFetch()(`${baseUrl}/open/v1/apps/agent/run`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app_id:     req.appId,
          message:    req.input,
          session_id: req.sessionId,
          stream:     true,
        }),
        signal: req.signal,
      })
    } catch (err) {
      if (isAbortError(err) || req.signal?.aborted) {
        req.onEvent?.({ type: 'cancelled' })
        throw new EvoseAgentCancelledError()
      }
      throw wrapNetworkError(err, `agent run ${req.appId}`)
    }

    if (!response.ok) throw await parseEvoseHttpError(response)

    let output = ''
    try {
      for await (const event of parseSseStream<EvoseSseEvent>(response)) {
        switch (event.type) {
          case 'run_started': {
            req.onEvent?.({ type: 'started' })
            break
          }

          case 'run_output': {
            output += event.content
            req.onEvent?.({ type: 'output', text: event.content })
            break
          }

          case 'run_error': {
            throw new Error(event.content ?? 'Evose agent run failed')
          }

          case 'run_cancelled': {
            req.onEvent?.({ type: 'cancelled' })
            throw new EvoseAgentCancelledError()
          }

          case 'run_completed': {
            req.onEvent?.({ type: 'completed' })
            log.info(`Evose agent completed: appId=${req.appId}, length=${output.length}`)
            return output
          }

          case 'tool_call_started': {
            const { tool_call_id, tool_name, tool_args } = event.tool
            const title = tool_args.title ?? tool_name
            const iconUrl = tool_args.tool_icon ?? undefined
            // Extract kwargs: exclude metadata fields (title, tool_icon) to get pure input params
            const kwargs = tool_args.kwargs ?? undefined
            req.onEvent?.({
              type: 'tool_call_started',
              toolCallId: tool_call_id,
              toolName: tool_name,
              title,
              iconUrl,
              kwargs,
            })
            break
          }

          case 'tool_call_completed': {
            const { tool_call_id, tool_name, tool_args, tool_call_result, tool_call_error } = event.tool
            const title   = tool_args.title ?? tool_name
            const result  = tool_call_result ?? ''
            const isError = tool_call_error !== false && tool_call_error !== null
            req.onEvent?.({ type: 'tool_call_completed', toolCallId: tool_call_id, toolName: tool_name, title, result, isError })
            break
          }

          default: {
            // Defensive handling: API version upgrades may introduce new event types
            log.warn(`Unknown Evose agent SSE event: ${(event as { type: string }).type}`)
            break
          }
        }
      }
    } catch (err) {
      if (isAbortError(err) || req.signal?.aborted) {
        req.onEvent?.({ type: 'cancelled' })
        throw new EvoseAgentCancelledError()
      }
      throw err
    }

    // Stream ended unexpectedly without receiving run_completed (should not happen under normal conditions)
    log.warn(`Evose agent stream ended without run_completed: appId=${req.appId}`)
    return output
  }

  /**
   * Run an Evose Workflow via streaming SSE.
   *
   * Workflow SSE event shapes differ from Agent events:
   *   { workflow_run_id, type, data, is_sub_workflow_message, ... }
   *
   * Relevant events:
   *   workflow_start → data: { session_id, user_conversation_id, assistant_conversation_id }
   *   workflow_end   → data: { status, output_data, result, duration, ... }
   *   node_start / node_route / node_end → internal, ignored
   *
   * Request inputs format: [{name, value}] array (NOT a Record object).
   */
  async runWorkflow(req: RunWorkflowRequest): Promise<string> {
    const { apiKey, baseUrl: rawBaseUrl } = this.settingsService.getSettings().evose
    const baseUrl = resolveEvoseBaseUrl(rawBaseUrl)
    log.info(`Running Evose workflow: appId=${req.appId}`)

    if (req.signal?.aborted) {
      throw new EvoseAgentCancelledError()
    }

    // Convert Record<string, unknown> → [{name, value}] per API contract
    const input = Object.entries(req.inputs).map(([name, value]) => ({ name, value }))

    let response: Response
    try {
      // SSE streams are long-running — call fetch directly without timeout
      response = await this.getProxyFetch()(`${baseUrl}/open/v1/apps/workflow/run`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ app_id: req.appId, input, stream: true }),
        signal: req.signal,
      })
    } catch (err) {
      if (isAbortError(err) || req.signal?.aborted) {
        throw new EvoseAgentCancelledError()
      }
      throw wrapNetworkError(err, `workflow run ${req.appId}`)
    }

    if (!response.ok) throw await parseEvoseHttpError(response)

    let output = ''
    try {
      for await (const event of parseSseStream(response)) {
        const workflowEvent = event as unknown as WorkflowSseEvent
        if (workflowEvent.type === 'workflow_end') {
          const outputData = workflowEvent.data?.['output_data']
          // output_data is an object; JSON-serialize so Claude can read structured results
          output = outputData != null ? JSON.stringify(outputData) : ''
          break
        }
      }
    } catch (err) {
      if (isAbortError(err) || req.signal?.aborted) {
        throw new EvoseAgentCancelledError()
      }
      throw err
    }

    log.info(`Evose workflow completed: appId=${req.appId}`)
    return output
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function normalizeAppType(raw: string): 'agent' | 'workflow' {
  if (raw === 'single_agent' || raw === 'chat_flow') return 'agent'
  return 'workflow'
}

/**
 * Parse HTTP-level errors (4xx / 5xx) into structured EvoseApiError.
 * Business-level errors (HTTP 200 but code !== 0) are handled at call sites.
 */
async function parseEvoseHttpError(response: Response): Promise<EvoseApiError> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  const code = (body['code'] as number | undefined) ?? response.status
  const MESSAGE_MAP: Record<number, string> = {
    4001: 'Invalid API Key, please check configuration',
    4004: 'The specified app does not exist or has been deleted',
    4000: 'Invalid request parameters, please check Workspace IDs format',
    401:  'Invalid API Key (401)',
    403:  'Access denied (403)',
    404:  'Resource not found (404)',
    500:  'Evose server error (500)',
  }
  return new EvoseApiError(code, MESSAGE_MAP[code] ?? `Evose API error (${code})`)
}
