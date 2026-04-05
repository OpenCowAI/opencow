// SPDX-License-Identifier: Apache-2.0

/**
 * BrowserNativeCapability — the first built-in OpenCow native capability.
 *
 * Exposes 10 MCP tools that allow Claude to control the embedded browser:
 *   browser_navigate, browser_click, browser_type, browser_extract,
 *   browser_screenshot, browser_scroll, browser_wait,
 *   browser_snapshot, browser_ref_click, browser_ref_type
 *
 * Tool handlers run in-process (Electron main), directly calling BrowserService.
 * No extra process, no network round-trips.
 *
 * Design:
 * - **Declarative tool configs** — each tool is defined as metadata + execute fn,
 *   eliminating repetitive boilerplate across 7 tools.
 * - **Custom getToolDescriptors()** — overrides BaseNativeCapability's default because browser tools
 *   need a specialised pipeline (ensureView → timeout → execute → convert result).
 * - **ensureView() delegates to BrowserService** — orchestration logic
 *   (profile/view creation, mutex) lives where it belongs.
 */

import { z } from 'zod/v4'
import type {
  NativeCapabilityMeta,
  NativeCapabilityToolContext,
  CallToolResult,
  NativeToolDescriptor,
  NativeToolCallInput,
} from '../types'
import { BaseNativeCapability } from '../baseNativeCapability'
import type { DataBus } from '../../core/dataBus'
import type { BrowserService } from '../../browser/browserService'
import type { BrowserCommand, BrowserCommandResult } from '../../browser/types'
import type { SnapshotResult } from '../../browser/snapshot'
import { createLogger } from '../../platform/logger'
import { getMainWindow } from '../../window/windowManager'
import type { BrowserStatePolicy, ProjectBrowserStatePolicy } from '@shared/types'

const log = createLogger('BrowserNativeCapability')

/**
 * Default timeout for MCP tool execution (ms).
 *
 * This is the outer boundary — individual CDP commands inside BrowserActionExecutor
 * have their own (shorter) timeouts. This catches cases where the entire tool
 * operation hangs (e.g. ensureView() blocked, multiple CDP calls chained, etc.).
 */
const TOOL_TIMEOUT_MS = 45_000

// ─── Chrome DevTools MCP Mutual Exclusion ──────────────────────────────

/**
 * Well-known MCP server name for Chrome DevTools.
 *
 * When an external MCP server with this name is active, BrowserNativeCapability
 * suppresses its overlapping tools to prevent LLM confusion caused by
 * semantically equivalent tools targeting different browser instances.
 *
 * This name matches the conventional name used in templates, documentation,
 * and CLI examples (`claude mcp add chrome-devtools ...`).
 */
const CHROME_DEVTOOLS_MCP_NAME = 'chrome-devtools'

/**
 * Built-in browser tools that overlap with Chrome DevTools MCP.
 *
 * These tools are suppressed when `chrome-devtools` MCP is active because
 * Chrome DevTools MCP provides superior equivalents operating on a real
 * Chrome instance:
 *
 *   browser_navigate  → navigate_page (+ multi-tab support)
 *   browser_click     → click / click_at (+ coordinate-based clicking)
 *   browser_type      → type_text / fill / fill_form (+ batch filling)
 *   browser_extract   → take_snapshot (+ accessibility tree)
 *   browser_snapshot  → take_snapshot (AX tree with refs — superset of browser_extract)
 *   browser_screenshot→ take_screenshot (+ file persistence)
 *   browser_wait      → wait_for (+ URL/text conditions)
 *
 * browser_scroll, browser_ref_click, browser_ref_type are NOT in this set —
 * Chrome DevTools MCP has no scroll tool and no ref-based interaction tools.
 */
const CHROME_DEVTOOLS_OVERLAPPING_TOOLS = new Set([
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_extract',
  'browser_snapshot',
  'browser_screenshot',
  'browser_wait',
])

// ─── Dependencies ────────────────────────────────────────────────────────

