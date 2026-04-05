// SPDX-License-Identifier: Apache-2.0

/**
 * RepoAnalyzer — prepares Agent-driven repository analysis sessions.
 *
 * Responsibilities:
 *   - Create sandboxed filesystem tools (RepoAnalyzerCapability)
 *   - Build MCP server configuration for analysis sessions
 *   - Generate repo tree for the initial prompt
 *   - Validate and cache analysis results (ManifestValidator, ManifestCache)
 *
 * All analysis execution goes through SessionOrchestrator — RepoAnalyzer
 * does NOT call LLM APIs directly. It prepares the session configuration
 * and the caller (MarketplaceService) starts the session.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { ToolProgressRelay } from '../../../utils/toolProgressRelay'
import { createLogger } from '../../../platform/logger'
import type { NativeCapabilityToolContext, NativeToolDescriptor } from '../../../nativeCapabilities/types'
import { RepoAnalyzerCapability } from './repoAnalyzerCapability'
import { ManifestValidator } from './manifestValidator'
import { ManifestCache } from './manifestCache'
import { REPO_ANALYZER_SYSTEM_PROMPT, buildAnalysisUserMessage } from './systemPrompt'
import type { RepoAnalysisParams } from './types'
import type { ValidatedManifest } from './types'

const log = createLogger('RepoAnalyzer')

// ─── Constants ──────────────────────────────────────────────────────────────

/** MCP server name for the analysis tools. */
const ANALYZER_MCP_SERVER_NAME = 'repo-analyzer'

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
  /** Engine-agnostic tool descriptors — SessionOrchestrator injects per engine */
  tools: NativeToolDescriptor[]
  /** MCP server name for the custom tools */
  toolServerName: string
  /** System prompt for the analysis Agent */
  systemPrompt: string
  /** Initial user message (marketplace metadata + pre-scanned repo tree) */
  userMessage: string
  /** Reference to the capability instance — used to extract manifest after session completes */
  capability: RepoAnalyzerCapability
}

// ─── RepoAnalyzer ───────────────────────────────────────────────────────────

export class RepoAnalyzer {
  private readonly cache = new ManifestCache()
  private readonly validator = new ManifestValidator()

  // ── Public: Session Preparation ──────────────────────────────────────

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

    // 2. Build tool context for tool descriptor extraction
    const toolContext: NativeCapabilityToolContext = {
      session: { sessionId: `analysis-${Date.now()}`, projectId: null, issueId: null, originSource: 'market-analyzer' },
      relay: new ToolProgressRelay(),
    }

    // 3. Get engine-agnostic tool descriptors (NativeToolDescriptor[])
    // SessionOrchestrator handles engine-specific injection:
    // - Claude: toClaudeToolDefinitions() → createSdkMcpServer() → in-process MCP
    // - Codex:  CodexNativeBridgeManager → HTTP bridge → stdio MCP
    const tools = capability.getToolDescriptors(toolContext)

    // 4. Pre-scan repo tree for inclusion in the initial prompt
    const repoTree = await RepoAnalyzer.generateRepoTree(params.repoDir)

    // 5. Build user message with marketplace metadata + repo tree
    const userMessage = buildAnalysisUserMessage({
      ...params.marketDetail,
      repoTree,
    })

    return {
      tools,
      toolServerName: ANALYZER_MCP_SERVER_NAME,
      systemPrompt: REPO_ANALYZER_SYSTEM_PROMPT,
      userMessage,
      capability,
    }
  }

  // ── Public: Validation & Cache ──────────────────────────────────────

  /** Get the manifest validator instance (used by MarketplaceService for result processing). */
  getValidator(): ManifestValidator {
    return this.validator
  }

  /** Check cache for a previously validated manifest. */
  getCached(key: RepoAnalysisParams['cacheKey']): ValidatedManifest | null {
    return this.cache.get(key)
  }

  /** Store a validated manifest in cache. */
  setCached(key: RepoAnalysisParams['cacheKey'], manifest: ValidatedManifest): void {
    this.cache.set(key, manifest)
  }

  /** Invalidate a specific cache entry (e.g. when user requests re-analysis). */
  invalidateCache(key: RepoAnalysisParams['cacheKey']): void {
    this.cache.invalidate(key)
  }

  /** Clear all cached analysis results. */
  clearCache(): void {
    this.cache.clear()
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
}
