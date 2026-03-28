// SPDX-License-Identifier: Apache-2.0

/**
 * MarketplaceService — orchestrates search, preview, and installation
 * across multiple Skills Marketplace providers (skills.sh, clawhub.ai, …).
 *
 * All dependencies (importer + providers) are injected via the constructor,
 * making the service fully testable without hitting real APIs.
 *
 * For production use, call `MarketplaceService.createDefault(importer)`.
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import type {
  MarketplaceId,
  MarketSearchParams,
  MarketSearchResult,
  MarketBrowseParams,
  MarketSkillDetail,
  MarketInstallResult,
  MarketInstallPreview,
  MarketProviderInfo,
  MarketGroupedSearchResult,
  MarketSearchGroup,
  MarketSkillInfo,
  ManagedCapabilityCategory,
  DataBusEvent,
  MarketAnalysisPhase,
} from '../../../src/shared/types'
import { MARKET_ANALYSIS_TIMEOUT_SEC } from '../../../src/shared/types'
import type {
  MarketplaceProvider,
  MarketplaceSettings,
  MarketplaceImporter,
  MarketplaceImportItem,
  MarketplaceInstallParams,
} from './types'
import { DEFAULT_MARKETPLACE_SETTINGS } from './types'
import { SkillsShAdapter } from './adapters/skillsSh'
import { GitHubAdapter } from './adapters/github'
import { downloadAndExtractRepo } from './utils/tarball'
import { discoverRepoCapabilities } from './utils/repoDiscovery'
import { copySkillBundle } from './utils/bundle'
import { githubHeaders } from './utils/github'
import { probeRepoCapabilities } from './utils/githubContent'
import type { PackageManifest } from '../capabilityCenter/packageStore'
import { createLogger } from '../../platform/logger'
import type { RepoAnalyzer, RepoAnalyzerCapability } from './agentAnalyzer'
import { RepoStructurer } from './agentAnalyzer'
import type { ValidatedManifest, AnalysisProgress } from './agentAnalyzer'
import type { SessionOrchestrator, SessionStartOptions, SessionCompletionResult } from '../../command/sessionOrchestrator'

const log = createLogger('Marketplace')

// ─── Types ──────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

/**
 * Holds Agent analysis results between the `analyze()` (preview) and
 * `install()` (confirm) steps, so we don't re-download / re-analyze.
 */
interface PendingAnalysis {
  /** Local path to the downloaded repo — will be cleaned up after install or TTL expiry */
  tmpDir: string
  repoDir: string
  manifest: ValidatedManifest | null
  detail: MarketSkillDetail
  createdAt: number
}

/** Pending analysis entries expire after 10 minutes (user might close dialog). */
const PENDING_ANALYSIS_TTL_MS = 10 * 60 * 1000

/**
 * Narrow interface for package lifecycle operations.
 *
 * Implemented by PackageService — MarketplaceService never touches
 * PackageStore directly, ensuring DB + cache + event broadcast happen atomically.
 */
export interface PackageInstaller {
  installPackage(params: {
    prefix: string
    repoDir: string
    source: Omit<PackageManifest['source'], 'installedAt'>
    capabilities: PackageManifest['capabilities']
    /** Install target — determines global vs project-scoped storage. */
    target: { scope: 'global' | 'project'; projectId?: string }
  }): Promise<{ prefix: string }>
}

/** Constructor options for MarketplaceService. */
interface MarketplaceServiceOptions {
  importer: MarketplaceImporter
  /** Package installer for multi-capability repo installation (provided by CapabilityCenter). */
  packageInstaller?: PackageInstaller
  /** Providers to register. When omitted, uses the built-in defaults. */
  providers?: MarketplaceProvider[]
  /**
   * Agent-based repo analyzer for capability discovery.
   *
   * When provided, `install()` uses Agent-First analysis (AI examines the repo)
   * instead of programmatic discovery. This handles non-standard repo structures
   * that programmatic heuristics fail on.
   */
  repoAnalyzer?: RepoAnalyzer
  /** DataBus event dispatcher — used to emit real-time analysis progress events. */
  dispatch?: (event: DataBusEvent) => void
  /**
   * Session orchestrator — enables session-based analysis where the user sees
   * the AI conversation in real time via Session Console.
   */
  orchestrator?: SessionOrchestrator
}

/** Maximum cache entries before LRU eviction. */
const MAX_CACHE_ENTRIES = 200

export class MarketplaceService {
  private providers = new Map<MarketplaceId, MarketplaceProvider>()
  private cache = new Map<string, CacheEntry<unknown>>()
  private settings: MarketplaceSettings = DEFAULT_MARKETPLACE_SETTINGS
  private readonly importer: MarketplaceImporter
  private readonly packageInstaller?: PackageInstaller
  private readonly repoAnalyzer?: RepoAnalyzer
  private readonly repoStructurer = new RepoStructurer()
  private readonly dispatch?: (event: DataBusEvent) => void
  private readonly orchestrator?: SessionOrchestrator

  /**
   * Tracks session-based analysis metadata — maps sessionId to capability ref + tmpDir.
   * Used by the completion callback to extract the manifest after the session ends.
   */
  private sessionAnalysisMap = new Map<string, {
    slug: string
    marketplaceId: MarketplaceId
    capability: RepoAnalyzerCapability
    tmpDir: string
    repoDir: string
    detail: MarketSkillDetail
  }>()