export interface BrowserNativeCapabilityDeps {
  browserService: BrowserService
  bus: DataBus
  resolveProjectBrowserStatePolicy?: (projectId: string) => Promise<ProjectBrowserStatePolicy | null>
}

// ─── Browser-specific Tool Config ────────────────────────────────────────

/**
 * Declarative tool configuration for browser tools.
 *
 * Extends the concept of BaseNativeCapability's ToolConfig with browser-specific
 * concerns: the execute function receives a `viewId` (guaranteed-active
 * browser view) and an optional `showWindow` flag.
 */
interface BrowserToolConfig {
  name: string
  description: string
  schema: Record<string, z.ZodType>
  /**
   * Execute the tool's business logic.
   * Receives validated args and a guaranteed-active viewId.
   * Returns CallToolResult directly for maximum flexibility.
   */
  execute: (args: Record<string, unknown>, viewId: string, input: NativeToolCallInput) => Promise<CallToolResult>
  /**
   * Whether to make the browser window visible before executing this tool.
   *
   * Default: true — most tools benefit from being visible so the user can
   * observe what the agent is doing.
   *
   * Set to false for tools that operate purely on page data (e.g. screenshot)
   * and don't require the window to be rendered on screen. This avoids any
   * unnecessary window state changes for silent data-capture operations.
   */
  showWindow?: boolean
}

// ─── BrowserNativeCapability ─────────────────────────────────────────────

export class BrowserNativeCapability extends BaseNativeCapability {
  readonly meta: NativeCapabilityMeta = {
    category: 'browser',
    name: 'Browser',
    description: 'Embedded browser control — navigate, interact, and extract web content',
    version: '1.0.0',
  }

  private readonly browserService: BrowserService
  private readonly bus: DataBus
  private readonly resolveProjectBrowserStatePolicy: (projectId: string) => Promise<ProjectBrowserStatePolicy | null>

  constructor(deps: BrowserNativeCapabilityDeps) {
    super()
    this.browserService = deps.browserService
    this.bus = deps.bus
    this.resolveProjectBrowserStatePolicy = deps.resolveProjectBrowserStatePolicy ?? (async () => null)
  }

  /**
   * Overrides BaseNativeCapability's descriptor path — browser tools need a specialised
   * pipeline (ensureView + timeout) that doesn't fit the generic descriptor mapping.
   *
   * When an external Chrome DevTools MCP server is active, overlapping tools
   * are suppressed to prevent LLM confusion. Only non-overlapping tools
   * (e.g. browser_scroll) are retained alongside DevTools' 38 tools.
   */
  getToolDescriptors(context: NativeCapabilityToolContext): NativeToolDescriptor[] {
    const hasDevTools = context.activeMcpServerNames?.has(CHROME_DEVTOOLS_MCP_NAME) ?? false

    let configs = this.browserToolConfigs()

    if (hasDevTools) {
      const before = configs.length
      configs = configs.filter((c) => !CHROME_DEVTOOLS_OVERLAPPING_TOOLS.has(c.name))
      log.info(
        `Chrome DevTools MCP active — suppressed ${before - configs.length} overlapping tools, ` +
        `retaining: [${configs.map((c) => c.name).join(', ')}]`,
      )
    }

    return configs.map((config) => this.createBrowserToolDescriptor(config, context.session))
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    log.info('BrowserNativeCapability started')
  }

  async dispose(): Promise<void> {
    log.info('BrowserNativeCapability disposed')
  }

  // ── Browser Tool Factory ───────────────────────────────────────────

