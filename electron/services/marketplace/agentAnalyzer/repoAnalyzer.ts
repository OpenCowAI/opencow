// SPDX-License-Identifier: Apache-2.0

/**
 * RepoAnalyzer — orchestrates Agent-driven repository analysis.
 *
 * Creates a headless SDK session with sandboxed filesystem tools
 * (RepoAnalyzerCapability), runs the analysis Agent, validates
 * the submitted manifest, and caches results.
 *
 * Uses the Claude Agent SDK directly (not SessionOrchestrator) because
 * analysis sessions are:
 *   - Ephemeral — no persistence or resume needed
 *   - Internal — no UI state management needed
 *   - Per-analysis — tools are bound to a specific repository directory
 *
 * The SessionOrchestrator is designed for user-facing sessions with
 * persistence, multi-turn, and lifecycle management. RepoAnalyzer
 * needs none of that — a direct SDK call is cleaner and avoids coupling
 * to the orchestrator's NativeCapabilityRegistry (which requires
 * global registration, incompatible with per-analysis tool instances).
 */

import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { query as sdkQuery, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import type { Query, CanUseTool, SDKMessage, Options as SdkOptions } from '@anthropic-ai/claude-agent-sdk'
import { MessageQueue } from '../../../command/messageQueue'
import { ToolProgressRelay } from '../../../utils/toolProgressRelay'
import { getShellEnvironment } from '../../../platform/shellPath'
import { createLogger } from '../../../platform/logger'
import type { NativeCapabilityToolContext } from '../../../nativeCapabilities/types'
import { toClaudeToolDefinitions } from '../../../nativeCapabilities/claudeToolAdapter'
import { RepoAnalyzerCapability } from './repoAnalyzerCapability'
import { ManifestValidator } from './manifestValidator'
import { ManifestCache } from './manifestCache'
import { REPO_ANALYZER_SYSTEM_PROMPT, buildAnalysisUserMessage } from './systemPrompt'
import { MARKET_ANALYSIS_TIMEOUT_SEC } from '../../../../src/shared/types'
import type { RepoAnalysisParams, RepoAnalysisResult, AgentManifest, AnalysisProgress } from './types'

const log = createLogger('RepoAnalyzer')

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum turns for the analysis Agent session (session-based). */
const MAX_ANALYSIS_TURNS = 25

/** Hard timeout for the entire analysis — derived from the shared constant in @shared/types. */
const ANALYSIS_TIMEOUT_MS = MARKET_ANALYSIS_TIMEOUT_SEC * 1000

/**
 * Progress throttle interval (ms).
 *
 * Limits DataBus event throughput during high-frequency SDK stream messages.
 * Phase changes always bypass the throttle for immediate UI feedback.
 */
const PROGRESS_THROTTLE_MS = 150

/** MCP server name for the analysis tools. */
const ANALYZER_MCP_SERVER_NAME = 'repo-analyzer'

// ─── CLI Path Resolution ────────────────────────────────────────────────────

/**
 * Resolve the path to the SDK's bundled cli.js, handling asar unpacking.
 *
 * Same logic as sessionOrchestrator.ts — duplicated here to avoid coupling
 * the analyzer to the orchestrator module.
 */
function resolveCliPath(): string | undefined {
  try {
    const cliPath = require.resolve('@anthropic-ai/claude-agent-sdk/cli.js')
    if (cliPath.includes('app.asar')) {
      const unpacked = cliPath.replace('app.asar', 'app.asar.unpacked')
      if (existsSync(unpacked)) return unpacked
    }
    return cliPath
  } catch {
    return undefined
  }
}

// ─── Dependencies ───────────────────────────────────────────────────────────

export interface RepoAnalyzerDeps {
  /** Returns API provider credentials (ANTHROPIC_API_KEY, etc.) for the SDK session. */
  getProviderEnv: () => Promise<Record<string, string>>
  /** Returns proxy settings from OpenCow preferences. */
  getProxyEnv: () => Record<string, string>
}

// ─── Repo Tree Constants ─────────────────────────────────────────────────────

/** Directories to skip when generating the repo tree. */
const TREE_SKIP_DIRS = new Set([
  '.git', '.github', '.vscode', '.idea',
  'node_modules', '__pycache__', '.mypy_cache',
  'dist', 'build', 'out', '.next', '.nuxt',
  'coverage', '.pytest_cache', '__extract__',
])

/** Default depth for tree generation. */
const TREE_DEFAULT_DEPTH = 3

// ─── PreparedAnalysisSession ────────────────────────────────────────────────

/**
 * Configuration returned by `prepareSession()` — everything needed to run
 * an analysis session via SessionOrchestrator.
 *
 * The caller (MarketplaceService) uses this to start a visible session
 * without needing to understand the RepoAnalyzer internals.
 */
export interface PreparedAnalysisSession {
  /** MCP server config to inject into SessionOrchestrator via customMcpServers */
  mcpServerConfig: unknown
  /** System prompt for the analysis Agent */
  systemPrompt: string
  /** Initial user message (marketplace metadata + pre-scanned repo tree) */
  userMessage: string
  /** Reference to the capability instance — used to extract manifest after session completes */
  capability: RepoAnalyzerCapability
  /** Recommended max turns for the analysis */
  maxTurns: number
}

// ─── RepoAnalyzer ───────────────────────────────────────────────────────────

export class RepoAnalyzer {
  private readonly cache = new ManifestCache()
  private readonly validator = new ManifestValidator()
  private readonly deps: RepoAnalyzerDeps

  constructor(deps: RepoAnalyzerDeps) {
    this.deps = deps
  }

  // ── Public: Session-Based Analysis ──────────────────────────────────────

  /**
   * Prepare a session configuration for Agent-driven repository analysis.
   *
   * Returns everything needed to start a visible session via SessionOrchestrator:
   * MCP server config (sandboxed tools), prompts, and a capability reference
   * for manifest extraction after the session completes.
   *
   * This method does NOT execute the analysis — the caller starts the session
   * via SessionOrchestrator and the user sees the AI conversation in real time.
   */
  async prepareSession(params: {
    repoDir: string
    marketDetail: { name: string; description: string; author?: string; repoUrl?: string }
  }): Promise<PreparedAnalysisSession> {
    // 1. Create per-analysis capability with sandboxed filesystem tools
    const capability = new RepoAnalyzerCapability(params.repoDir)

    // 2. Build tool context for MCP server creation
    const toolContext: NativeCapabilityToolContext = {
      session: { sessionId: `analysis-${Date.now()}`, projectId: null },
      relay: new ToolProgressRelay(),
    }

    // 3. Create in-process MCP server with sandboxed tools
    const tools = toClaudeToolDefinitions(capability.getToolDescriptors(toolContext))
    const mcpServerConfig = createSdkMcpServer({
      name: ANALYZER_MCP_SERVER_NAME,
      version: '1.0.0',
      tools,
    })

    // 4. Pre-scan repo tree for inclusion in the initial prompt
    const repoTree = await RepoAnalyzer.generateRepoTree(params.repoDir)

    // 5. Build user message with marketplace metadata + repo tree
    const userMessage = buildAnalysisUserMessage({
      ...params.marketDetail,
      repoTree,
    })

    return {
      mcpServerConfig,
      systemPrompt: REPO_ANALYZER_SYSTEM_PROMPT,
      userMessage,
      capability,
      maxTurns: MAX_ANALYSIS_TURNS,
    }
  }

  /** Get the manifest validator instance (used by MarketplaceService for result processing). */
  getValidator(): ManifestValidator {
    return this.validator
  }

  // ── Public: Direct Analysis (legacy) ────────────────────────────────────

  /**
   * Analyze a downloaded repository for installable capabilities.
   *
   * Flow:
   *   1. Check manifest cache (slug@version:sha)
   *   2. If miss → run headless Agent session with sandboxed tools
   *   3. Validate Agent's submitted manifest
   *   4. Cache validated result
   *   5. Return RepoAnalysisResult
   *
   * @throws If the Agent session fails (network error, SDK crash, timeout).
   *         The caller should catch and present a user-friendly error.
   */
  async analyze(params: RepoAnalysisParams): Promise<RepoAnalysisResult> {
    // 1. Check cache
    const cached = this.cache.get(params.cacheKey)
    if (cached) {
      log.info(`Cache hit for ${params.cacheKey.slug}@${params.cacheKey.version}`)
      return { source: 'cache', manifest: cached }
    }

    // 2. Run Agent analysis
    log.info(`Starting Agent analysis for ${params.cacheKey.slug}`)
    const agentManifest = await this.runAgentAnalysis(params)

    // 3. If no manifest submitted, the Agent determined no capabilities exist
    if (!agentManifest) {
      log.info(`Agent found no capabilities in ${params.cacheKey.slug}`)
      return { source: 'agent', manifest: null }
    }

    // 4. Validate the manifest
    const validated = this.validator.validate(agentManifest, params.repoDir)
    log.info(
      `Validated manifest for ${params.cacheKey.slug}: `
      + `${validated.capabilities.length} valid, ${validated.rejected.length} rejected`,
    )

    // 5. Cache result (even if all capabilities were rejected — prevents re-analysis)
    this.cache.set(params.cacheKey, validated)

    return { source: 'agent', manifest: validated }
  }

  /** Invalidate a specific cache entry (e.g. when user requests re-analysis). */
  invalidateCache(key: RepoAnalysisParams['cacheKey']): void {
    this.cache.invalidate(key)
  }

  /** Clear all cached analysis results. */
  clearCache(): void {
    this.cache.clear()
  }

  // ── Private: Agent Session ─────────────────────────────────────────────

  /**
   * Run a headless Agent session to analyze the repository.
   *
   * Creates a per-analysis RepoAnalyzerCapability instance (bound to the
   * specific repoDir), sets up an in-process MCP server with the sandboxed
   * tools, and runs a one-shot SDK query.
   *
   * @returns The Agent's submitted manifest, or null if no manifest was
   *          submitted (Agent determined the repo has no installable capabilities).
   * @throws  On SDK errors, network failures, or timeout.
   */
  private async runAgentAnalysis(params: RepoAnalysisParams): Promise<AgentManifest | null> {
    const { signal } = params

    // ── Pre-flight: check if already cancelled ──
    if (signal?.aborted) {
      throw new Error('Analysis cancelled')
    }

    // Create per-analysis capability with sandboxed filesystem tools
    const capability = new RepoAnalyzerCapability(params.repoDir)

    // Build tool context — RepoAnalyzerCapability ignores context fields
    // (its toolConfigs uses `_context`), but the interface requires them.
    const toolContext: NativeCapabilityToolContext = {
      session: { sessionId: `analysis-${Date.now()}`, projectId: null },
      relay: new ToolProgressRelay(),
    }

    // Get tools and create in-process MCP server
    const tools = toClaudeToolDefinitions(capability.getToolDescriptors(toolContext))
    const mcpServerConfig = createSdkMcpServer({
      name: ANALYZER_MCP_SERVER_NAME,
      version: '1.0.0',
      tools,
    })

    // Build session environment (API keys, proxy, PATH)
    const env = await this.buildSessionEnv()

    // Build the initial analysis prompt with marketplace context
    const userMessage = buildAnalysisUserMessage(params.marketDetail)

    // Create message queue with the initial prompt
    const queue = new MessageQueue()
    queue.push(userMessage)

    // Resolve CLI path for the SDK child process
    const cliPath = resolveCliPath()

    // ── P0: canUseTool callback ──────────────────────────────────────
    // The SDK invokes `canUseTool` for tools whose `checkPermissions()`
    // returns `{ behavior: 'ask' }`. Without this callback the SDK sends
    // a `control_request` that we cannot respond to → timeout → deadlock.
    //
    // Analysis sessions are fully sandboxed — all tools are pre-approved.
    const canUseTool: CanUseTool = async (_toolName, _input, _options) => {
      return { behavior: 'allow' as const }
    }

    // SDK query options — typed via the SDK's Options interface for compile-time safety.
    // If the SDK changes its option shape, TypeScript will flag the mismatch here.
    const options: SdkOptions = {
      systemPrompt: REPO_ANALYZER_SYSTEM_PROMPT,
      maxTurns: MAX_ANALYSIS_TURNS,
      env,
      cwd: params.repoDir,       // SDK child process works in the repo directory
      mcpServers: { [ANALYZER_MCP_SERVER_NAME]: mcpServerConfig },
      allowDangerouslySkipPermissions: true,
      permissionMode: 'acceptEdits',
      canUseTool,                 // Prevent SDK deadlock on tool permission requests
      tools: [],                  // Disable all built-in SDK tools (Read, Write, Bash, etc.)
      disallowedTools: [],        // No additional disallowed tools
      includePartialMessages: true,  // Enable stream messages for progress tracking
      ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
    }

    // Start the SDK query
    const sdkStream: Query = sdkQuery({ prompt: queue, options })

    // ── Cancellation: abort signal → close SDK stream ──────────────
    const onAbort = (): void => {
      log.info(`Analysis cancelled for ${params.cacheKey.slug}`)
      sdkStream.close()
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    // Set up hard timeout — prevents stuck sessions from blocking indefinitely
    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      log.warn(`Analysis timed out for ${params.cacheKey.slug} after ${ANALYSIS_TIMEOUT_MS / 1000}s`)
      sdkStream.close()
    }, ANALYSIS_TIMEOUT_MS)

    // ── Progress throttling ────────────────────────────────────────
    // Leading-edge throttle (150ms) with immediate phase-change passthrough.
    // Prevents flooding the DataBus while keeping phase transitions snappy.
    const throttledOnProgress = RepoAnalyzer.createThrottledProgress(params.onProgress)

    throttledOnProgress?.({ phase: 'agent:started', detail: 'Starting AI analysis…' })

    try {
      // Process SDK stream messages for progress tracking.
      // The RepoAnalyzerCapability stores the manifest internally when
      // submit_manifest is called. The stream ends when maxTurns is
      // reached or the Agent finishes.
      for await (const message of sdkStream) {
        this.processStreamMessage(message as SDKMessage, throttledOnProgress)
      }
    } catch (err) {
      // ── Cancellation takes priority over timeout ──
      if (signal?.aborted) {
        throw new Error('Analysis cancelled')
      }
      // If the error is from our timeout close(), wrap it with context
      if (timedOut) {
        throw new Error(
          `Analysis of ${params.cacheKey.slug} timed out after ${ANALYSIS_TIMEOUT_MS / 1000}s. `
          + 'The repository may be too large or complex for automated analysis.',
        )
      }
      log.error(`Agent analysis failed for ${params.cacheKey.slug}`, err)
      throw err
    } finally {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
      // Ensure cleanup — idempotent calls are safe
      sdkStream.close()
      queue.close()
    }

    // Check for cancellation/timeout after clean stream end
    if (signal?.aborted) {
      throw new Error('Analysis cancelled')
    }
    if (timedOut) {
      throw new Error(
        `Analysis of ${params.cacheKey.slug} timed out after ${ANALYSIS_TIMEOUT_MS / 1000}s.`,
      )
    }

    throttledOnProgress?.({ phase: 'agent:done', detail: 'Analysis complete' })

    return capability.getSubmittedManifest()
  }

  // ── Private: Stream Processing ──────────────────────────────────────

  /**
   * Extract progress signals from SDK stream messages.
   *
   * Maps SDK message types to analysis phases:
   *   - tool_progress with read_file/list_directory → 'agent:reading-files'
   *   - tool_progress with submit_manifest → 'agent:submitting'
   *   - assistant messages → 'agent:analyzing' (reasoning phase)
   *   - stream_event → heartbeat during Agent reasoning (prevents UI stall)
   */
  private processStreamMessage(
    message: SDKMessage,
    onProgress?: (progress: AnalysisProgress) => void,
  ): void {
    if (!onProgress) return

    switch (message.type) {
      case 'tool_progress': {
        const toolName = message.tool_name
        if (toolName === 'submit_manifest') {
          onProgress({ phase: 'agent:submitting', detail: 'Submitting analysis results…', toolName })
        } else if (toolName === 'read_file' || toolName === 'list_directory') {
          onProgress({ phase: 'agent:reading-files', detail: 'Reading repository files…', toolName })
        } else {
          onProgress({ phase: 'agent:analyzing', detail: `Using ${toolName}…`, toolName })
        }
        break
      }
      case 'assistant': {
        // Full assistant message — Agent completed a reasoning turn
        onProgress({ phase: 'agent:analyzing', detail: 'Analyzing repository structure…' })
        break
      }
      case 'stream_event': {
        // Partial assistant chunks / thinking — heartbeat during reasoning.
        // Without this, the UI appears frozen when the Agent is thinking
        // (reasoning phases can last 30–60s with no other events).
        onProgress({ phase: 'agent:analyzing', detail: 'AI analyzing…' })
        break
      }
      default:
        // system, result, etc. — no user-facing progress update
        break
    }
  }

  /**
   * Create a throttled progress callback (leading-edge, 150ms).
   *
   * Phase changes always pass through immediately — the user sees instant
   * feedback when the analysis transitions between phases. Repeated events
   * within the same phase are rate-limited to prevent DataBus flooding.
   */
  private static createThrottledProgress(
    onProgress?: (progress: AnalysisProgress) => void,
  ): ((progress: AnalysisProgress) => void) | undefined {
    if (!onProgress) return undefined
    let lastEmitAt = 0
    let lastPhase: string | null = null
    return (progress: AnalysisProgress) => {
      const now = Date.now()
      const isPhaseChange = progress.phase !== lastPhase
      if (isPhaseChange || now - lastEmitAt >= PROGRESS_THROTTLE_MS) {
        lastEmitAt = now
        lastPhase = progress.phase
        onProgress(progress)
      }
    }
  }

  // ── Static: Repo Tree Generation ────────────────────────────────────────

  /**
   * Generate a text representation of the repository directory tree.
   *
   * Recursively traverses the directory structure, skipping common
   * non-content directories (.git, node_modules, etc.). The output is
   * included in the initial user message so the Agent can skip the
   * expensive `list_directory` call and jump straight to reading files.
   *
   * @param repoDir — absolute path to the repository root
   * @param maxDepth — maximum recursion depth (default: 3)
   */
  static async generateRepoTree(repoDir: string, maxDepth = TREE_DEFAULT_DEPTH): Promise<string> {
    const lines: string[] = []
    await RepoAnalyzer.walkTree(repoDir, repoDir, maxDepth, 0, lines)
    return lines.join('\n')
  }

  private static async walkTree(
    rootDir: string,
    currentDir: string,
    maxDepth: number,
    depth: number,
    lines: string[],
  ): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    // Sort: directories first, then files, alphabetically within each group
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    const indent = '  '.repeat(depth)
    for (const entry of entries) {
      if (entry.name.startsWith('.') && TREE_SKIP_DIRS.has(entry.name)) continue
      if (TREE_SKIP_DIRS.has(entry.name)) continue

      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        lines.push(`${indent}${entry.name}/`)
        if (depth < maxDepth - 1) {
          await RepoAnalyzer.walkTree(rootDir, fullPath, maxDepth, depth + 1, lines)
        }
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath)
          lines.push(`${indent}${entry.name}  (${RepoAnalyzer.formatSize(stat.size)})`)
        } catch {
          lines.push(`${indent}${entry.name}`)
        }
      }
    }
  }

  private static formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // ── Private: Environment ───────────────────────────────────────────────

  /**
   * Build the environment variables for the analysis SDK session.
   *
   * Mirrors SessionOrchestrator.runSession() env setup:
   *   process.env → shell PATH → provider credentials → proxy settings
   */
  private async buildSessionEnv(): Promise<Record<string, string>> {
    const shellEnv = getShellEnvironment()
    const sessionEnv: Record<string, string> = {}

    // Base: current process environment
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) sessionEnv[k] = v
    }

    // Frozen shell PATH (immune to process.env mutations)
    sessionEnv.PATH = shellEnv.path

    // Layer provider credentials (API keys — highest priority)
    const providerEnv = await this.deps.getProviderEnv()
    Object.assign(sessionEnv, providerEnv)

    // Layer proxy settings
    const proxyEnv = this.deps.getProxyEnv()
    for (const key of [
      'https_proxy', 'http_proxy', 'all_proxy',
      'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY',
      'no_proxy', 'NO_PROXY',
    ]) {
      const value = proxyEnv[key]
      if (value) sessionEnv[key] = value
    }

    return sessionEnv
  }
}