  /**
   * Agent analysis results pending installation confirmation.
   * Key: `${marketplaceId}:${slug}` — matches the analyze→install pair.
   * Entries are cleaned up after install completes or TTL expires.
   */
  private pendingAnalysis = new Map<string, PendingAnalysis>()

  /**
   * Active analysis AbortControllers — enables user cancellation.
   * Key: `${marketplaceId}:${slug}` — matches the analyze() call.
   * Entries are cleaned up when analysis completes (success or failure).
   */
  private activeAnalyses = new Map<string, AbortController>()

  constructor(options: MarketplaceServiceOptions) {
    this.importer = options.importer
    this.packageInstaller = options.packageInstaller
    this.repoAnalyzer = options.repoAnalyzer
    this.dispatch = options.dispatch
    this.orchestrator = options.orchestrator
    const adapters = options.providers ?? MarketplaceService.defaultProviders()
    for (const adapter of adapters) {
      this.registerProvider(adapter)
    }
  }

  /**
   * Late-bind the SessionOrchestrator.
   *
   * The orchestrator is created after MarketplaceService during app bootstrap.
   * This setter allows wiring the dependency once the orchestrator is ready.
   */
  setOrchestrator(orchestrator: SessionOrchestrator): void {
    (this as unknown as { orchestrator?: SessionOrchestrator }).orchestrator = orchestrator
  }

  /** Built-in provider set for production use. */
  static defaultProviders(): MarketplaceProvider[] {
    return [
      new SkillsShAdapter(),
      new GitHubAdapter(),
    ]
  }

  /**
   * Apply (or re-apply) marketplace settings from OpenCow preferences.
   * Each provider picks the fields it needs — no adapter-specific logic here.
   */
  applySettings(settings: Partial<MarketplaceSettings>): void {
    this.settings = { ...this.settings, ...settings }
    for (const provider of this.providers.values()) {
      provider.configure(this.settings)
    }
  }

  registerProvider(provider: MarketplaceProvider): void {
    this.providers.set(provider.id, provider)
  }

  /** Remove a dynamically-registered provider and purge its cached data. */
  unregisterProvider(id: MarketplaceId): void {
    this.providers.delete(id)
    // Evict all cache entries belonging to this provider
    for (const key of this.cache.keys()) {
      if (key.includes(id)) this.cache.delete(key)
    }
  }

  // ─── Public API ────────────────────────────────────────────

  async getProviders(): Promise<MarketProviderInfo[]> {
    const enabled = this.settings.enabledProviders
    const results: MarketProviderInfo[] = []

    await Promise.allSettled(
      Array.from(this.providers.values())
        .filter((p) => p.id.startsWith('user-repo:') || enabled.includes(p.id))
        .map(async (p) => {
          const available = await p.checkAvailability().catch(() => false)
          results.push(p.toInfo(available))
        }),
    )

    return results
  }