  /**
   * Create an MCP tool from a browser tool config, bound to a specific session.
   *
   * Handles the common pipeline for every browser tool:
   * 1. Wrap in timeout protection
   * 2. Ensure a session-owned browser view exists
   * 3. Delegate to config.execute()
   *
   * Binding `sessionId` at factory time (rather than reading it at invocation
   * time) ensures each session's tools always operate on their own dedicated
   * WebContentsView — preventing cross-session navigation interference.
   */
  private createBrowserToolDescriptor(
    config: BrowserToolConfig,
    session: import('../types').NativeCapabilitySessionContext,
  ): NativeToolDescriptor {
    // Reuse BaseNativeCapability descriptor wrapper with execute injected with viewId + timeout.
    return this.createToolDescriptor({
      name: config.name,
      description: config.description,
      schema: config.schema,
      execute: async (args, input) => {
        return this.withToolTimeout(config.name, input, async () => {
          const viewId = await this.ensureSessionView(session, config.showWindow ?? true)
          return config.execute(args, viewId, input)
        })
      },
    })
  }

  // ── Tool Definitions (declarative) ─────────────────────────────────

  private browserToolConfigs(): BrowserToolConfig[] {
    return [
      // ── browser_navigate ──────────────────────────────────────
      {
        name: 'browser_navigate',
        description:
          'Navigate the embedded browser to a URL. Opens the browser window if not already visible. Returns the page title after navigation completes. ' +
          'Prefer this tool for "open website" requests instead of running OS shell launch commands like open/start/xdg-open.',
        schema: {
          url: z.url('Must be a valid URL (e.g. https://example.com)'),
        },
        execute: async (args, viewId, input) => {
          const result = await this.browserService.executeCommand({
            viewId,
            action: 'navigate',
            url: args.url as string,
          }, input.context)

          if (result.status === 'success') {
            const info = this.browserService.getPageInfo(viewId)
            return this.textResult(
              JSON.stringify(
                {
                  url: info?.url ?? (args.url as string),
                  title: info?.title ?? '',
                  status: 'navigated',
                },
                null,
                2,
              ),
            )
          }

          return this.toCallToolResult(result)
        },
      },

      // ── browser_click ─────────────────────────────────────────
      {
        name: 'browser_click',
        description:
          'Click an element on the current page using a CSS selector. The element must be visible and interactable.',
        schema: {
          selector: z
            .string()
            .describe(
              'CSS selector of the element to click (e.g. "button.submit", "#login-btn", "a[href=\'/about\']")',
            ),
        },
        execute: async (args, viewId, input) => {
          const result = await this.browserService.executeCommand({
            viewId,
            action: 'click',
            selector: args.selector as string,
          }, input.context)
          return this.toCallToolResult(result)
        },
      },

      // ── browser_type ──────────────────────────────────────────
      {
        name: 'browser_type',
        description:
          'Type text into an input element on the current page. The element is focused and cleared before typing.',
        schema: {
          selector: z
            .string()
            .describe(
              'CSS selector of the input element (e.g. "input[name=\'email\']", "#search-box", "textarea.comment")',
            ),
          text: z.string().describe('The text to type into the element'),
        },
        execute: async (args, viewId, input) => {
          const result = await this.browserService.executeCommand({
            viewId,
            action: 'type',
            selector: args.selector as string,
            text: args.text as string,
          }, input.context)
          return this.toCallToolResult(result)
        },
      },

      // ── browser_extract ───────────────────────────────────────
      {
        name: 'browser_extract',
        description:
          'Extract text content from the current page. Without a selector, extracts the full page content (title, URL, visible text, links). With a selector, extracts only the text of matching elements.',
        schema: {
          selector: z
            .string()
            .optional()
            .describe('Optional CSS selector. If omitted, extracts full page content.'),
        },
        execute: async (args, viewId, input) => {
          const command: BrowserCommand = args.selector
            ? { viewId, action: 'extract-text', selector: args.selector as string }
            : { viewId, action: 'extract-page' }
          const result = await this.browserService.executeCommand(command, input.context)
          return this.toCallToolResult(result)
        },
      },

      // ── browser_screenshot ────────────────────────────────────
      {
        name: 'browser_screenshot',
        description:
          'Take a screenshot of the current page. Returns the image as base64-encoded PNG. ' +
          'IMPORTANT: Only use this as a fallback when browser_snapshot cannot resolve the task ' +
          'after multiple attempts — screenshots consume significantly more tokens and are slower. ' +
          'Prefer browser_snapshot for page understanding and element interaction.',
        schema: {},
        // CDP captures the page directly — window visibility is irrelevant.
        // Skipping ensureVisible() avoids any window state changes during
        // what is purely a silent data-capture operation.
        showWindow: false,
        execute: async (_args, viewId, input) => {
          const result = await this.browserService.executeCommand({
            viewId,
            action: 'screenshot',
          }, input.context)

          if (result.status === 'success' && typeof result.data === 'string') {
            return {
              content: [{ type: 'image' as const, data: result.data, mimeType: 'image/png' }],
            }
          }

          return this.toCallToolResult(result)
        },
      },

      // ── browser_scroll ────────────────────────────────────────
      {
        name: 'browser_scroll',
        description:
          'Scroll the current page up or down. Useful for reaching content below the fold or navigating long pages.',
        schema: {
          direction: z.enum(['up', 'down']).describe('Scroll direction'),
          amount: z
            .number()
            .optional()
            .describe(
              'Scroll amount in pixels. Omit to scroll one full viewport height. ' +
              'Only provide when you need a specific partial scroll (e.g. 300 for half a screen).',
            ),
        },
        execute: async (args, viewId, input) => {
          const result = await this.browserService.executeCommand({
            viewId,
            action: 'scroll',
            direction: args.direction as 'up' | 'down',
            amount: args.amount as number | undefined,
          }, input.context)
          return this.toCallToolResult(result)
        },
      },

      // ── browser_wait ──────────────────────────────────────────
      {
        name: 'browser_wait',
        description:
          'Wait for an element matching a CSS selector to appear on the page. Useful after navigation or dynamic content loading.',
        schema: {
          selector: z.string().describe('CSS selector to wait for'),
          timeout: z
            .number()
            .optional()
            .describe('Maximum wait time in milliseconds (default: 10000)'),
        },
        execute: async (args, viewId, input) => {
          const result = await this.browserService.executeCommand({
            viewId,
            action: 'wait-for-selector',
            selector: args.selector as string,
            timeout: args.timeout as number | undefined,
          }, input.context)
          return this.toCallToolResult(result)
        },
      },

      // ── browser_snapshot ───────────────────────────────────────
      {
        name: 'browser_snapshot',
        description:
          'Take an accessibility snapshot of the current page. ' +
          'Returns a compact text tree with element references (e.g. e1, e2). ' +
          'Use these refs with browser_ref_click and browser_ref_type for precise interaction. ' +
          'Refs are tied to the accessibility tree — more reliable than CSS selectors. ' +
          'PREFERRED: Always use this tool first for page understanding and element interaction — ' +
          'it is faster, cheaper, and more deterministic than browser_screenshot.',
        schema: {
          selector: z
            .string()
            .optional()
            .describe('Optional CSS selector to limit snapshot to a subtree'),
          interactive_only: z
            .boolean()
            .optional()
            .describe('Only show elements with refs (default: false)'),
          compact: z
            .boolean()
            .optional()
            .describe('Compact mode — only ref lines + ancestors (default: false)'),
        },
        showWindow: false,
        execute: async (args, viewId, input) => {
          const result = await this.browserService.executeCommand(
            {
              viewId,
              action: 'snapshot',
              options: {
                selector: args.selector as string | undefined,
                interactiveOnly: args.interactive_only as boolean | undefined,
                compact: args.compact as boolean | undefined,
                detectCursorInteractive: true,
              },
            },
            input.context,
          )

          if (result.status === 'success') {
            const snapshot = result.data as SnapshotResult
            return this.textResult(
              `Page: ${snapshot.title}\nURL: ${snapshot.url}\nRefs: ${snapshot.refCount} elements\n\n` +
              snapshot.tree +
              '\n\nRefs are valid until page changes. After each click/type, a fresh snapshot is returned automatically.',
            )
          }
          return this.toCallToolResult(result)
        },
      },

      // ── browser_ref_click ──────────────────────────────────────
      {
        name: 'browser_ref_click',
        description:
          'Click an element by its snapshot reference (e.g. "e1"). ' +
          'More reliable than CSS selectors. Call browser_snapshot first to get refs. ' +
          'Returns an updated snapshot after clicking.',
        schema: {
          ref: z
            .string()
            .describe('Element reference from browser_snapshot (e.g. "e1", "e5")'),
        },
        execute: async (args, viewId, input) => {
          const result = await this.browserService.executeCommand(
            {
              viewId,
              action: 'ref-click',
              ref: args.ref as string,
            },
            input.context,
          )

          if (result.status === 'success' && result.data) {
            const snapshot = result.data as SnapshotResult
            return this.textResult(
              `Clicked [${args.ref}]. Updated snapshot:\n\n` +
              `Page: ${snapshot.title}\nURL: ${snapshot.url}\nRefs: ${snapshot.refCount} elements\n\n` +
              snapshot.tree,
            )
          }
          return this.toCallToolResult(result)
        },
      },

      // ── browser_ref_type ───────────────────────────────────────
      {
        name: 'browser_ref_type',
        description:
          'Type text into an element by its snapshot reference (e.g. "e3"). ' +
          'Element is clicked for focus, then text is typed character by character. ' +
          'Returns an updated snapshot after typing.',
        schema: {
          ref: z
            .string()
            .describe('Element reference from browser_snapshot (e.g. "e3")'),
          text: z
            .string()
            .describe('The text to type'),
        },
        execute: async (args, viewId, input) => {
          const result = await this.browserService.executeCommand(
            {
              viewId,
              action: 'ref-type',
              ref: args.ref as string,
              text: args.text as string,
            },
            input.context,
          )

          if (result.status === 'success' && result.data) {
            const snapshot = result.data as SnapshotResult
            return this.textResult(
              `Typed into [${args.ref}]. Updated snapshot:\n\n` +
              `Page: ${snapshot.title}\nURL: ${snapshot.url}\nRefs: ${snapshot.refCount} elements\n\n` +
              snapshot.tree,
            )
          }
          return this.toCallToolResult(result)
        },
      },
    ]
  }