  /**
   * Search across one or all enabled marketplaces.
   * Returns grouped results — each marketplace has its own status + items.
   */
  async search(params: MarketSearchParams): Promise<MarketGroupedSearchResult> {
    if (!this.settings.enabled) return []

    const cacheKey = `search:${JSON.stringify(params)}`
    const cached = this.getFromCache<MarketGroupedSearchResult>(cacheKey)
    if (cached) return cached

    const providers = this.getActiveProviders(params.marketplaceId)
    if (providers.length === 0) return []

    const groups = await Promise.all(
      providers.map(async (p): Promise<MarketSearchGroup> => {
        try {
          const response = await p.search(params)
          return {
            marketplaceId: p.id,
            displayName: p.displayName,
            status: response.status,
            results: response.results.items,
            total: response.results.total,
            hasMore: response.results.hasMore,
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          log.warn(`Marketplace search failed for ${p.id}: ${message}`)
          return {
            marketplaceId: p.id,
            displayName: p.displayName,
            status: { state: 'error', message },
            results: [],
            total: 0,
            hasMore: false,
          }
        }
      }),
    )

    this.setCache(cacheKey, groups)
    return groups
  }

  async browse(params: MarketBrowseParams): Promise<MarketSearchResult> {
    const provider = this.providers.get(params.marketplaceId)
    if (!provider) throw new Error(`Unknown marketplace: ${params.marketplaceId}`)

    const cacheKey = `browse:${JSON.stringify(params)}`
    const cached = this.getFromCache<MarketSearchResult>(cacheKey)
    if (cached) return cached

    const result = await provider.browse(params)
    this.setCache(cacheKey, result)
    return result
  }

  async getDetail(slug: string, marketplaceId: MarketplaceId): Promise<MarketSkillDetail> {
    const provider = this.providers.get(marketplaceId)
    if (!provider) throw new Error(`Unknown marketplace: ${marketplaceId}`)

    const cacheKey = `detail:${marketplaceId}:${slug}`
    const cached = this.getFromCache<MarketSkillDetail>(cacheKey)
    if (cached) return cached

    const detail = await provider.getDetail(slug)
    this.setCache(cacheKey, detail)
    return detail
  }

  /**
   * Pre-install analysis — probe a repo's capability structure.
   *
   * When Agent-First mode is active (`repoAnalyzer` available):
   *   1. Download the full repo
   *   2. Agent analyzes the repo (AI-powered, handles non-standard layouts)
   *   3. Cache the manifest + repo for the subsequent install() call
   *   4. Return a MarketInstallPreview derived from Agent results
   *
   * When Agent is unavailable (legacy mode):
   *   Uses lightweight GitHub Contents API probing (2–5 requests, < 1s).
   */
  async analyze(
    slug: string,
    marketplaceId: MarketplaceId,
  ): Promise<MarketInstallPreview> {
    const provider = this.providers.get(marketplaceId)
    if (!provider) throw new Error(`Unknown marketplace: ${marketplaceId}`)

    const cacheKey = `analyze:${marketplaceId}:${slug}`
    const cached = this.getFromCache<MarketInstallPreview>(cacheKey)
    if (cached) return cached

    // Clean up stale pending analyses before starting a new one
    this.cleanupStalePendingAnalysis()

    let result: MarketInstallPreview

    if (this.repoAnalyzer && this.orchestrator) {
      // ── Agent analysis via visible session ─────────────────────
      result = await this.analyzeViaSession(slug, marketplaceId)
    } else if (provider.probeCapabilities) {
      // Provider declares multi-capability probing support (e.g. UserRepoProvider)
      result = await provider.probeCapabilities(slug)
    } else if (isGitHubBacked(marketplaceId)) {
      // Built-in GitHub-backed providers — legacy Contents API probing
      result = await this.probeGitHubCapabilities(slug)
    } else {
      // Other providers — fallback to single skill
      const detail = await provider.getDetail(slug)
      result = {
        isMultiCapability: false,
        capabilities: [{ name: detail.name, category: 'skill' }],
        skipped: [],
        probeStatus: 'ok',
      }
    }

    this.setCache(cacheKey, result)
    return result
  }

  // ─── Session-Based Analysis (replaces black-box Agent call) ────────────

  /**
   * Start a visible analysis session via SessionOrchestrator.
   *
   * The user sees the AI conversation in real time in the InstallDialog.
   * When the Agent submits its manifest (via submit_manifest tool), the
   * `onComplete` callback extracts the result and emits a DataBus event.
   *
   * @returns sessionId — used by the frontend to subscribe to the session.
   * @throws If orchestrator or repoAnalyzer is not available.
   */
  async startAnalysisSession(
    slug: string,
    marketplaceId: MarketplaceId,
  ): Promise<{ sessionId: string }> {
    if (!this.orchestrator) throw new Error('SessionOrchestrator not available')
    if (!this.repoAnalyzer) throw new Error('RepoAnalyzer not available')

    const provider = this.providers.get(marketplaceId)
    if (!provider) throw new Error(`Unknown marketplace: ${marketplaceId}`)

    // Cancel any previous analysis for this slug
    this.cancelAnalysis(slug, marketplaceId)

    // Fetch detail for context
    const detail = await provider.getDetail(slug)

    // Download the full repo
    const tmpDir = path.join(os.tmpdir(), `opencow-analyze-${crypto.randomUUID()}`)
    await fs.mkdir(tmpDir, { recursive: true })

    this.emitAnalyzeProgress(slug, 'downloading', 'Downloading repository…')

    const repoDir = await this.downloadFullRepo(
      provider,
      { slug, marketplaceId, scope: 'global' } as MarketplaceInstallParams,
      tmpDir,
    )

    // Prepare session configuration via RepoAnalyzer (SRP: it owns the tools + prompts)
    const prepared = await this.repoAnalyzer.prepareSession({
      repoDir,
      marketDetail: {
        name: detail.name,
        description: detail.description,
        author: detail.author,
        repoUrl: detail.repoUrl,
      },
    })

    // Start the visible session — projectPath sets the SDK subprocess cwd
    // so the Agent's sandboxed tools (read_file, list_directory) resolve
    // paths relative to the downloaded repository.
    // customTools (engine-agnostic): SessionOrchestrator handles injection per engine
    // - Claude: creates in-process MCP server
    // - Codex:  registers via CodexNativeBridgeManager HTTP bridge
    const sessionInput: SessionStartOptions = {
      prompt: prepared.userMessage,
      origin: { source: 'market-analyzer', slug, marketplaceId },
      systemPrompt: prepared.systemPrompt,
      projectPath: repoDir,
      customTools: { name: prepared.toolServerName, tools: prepared.tools },
      onComplete: (result) => this.handleAnalysisComplete(sessionId, result),
    }

    const sessionId = await this.orchestrator.startSession(sessionInput)

    // Store session metadata for the completion callback
    this.sessionAnalysisMap.set(sessionId, {
      slug,
      marketplaceId,
      capability: prepared.capability,
      tmpDir,
      repoDir,
      detail,
    })

    return { sessionId }
  }

  /**
   * Handle session completion — extract manifest, validate, store, and notify.
   *
   * Called by SessionOrchestrator's onComplete callback when the analysis
   * session's lifecycle ends (Agent finished, errored, or was stopped).
   */
  private handleAnalysisComplete(sessionId: string, result: SessionCompletionResult): void {
    const meta = this.sessionAnalysisMap.get(sessionId)
    if (!meta) {
      log.warn(`Analysis complete for unknown session ${sessionId}`)
      return
    }

    this.sessionAnalysisMap.delete(sessionId)
    const pendingKey = `${meta.marketplaceId}:${meta.slug}`

    try {
      // If the session ended with an error (timeout, crash, user stop),
      // treat it as a failed analysis — don't silently return empty preview.
      if (result.error) {
        throw new Error(`Analysis session failed: ${result.error}`)
      }

      // Extract manifest from the capability instance
      const agentManifest = meta.capability.getSubmittedManifest()
      log.info(`Session ${sessionId} for ${meta.slug}: submit_manifest ${agentManifest ? 'received' : 'NOT received'}, stopReason=${result.stopReason}`)

      // Validate
      let manifest: ValidatedManifest | null = null
      if (agentManifest) {
        manifest = this.repoAnalyzer!.getValidator().validate(agentManifest, meta.repoDir)
        log.info(
          `Session analysis for ${meta.slug}: `
          + `${manifest.capabilities.length} valid, ${manifest.rejected.length} rejected`,
        )
      } else {
        log.info(`Session analysis for ${meta.slug}: no capabilities found`)
      }

      // Store in pendingAnalysis for the install() call
      this.pendingAnalysis.set(pendingKey, {
        tmpDir: meta.tmpDir,
        repoDir: meta.repoDir,
        manifest,
        detail: meta.detail,
        createdAt: Date.now(),
      })

      // Convert to MarketInstallPreview
      const preview = this.manifestToPreview(manifest)

      // Notify frontend
      this.dispatch?.({
        type: 'market:analysis:complete',
        payload: {
          sessionId,
          slug: meta.slug,
          marketplaceId: meta.marketplaceId,
          preview,
        },
      })

      // Resolve pending analyzeViaSession() caller (if any)
      const resolver = this.pendingSessionResolvers.get(pendingKey)
      if (resolver) {
        this.pendingSessionResolvers.delete(pendingKey)
        resolver.resolve(preview)
      }
    } catch (err) {
      log.error(`Failed to process analysis result for ${meta.slug}`, err)

      // Clean up tmpDir on error
      fs.rm(meta.tmpDir, { recursive: true, force: true }).catch(() => {})

      // Notify frontend of error
      this.dispatch?.({
        type: 'market:analysis:complete',
        payload: {
          sessionId,
          slug: meta.slug,
          marketplaceId: meta.marketplaceId,
          preview: null,
          error: err instanceof Error ? err.message : String(err),
        },
      })

      // Reject pending analyzeViaSession() caller (if any)
      const resolver = this.pendingSessionResolvers.get(pendingKey)
      if (resolver) {
        this.pendingSessionResolvers.delete(pendingKey)
        resolver.reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  /**
   * Convert ValidatedManifest → MarketInstallPreview.
   *
   * Extracted as a method to be shared between session-based and legacy analysis paths.
   */
  private manifestToPreview(manifest: ValidatedManifest | null): MarketInstallPreview {
    if (!manifest || manifest.capabilities.length === 0) {
      return {
        isMultiCapability: false,
        capabilities: [],
        skipped: manifest?.rejected.map(r => ({
          dir: r.sourcePath,
          reason: r.issues.join('; '),
        })) ?? [],
        probeStatus: 'ok',
        probeMessage: manifest?.reasoning ?? 'Agent found no installable capabilities in this repository.',
      }
    }

    return {
      isMultiCapability: manifest.capabilities.length > 1,
      capabilities: manifest.capabilities.map(cap => ({
        name: cap.name,
        category: cap.category,
      })),
      skipped: manifest.rejected.map(r => ({
        dir: r.sourcePath,
        reason: r.issues.join('; '),
      })),
      probeStatus: 'ok',
    }
  }

  // ─── Session-Based Agent Analysis (bridges sync analyze() with async session) ──

  /**
   * Pending resolve/reject callbacks for `analyzeViaSession()` callers.
   * Keyed by `${marketplaceId}:${slug}`.
   *
   * When `handleAnalysisComplete()` fires, it checks this map and resolves
   * the pending Promise, bridging the async session completion back to the
   * synchronous `analyze()` contract.
   */
  private pendingSessionResolvers = new Map<string, {
    resolve: (preview: MarketInstallPreview) => void
    reject: (error: Error) => void
  }>()

  /**
   * Start a visible analysis session and wait for completion.
   *
   * Bridges the synchronous `analyze()` contract (returns MarketInstallPreview)
   * with the async session-based analysis (event-driven completion).
   *
   * Data flow:
   *   1. startAnalysisSession() → downloads repo, starts visible session
   *   2. SessionOrchestrator runs Agent → onComplete callback fires
   *   3. handleAnalysisComplete() → stores pendingAnalysis + resolves this Promise
   */
  private async analyzeViaSession(
    slug: string,
    marketplaceId: MarketplaceId,
  ): Promise<MarketInstallPreview> {
    const key = `${marketplaceId}:${slug}`

    // Create a Promise that will be resolved by handleAnalysisComplete()
    const resultPromise = new Promise<MarketInstallPreview>((resolve, reject) => {
      this.pendingSessionResolvers.set(key, { resolve, reject })
    })

    // Safety timeout — prevents indefinite hang if onComplete never fires
    // (e.g. SessionOrchestrator internal error, session cleanup without callback)
    const timeoutMs = MARKET_ANALYSIS_TIMEOUT_SEC * 1000 + 30_000 // analysis timeout + 30s buffer
    const timeoutId = setTimeout(() => {
      const resolver = this.pendingSessionResolvers.get(key)
      if (resolver) {
        this.pendingSessionResolvers.delete(key)
        resolver.reject(new Error(`Analysis session for "${slug}" timed out waiting for completion`))
      }
    }, timeoutMs)

    // Clear timeout when Promise settles (either resolve or reject)
    const guarded = resultPromise.finally(() => clearTimeout(timeoutId))

    try {
      // Start the visible session (reuses entire startAnalysisSession flow:
      // repo download, prepareSession, orchestrator.startSession)
      await this.startAnalysisSession(slug, marketplaceId)
    } catch (err) {
      clearTimeout(timeoutId)
      this.pendingSessionResolvers.delete(key)
      throw err
    }

    // Wait for handleAnalysisComplete() to resolve the Promise
    return guarded
  }

  /**
   * Fallback probe when Agent analysis fails — uses lightweight methods
   * (GitHub Contents API or single skill metadata).
   */
  private async analyzeFallbackProbe(
    slug: string,
    marketplaceId: MarketplaceId,
    provider: MarketplaceProvider,
  ): Promise<MarketInstallPreview> {
    if (provider.probeCapabilities) {
      return provider.probeCapabilities(slug)
    }
    if (isGitHubBacked(marketplaceId)) {
      return this.probeGitHubCapabilities(slug)
    }
    const detail = await provider.getDetail(slug)
    return {
      isMultiCapability: false,
      capabilities: [{ name: detail.name, category: 'skill' }],
      skipped: [],
      probeStatus: 'degraded',
      probeMessage: 'Agent analysis unavailable — using lightweight probe.',
    }
  }

  /**
   * Extract GitHub coordinates from slug and probe via Contents API.
   */
  private async probeGitHubCapabilities(slug: string): Promise<MarketInstallPreview> {
    const parts = slug.split('/')
    if (parts.length < 2) {
      return {
        isMultiCapability: false,
        capabilities: [{ name: slug, category: 'skill' }],
        skipped: [],
        probeStatus: 'degraded',
        probeMessage: `Invalid slug format: "${slug}" (expected "owner/repo")`,
      }
    }
    return probeRepoCapabilities({
      owner: parts[0],
      repo: parts[1],
      headers: githubHeaders(this.settings.githubToken),
    })
  }

  /**
   * Install a skill bundle — uses cached Agent analysis from `analyze()` when
   * available, otherwise downloads and analyzes from scratch.
   *
   * When Agent-First mode is active and analyze() was called first:
   *   1. Reuse cached manifest + downloaded repo from analyze()
   *   2. RepoStructurer creates staging directory with standard layout
   *   3. PackageInstaller installs from staging directory
   *
   * When Agent-First mode is active but no cached analysis:
   *   1. Download repo
   *   2. Agent analyzes repo → ValidatedManifest
   *   3. RepoStructurer + PackageInstaller as above
   *
   * When Agent is unavailable (legacy mode):
   *   Falls back to programmatic discovery (discoverRepoCapabilities).
   */
  async install(params: MarketplaceInstallParams): Promise<MarketInstallResult> {
    const provider = this.providers.get(params.marketplaceId)
    if (!provider) throw new Error(`Unknown marketplace: ${params.marketplaceId}`)

    // ── Check for pending Agent analysis from analyze() step ──────
    const pendingKey = `${params.marketplaceId}:${params.slug}`
    const pending = this.consumePendingAnalysis(pendingKey)

    if (pending) {
      log.info(`Using cached Agent analysis for "${params.slug}" (from analyze step)`)
      return this.installFromPendingAnalysis(params, pending)
    }

    // ── No cached analysis — run analysis first, then install ────
    // When Agent + Orchestrator are available, trigger a visible analysis session
    // which populates pendingAnalysis. Then consume the result.
    if (this.repoAnalyzer && this.orchestrator) {
      await this.analyzeViaSession(params.slug, params.marketplaceId)

      const freshPending = this.consumePendingAnalysis(pendingKey)
      if (freshPending) {
        return this.installFromPendingAnalysis(params, freshPending)
      }
    }

    // ── Legacy fallback: programmatic discovery (no Agent) ────────
    const detail = await provider.getDetail(params.slug)
    const marketInfo: MarketSkillInfo = {
      marketplaceId: params.marketplaceId,
      slug: params.slug,
      version: detail.version,
      repoUrl: detail.repoUrl,
      author: detail.author,
      installs: detail.installs,
    }

    const tmpDir = path.join(
      os.tmpdir(),
      `opencow-market-${crypto.randomUUID()}`,
    )
    await fs.mkdir(tmpDir, { recursive: true })

    try {
      const repoDir = await this.downloadFullRepo(provider, params, tmpDir)
      return await this.installViaProgrammatic(params, detail, marketInfo, repoDir, tmpDir)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** Atomically consume a pending analysis entry (remove from map and return). */
  private consumePendingAnalysis(pendingKey: string): PendingAnalysis | null {
    const pending = this.pendingAnalysis.get(pendingKey)
    if (!pending) return null
    this.pendingAnalysis.delete(pendingKey)
    return pending
  }

  /**
   * Install from a consumed `PendingAnalysis` entry.
   *
   * Handles both "has capabilities" (installFromAgentManifest) and
   * "no capabilities" (return failure) cases. Always cleans up tmpDir.
   */
  private async installFromPendingAnalysis(
    params: MarketplaceInstallParams,
    pending: PendingAnalysis,
  ): Promise<MarketInstallResult> {
    try {
      if (pending.manifest && pending.manifest.capabilities.length > 0) {
        return await this.installFromAgentManifest(
          params, pending.detail, pending.manifest,
          pending.repoDir, pending.tmpDir,
        )
      }
      return {
        success: false,
        installedPath: '',
        name: pending.detail.name,
        version: pending.detail.version,
        marketplaceId: params.marketplaceId,
        sourceSlug: params.slug,
        importedCount: 0,
        importedNames: [],
      }
    } finally {
      await fs.rm(pending.tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * Install from an already-validated Agent manifest.
   *
   * Used by the `install()` method after consuming a `pendingAnalysis` entry
   * populated by either `analyzeViaSession()` or `handleAnalysisComplete()`.
   */
  private async installFromAgentManifest(
    params: MarketplaceInstallParams,
    detail: MarketSkillDetail,
    manifest: ValidatedManifest,
    repoDir: string,
    tmpDir: string,
  ): Promise<MarketInstallResult> {
    // Derive namespace prefix
    const prefix = params.namespacePrefix
      ?? manifest.packageName
      ?? params.slug.split('/').pop()
      ?? detail.name

    // Structure the repo into the canonical package layout
    const stagingDir = path.join(tmpDir, '__staging__')
    await fs.mkdir(stagingDir, { recursive: true })

    const structured = await this.repoStructurer.prepare({
      repoDir,
      manifest,
      stagingDir,
    })

    if (Object.keys(structured.capabilities).length === 0) {
      log.warn(`RepoStructurer produced no capabilities for "${params.slug}" — all items failed`)
      return {
        success: false,
        installedPath: '',
        name: detail.name,
        version: detail.version,
        marketplaceId: params.marketplaceId,
        sourceSlug: params.slug,
        importedCount: 0,
        importedNames: [],
      }
    }

    // Install via PackageInstaller (preferred) or scatter import (fallback)
    if (this.packageInstaller) {
      return this.installPackage(params, detail, prefix, structured, manifest)
    }

    return this.installScatter(params, detail, manifest, repoDir)
  }

  /**
   * Install via PackageInstaller — creates a namespaced package with all capabilities.
   */
  private async installPackage(
    params: MarketplaceInstallParams,
    detail: MarketSkillDetail,
    prefix: string,
    structured: { stagingDir: string; capabilities: Partial<Record<ManagedCapabilityCategory, string[]>> },
    _manifest: ValidatedManifest,
  ): Promise<MarketInstallResult> {
    const result = await this.packageInstaller!.installPackage({
      prefix,
      repoDir: structured.stagingDir,
      source: {
        marketplaceId: params.marketplaceId,
        slug: params.slug,
        version: detail.version,
        repoUrl: detail.repoUrl,
        author: detail.author,
      },
      capabilities: structured.capabilities,
      target: { scope: params.scope, projectId: params.projectId },
    })

    const importedNames = Object.entries(structured.capabilities).flatMap(
      ([, names]) => names.map(name => `${result.prefix}:${name}`),
    )

    return {
      success: true,
      installedPath: '',
      name: detail.name,
      version: detail.version,
      marketplaceId: params.marketplaceId,
      sourceSlug: params.slug,
      importedCount: importedNames.length,
      importedNames,
    }
  }

  /**
   * Scatter import fallback — imports each capability individually via the importer.
   * Used when PackageInstaller is not available.
   */
  private async installScatter(
    params: MarketplaceInstallParams,
    detail: MarketSkillDetail,
    manifest: ValidatedManifest,
    repoDir: string,
  ): Promise<MarketInstallResult> {
    const items: MarketplaceImportItem[] = manifest.capabilities.map(cap => ({
      name: cap.name,
      category: cap.category,
      description: cap.description,
      sourcePath: path.resolve(repoDir, cap.sourcePath),
      sourceType: 'marketplace' as const,
      alreadyImported: false as const,
      sourceScope: params.scope,
      isBundle: cap.category === 'skill',
      marketInfo: {
        marketplaceId: params.marketplaceId,
        slug: params.slug,
        version: detail.version,
        repoUrl: detail.repoUrl,
        author: detail.author,
        installs: detail.installs,
      },
    }))

    const result = await this.importer.importItems(
      items,
      { scope: params.scope, projectId: params.projectId },
    )

    assertImportSuccess(result)

    return {
      success: result.imported.length > 0,
      installedPath: '',
      name: detail.name,
      version: detail.version,
      marketplaceId: params.marketplaceId,
      sourceSlug: params.slug,
      importedCount: result.imported.length,
      importedNames: result.imported,
    }
  }

  /**
   * Legacy programmatic installation path.
   *
   * Uses heuristic-based discovery (discoverRepoCapabilities) for repos
   * when Agent analysis is not available.
   */
  private async installViaProgrammatic(
    params: MarketplaceInstallParams,
    detail: MarketSkillDetail,
    marketInfo: MarketSkillInfo,
    repoDir: string,
    tmpDir: string,
  ): Promise<MarketInstallResult> {
    const discovery = await discoverRepoCapabilities(repoDir, marketInfo, params.scope)

    if (discovery.isMultiCapability && discovery.items.length > 0) {
      // Derive namespace prefix: user-specified > repo name > slug last part
      const prefix = params.namespacePrefix
        ?? params.slug.split('/').pop()
        ?? detail.name

      log.info(
        `Multi-capability repo "${params.slug}": ${discovery.items.length} capabilities, ` +
        `prefix="${prefix}"` +
        (discovery.skipped.length > 0 ? `, skipped: ${discovery.skipped.join('; ')}` : ''),
      )

      // Build capabilities map from discovery items
      const capabilitiesMap: Partial<Record<ManagedCapabilityCategory, string[]>> = {}
      for (const item of discovery.items) {
        if (!capabilitiesMap[item.category]) {
          capabilitiesMap[item.category] = []
        }
        capabilitiesMap[item.category]!.push(item.name)
      }

      if (this.packageInstaller) {
        try {
          const result = await this.packageInstaller.installPackage({
            prefix,
            repoDir,
            source: {
              marketplaceId: params.marketplaceId,
              slug: params.slug,
              version: detail.version,
              repoUrl: detail.repoUrl,
              author: detail.author,
            },
            capabilities: capabilitiesMap,
            target: { scope: params.scope, projectId: params.projectId },
          })

          const importedNames = discovery.items.map(item => `${result.prefix}:${item.name}`)

          return {
            success: true,
            installedPath: '',
            name: detail.name,
            version: detail.version,
            marketplaceId: params.marketplaceId,
            sourceSlug: params.slug,
            importedCount: importedNames.length,
            importedNames,
          }
        } catch (pkgErr) {
          log.warn(`Package install failed for "${prefix}", falling back to scatter import:`, pkgErr)
        }
      }

      const result = await this.importer.importItems(
        discovery.items,
        { scope: params.scope, projectId: params.projectId },
      )

      assertImportSuccess(result)

      return {
        success: result.imported.length > 0,
        installedPath: '',
        name: detail.name,
        version: detail.version,
        marketplaceId: params.marketplaceId,
        sourceSlug: params.slug,
        importedCount: result.imported.length,
        importedNames: result.imported,
      }
    }

    // Single-skill fallback (original behavior)
    const skillDir = path.join(tmpDir, '__skill__')
    await fs.mkdir(skillDir, { recursive: true })
    await copySkillBundle(repoDir, skillDir)

    const skillMdPath = path.join(skillDir, 'SKILL.md')
    const hasSkillMd = await fs.access(skillMdPath).then(() => true).catch(() => false)
    if (!hasSkillMd) {
      log.info('SKILL.md not found in downloaded bundle — generating from metadata')
      await fs.writeFile(
        skillMdPath,
        generateSkillMd(detail.name, detail.description, detail.author),
        'utf-8',
      )
    }

    const importItem: MarketplaceImportItem = {
      name: detail.name,
      category: 'skill',
      description: detail.description,
      sourcePath: skillMdPath,
      sourceType: 'marketplace',
      alreadyImported: false as const,
      sourceScope: params.scope,
      isBundle: true,
      marketInfo,
    }

    const result = await this.importer.importItems(
      [importItem],
      { scope: params.scope, projectId: params.projectId },
    )

    assertImportSuccess(result)

    return {
      success: result.imported.length > 0,
      installedPath: '',
      name: detail.name,
      version: detail.version,
      marketplaceId: params.marketplaceId,
      sourceSlug: params.slug,
    }
  }

  /**
   * Download the full repo, preserving directory structure for multi-capability detection.
   *
   * For GitHub-backed providers (github, skills.sh), downloads tarball and extracts
   * the complete tree. For other providers, uses their standard download().
   */
  private async downloadFullRepo(
    provider: MarketplaceProvider,
    params: MarketplaceInstallParams,
    tmpDir: string,
  ): Promise<string> {
    if (isGitHubBacked(params.marketplaceId)) {
      const parts = params.slug.split('/')
      if (parts.length < 2) throw new Error(`Invalid slug: ${params.slug}`)
      return downloadAndExtractRepo({
        owner: parts[0],
        repo: parts[1],
        headers: githubHeaders(this.settings.githubToken),
        targetDir: tmpDir,
      })
    }

    // Non-GitHub providers: use standard download (preserves whatever structure they have)
    await provider.download(params.slug, tmpDir)
    return tmpDir
  }

  async checkUpdates(): Promise<
    Array<{
      name: string
      currentVersion?: string
      latestVersion?: string
      marketplaceId: MarketplaceId
      slug: string
    }>
  > {
    // TODO: implement when StateRepository exposes marketplace provenance
    return []
  }

  /**
   * Cancel an in-flight analysis.
   *
   * Aborts the AbortController for the given slug, which:
   *   1. Closes the SDK stream (if analysis phase)
   *   2. Causes analyzeViaAgent() to throw a cancellation error
   *   3. Cleans up the temp directory
   *
   * Safe to call at any time — no-op if no analysis is active for this slug.
   */
  cancelAnalysis(slug: string, marketplaceId: MarketplaceId): void {
    const key = `${marketplaceId}:${slug}`
    const controller = this.activeAnalyses.get(key)
    if (controller) {
      log.info(`Cancelling analysis for "${slug}"`)
      controller.abort()
      this.activeAnalyses.delete(key)
    }
  }

  /**
   * Emit a DataBus event for real-time analysis progress.
   *
   * Extracted as a method to avoid re-creating closures per analysis call,
   * and to keep progress emission consistent across the class.
   */
  private emitAnalyzeProgress(
    slug: string,
    phase: MarketAnalysisPhase,
    detail?: string,
    toolName?: string,
    errorKind?: string,
  ): void {
    this.dispatch?.({
      type: 'market:analyze:progress',
      payload: { slug, phase, detail, toolName, errorKind },
    })
  }

  dispose(): void {
    this.cache.clear()
    // Cancel all active analyses
    for (const controller of this.activeAnalyses.values()) {
      controller.abort()
    }
    this.activeAnalyses.clear()
    // Clean up all pending analysis temp directories
    for (const pending of this.pendingAnalysis.values()) {
      fs.rm(pending.tmpDir, { recursive: true, force: true }).catch(() => {})
    }
    this.pendingAnalysis.clear()
  }

  // ─── Private ───────────────────────────────────────────────

  /**
   * Remove pending analysis entries older than PENDING_ANALYSIS_TTL_MS.
   * Called before starting a new analysis to prevent temp dir accumulation.
   */
  private cleanupStalePendingAnalysis(): void {
    const now = Date.now()
    for (const [key, pending] of this.pendingAnalysis) {
      if (now - pending.createdAt > PENDING_ANALYSIS_TTL_MS) {
        log.debug(`Cleaning up stale pending analysis: ${key}`)
        fs.rm(pending.tmpDir, { recursive: true, force: true }).catch(() => {})
        this.pendingAnalysis.delete(key)
      }
    }
  }

  private getActiveProviders(targetId?: MarketplaceId): MarketplaceProvider[] {
    if (targetId) {
      const p = this.providers.get(targetId)
      return p ? [p] : []
    }
    // Built-in providers must be in enabledProviders; dynamic user-repo
    // providers are always active (gated by their own enabled flag).
    return Array.from(this.providers.values()).filter((p) =>
      p.id.startsWith('user-repo:') || this.settings.enabledProviders.includes(p.id),
    )
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }
    // Move to end for LRU ordering (Map preserves insertion order)
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.data
  }

  private setCache(key: string, data: unknown): void {
    // Evict expired + overflow entries before inserting
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      this.evictCache()
    }
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.settings.cacheMinutes * 60_000,
    })
  }

  /** Remove expired entries, then evict oldest (LRU) until under limit. */
  private evictCache(): void {
    const now = Date.now()
    // Pass 1: purge all expired
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(key)
    }
    // Pass 2: if still over limit, evict oldest (first in Map = least recently used)
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const toRemove = this.cache.size - MAX_CACHE_ENTRIES + 1
      const iter = this.cache.keys()
      for (let i = 0; i < toRemove; i++) {
        const key = iter.next().value
        if (key !== undefined) this.cache.delete(key)
      }
    }
  }
}

// ─── Module-level helpers ─────────────────────────────────────────────

/** Throw on import failure — shared by multi-capability and single-skill paths. */
function assertImportSuccess(result: { imported: string[]; errors: Array<{ error: string }> }): void {
  if (result.imported.length === 0 && result.errors.length > 0) {
    throw new Error(`Import failed: ${result.errors[0].error}`)
  }
}

const GITHUB_BACKED_IDS: ReadonlySet<string> = new Set(['github', 'skills.sh'])

/** Check whether a marketplace provider downloads from GitHub repos. */
function isGitHubBacked(id: MarketplaceId): boolean {
  return GITHUB_BACKED_IDS.has(id)
}

/**
 * Generate a minimal SKILL.md from marketplace metadata.
 *
 * Some marketplace repos (especially skills.sh) don't ship a SKILL.md file.
 * The import pipeline requires one, so we synthesise it from the detail API
 * response which always has name + description.
 */
function generateSkillMd(name: string, description: string, author?: string): string {
  const lines: string[] = [
    '---',
    `name: ${name}`,
  ]
  if (description) lines.push(`description: ${JSON.stringify(description)}`)
  if (author) lines.push(`author: ${author}`)
  lines.push('---', '', `# ${name}`, '')
  if (description) lines.push(description, '')
  return lines.join('\n')
}

// ─── Cancellation Detection ────────────────────────────────────────────

/**
 * Check whether an error is a user-initiated cancellation.
 *
 * Single source of truth for cancellation detection — called in the
 * unified catch block of analyzeViaAgent() instead of duplicating
 * the check in per-phase catch blocks.
 */
function isCancellationError(signal: AbortSignal, err: unknown): boolean {
  if (signal.aborted) return true
  return err instanceof Error && err.message === 'Analysis cancelled'
}

// ─── Error Classification ──────────────────────────────────────────────

/** Analysis error categories — propagated to DataBus events for UI display. */
type AnalysisErrorKind = 'timeout' | 'network' | 'auth' | 'sdk-error' | 'unknown'

/**
 * Classify an analysis error for logging and user feedback.
 *
 * The result is:
 *   1. Logged for diagnostics
 *   2. Included in the DataBus 'cancelled' event payload as `errorKind`
 *      so the renderer can show targeted error messages in future
 *
 * Cancellation is handled separately (checked before this is called).
 */
function classifyAnalysisError(err: unknown): AnalysisErrorKind {
  const msg = err instanceof Error ? err.message : String(err)
  if (/timed?\s*out/i.test(msg)) return 'timeout'
  if (/fetch|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket/i.test(msg)) return 'network'
  if (/401|403|api.key|unauthorized|authentication|forbidden/i.test(msg)) return 'auth'
  if (/sdk|child.process|spawn|ENOENT/i.test(msg)) return 'sdk-error'
  return 'unknown'
}