  // ── ensureSessionView (delegates to BrowserService) ──────────────

  /**
   * Ensure the given session has a browser view, returning its viewId.
   *
   * Delegates to BrowserService.getOrCreateSessionView() which owns the
   * orchestration logic (profile resolution, view creation, mutex).
   * BrowserNativeCapability only provides the window acquisition callback and
   * optionally makes the browser window visible.
   *
   * @param sessionId  The owning session — its view is created if absent.
   * @param showWindow When true, calls `ensureVisible()` (showInactive — no focus
   *   stealing) so the user can observe agent activity. When false, the window is
   *   left in its current visibility state (used for silent data-capture tools
   *   like `browser_screenshot` that work via CDP regardless of visibility).
   */
  private async resolveDefaultPolicy(
    session: import('../types').NativeCapabilitySessionContext,
  ): Promise<BrowserStatePolicy> {
    if (!session.projectId) return 'shared-global'

    const configured = await this.resolveProjectBrowserStatePolicy(session.projectId)
    const preferred = configured ?? 'shared-global'

    // Issue isolation requires an issue-scoped session context.
    if (preferred === 'isolated-issue' && !session.issueId) {
      return 'isolated-session'
    }

    return preferred
  }

  private async ensureSessionView(
    session: import('../types').NativeCapabilitySessionContext,
    showWindow: boolean,
  ): Promise<string> {
    const sessionId = session.sessionId
    const policy = await this.resolveDefaultPolicy(session)
    const source: import('@shared/types').BrowserSource = session.issueId
      ? { type: 'issue-session', issueId: session.issueId, sessionId }
      : { type: 'chat-session', sessionId }
    const binding = await this.browserService.resolveStateBinding({
      source,
      policy,
      sessionId,
      issueId: session.issueId ?? undefined,
      projectId: session.projectId ?? undefined,
    })

    if (showWindow) {
      // Dispatch browser:open-overlay to signal the renderer to show BrowserSheet
      this.bus.dispatch({
        type: 'browser:open-overlay',
        payload: {
          source,
          options: {
            policy,
            projectId: session.projectId ?? undefined,
            preferredProfileId: binding.profileId,
          },
        },
      })
    }
    return this.browserService.getOrCreateSessionView(sessionId, async () => {
      const win = getMainWindow()
      if (!win) throw new Error('No main window found for browser view attachment')
      return win
    }, binding.profileId, binding)
  }

  // ── Tool Timeout Wrapper ─────────────────────────────────────────

  /**
   * Execute a tool handler with a bounded timeout.
   *
   * If the handler doesn't complete within TOOL_TIMEOUT_MS, returns
   * a graceful error CallToolResult instead of hanging indefinitely.
   * This is the critical safety net that prevents:
   *   - "ProcessTransport is not ready for writing" (SDK child process dies)
   *   - "Tool permission stream closed" (SDK gives up waiting for tool response)
   *
   * The timer is always cleaned up (via finally) to prevent memory leaks.
   */
  private withToolTimeout(toolName: string, input: NativeToolCallInput, handler: () => Promise<CallToolResult>): Promise<CallToolResult> {
    if (input.context.signal?.aborted) {
      return Promise.resolve(this.structuredError('ABORTED', `Tool "${toolName}" was cancelled before execution.`))
    }

    const timeoutMs = this.resolveTimeoutMs(input.context.deadlineAt)
    if (timeoutMs <= 0) {
      return Promise.resolve(
        this.structuredError('TIMEOUT', `Tool "${toolName}" exceeded the execution deadline before start.`),
      )
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    let abortCleanup: (() => void) | null = null

    const timeoutResult = new Promise<CallToolResult>((resolve) => {
      timer = setTimeout(() => {
        log.warn(`Tool "${toolName}" timed out after ${timeoutMs}ms`)
        resolve(
          this.structuredError(
            'TIMEOUT',
            `Tool "${toolName}" timed out after ${timeoutMs}ms. ` +
              'The page may be unresponsive or the operation took too long.',
          ),
        )
      }, timeoutMs)
    })

    const abortResult = new Promise<CallToolResult>((resolve) => {
      const signal = input.context.signal
      if (!signal) return
      const onAbort = () => {
        resolve(this.structuredError('ABORTED', `Tool "${toolName}" was cancelled during execution.`))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      abortCleanup = () => signal.removeEventListener('abort', onAbort)
    })

    return Promise.race([handler(), timeoutResult, abortResult]).finally(() => {
      if (timer !== null) clearTimeout(timer)
      if (abortCleanup) abortCleanup()
    })
  }

  private resolveTimeoutMs(deadlineAt?: number): number {
    if (deadlineAt === undefined) return TOOL_TIMEOUT_MS
    return Math.max(0, Math.min(TOOL_TIMEOUT_MS, deadlineAt - Date.now()))
  }

  // ── Result Helpers ────────────────────────────────────────────────

  /** Convert a BrowserCommandResult to an MCP CallToolResult. */
  private toCallToolResult(result: BrowserCommandResult): CallToolResult {
    if (result.status === 'success') {
      return this.textResult(
        result.data !== undefined ? JSON.stringify(result.data, null, 2) : 'OK',
      )
    }

    return this.structuredError(result.error.code, result.error.message)
  }

  /**
   * Create a structured error result with explicit code + message.
   *
   * Browser-specific: preserves BrowserService error codes (e.g. TIMEOUT,
   * SELECTOR_NOT_FOUND) for richer agent error handling.
   */
  private structuredError(code: string, message: string): CallToolResult {
    return {
      content: [{ type: 'text' as const, text: `Error [${code}]: ${message}` }],
      isError: true,
    }
  }
}
