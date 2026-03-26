// SPDX-License-Identifier: Apache-2.0

/**
 * Capability Center — unified facade for the capability management subsystem.
 *
 * v3.1 fixes:
 *   #8  — config.db is Kysely<Database>
 *   #12 — startWatching() monitors all 6 category directories + DataBus broadcast
 *   #23 — all internal pipelines are private, only facade methods exposed
 *   #24 — DataBus 'capabilities:changed' broadcast on file/state changes
 *
 * Architecture:
 *   CapabilityCenter (this file)
 *     ├── CapabilityStore       — file-system store (M1)
 *     ├── StateRepository     — DB state tracking (M1)
 *     ├── ImportPipeline      — external source import (M2)
 *     ├── DistributionPipeline — publish to managed engine targets (M3)
 *     ├── DiscoveryEngine     — snapshot builder (M4)
 *     ├── EligibilityEngine   — async eligibility evaluation (M4)
 *     ├── CacheManager        — project-keyed snapshot cache (M4)
 *     └── DiagnosticsCollector — diagnostic accumulator (M2)
 */

import os from 'node:os'
import { createHash } from 'node:crypto'
import type { Kysely } from 'kysely'
import type { Database } from '../../database/types'
import type { DataBus } from '../../core/dataBus'
import { createLogger } from '../../platform/logger'
import type {
  AIEngineKind,
  ManagedCapabilityCategory,
  CapabilitySnapshot,
  CapabilityDiagnostic,
  CapabilitySourceResult,
  CapabilityImportSourceType,
  CapabilityImportableItem,
  CapabilityImportResult,
  CapabilityDriftReport,
  CapabilitySaveFormParams,
  ClonableCapability,
  CloneItemSelection,
  CloneResult,
  EvoseSettings,
} from '@shared/types'
import {
  CapabilityStore,
  ALL_MANAGED_CATEGORIES,
  type CapabilityMount,
} from './capabilityStore'
import type { PackageService } from './packageService'
import { resolvePlugins, resolveCapabilityDirs } from '../capabilities/pluginResolver'
import { resolveClaudeCodePaths } from '../capabilities/paths'
import { StateRepository } from './stateRepository'
import { ImportPipeline } from './importPipeline'
import { DistributionPipeline, type DistributionTarget } from './distributionPipeline'
import { DiscoveryEngine } from './discoveryEngine'
import { EligibilityEngine } from './eligibilityEngine'
import { CapabilityCacheManager } from './cacheManager'
import { DiagnosticsCollector } from './diagnostics'
import { buildCapabilityPlan, type CapabilityPlan, type CapabilityPlanRequest } from './sessionInjector'
import { resolveDistributionTargetType } from './distributionTargets'
import { serializeFormToContent } from './serializeContent'
import { safeReadFile } from './shared/fsUtils'
import { ClonePipeline } from './clonePipeline'
import { EvoseSkillProvider } from './evoseSkillProvider'

const log = createLogger('CapabilityCenter')

// ─── Constants ──────────────────────────────────────────────────────────

const MCP_TEST_TIMEOUT_MS = 10_000
const VERSION_STRING_MAX_LEN = 200

// ─── Config ──────────────────────────────────────────────────────────────

export interface CapabilityCenterConfig {
  /** ~/.opencow/capabilities/ */
  globalCapabilitiesRoot: string
  /** Kysely database instance (v3.1 #8) */
  db: Kysely<Database>
  /** Optional DataBus for broadcasting change events */
  dataBus?: DataBus
  /** Resolve projectId (UUID) → filesystem path. Required for project-scoped operations. */
  resolveProjectPath?: (projectId: string) => Promise<string | null>
  /** PackageService for mount resolution and package lifecycle. */
  packageService?: PackageService
  /** Optional runtime projection source for Evose skills. */
  getEvoseSettings?: () => EvoseSettings
}

// ─── Re-exports for consumers ────────────────────────────────────────────

export type { CapabilityPlan, CapabilityPlanRequest } from './sessionInjector'
export { ClaudeCodeAdapter, type ClaudeAdapterOutput, type SDKHookMap, type InjectionAdapter } from './claudeCodeAdapter'

// ─── CapabilityCenter ──────────────────────────────────────────────────────

export class CapabilityCenter {
  // v3.1 #23: all internals are private
  private readonly store: CapabilityStore
  private readonly packageService?: PackageService
  private readonly stateRepo: StateRepository
  private readonly importPipeline: ImportPipeline
  private readonly clonePipeline: ClonePipeline
  private readonly distributionPipeline: DistributionPipeline
  private readonly discoveryEngine: DiscoveryEngine
  private readonly eligibility: EligibilityEngine
  private readonly cache: CapabilityCacheManager
  private readonly diagnostics: DiagnosticsCollector
  private readonly dataBus?: DataBus
  private readonly resolveProjectPathFn?: (projectId: string) => Promise<string | null>
  private readonly unsubscribeDataBus?: () => void
  private readonly evoseSkillProvider?: EvoseSkillProvider

  /**
   * Session-local dedup: tracks scopes already auto-imported in this process lifetime.
   * Key: `'global:claude'`, `'global:codex'`, `'project:<id>:claude'`, `'project:<id>:codex'`
   * Prevents redundant re-import on every getSnapshot() call.
   */
  private readonly autoImportedScopes = new Set<string>()

  constructor(config: CapabilityCenterConfig) {
    this.packageService = config.packageService
    const mountProviders: (() => Promise<CapabilityMount[]>)[] = [
      () => this.resolveActivePluginMounts(),
    ]
    // Add package mount provider if PackageService is available
    if (config.packageService) {
      mountProviders.push(() => config.packageService!.getGlobalMounts())
    }
    this.store = new CapabilityStore({
      globalRoot: config.globalCapabilitiesRoot,
      mountProviders,
      projectPackageMountProvider: config.packageService
        ? (projectPath) => config.packageService!.getProjectMounts(projectPath)
        : undefined,
    })
    this.stateRepo = new StateRepository(config.db)
    this.diagnostics = new DiagnosticsCollector()
    this.dataBus = config.dataBus
    this.resolveProjectPathFn = config.resolveProjectPath
    this.evoseSkillProvider = config.getEvoseSettings
      ? new EvoseSkillProvider(config.getEvoseSettings)
      : undefined
    this.eligibility = new EligibilityEngine()

    this.importPipeline = new ImportPipeline(this.store, this.stateRepo, this.diagnostics)
    this.clonePipeline = new ClonePipeline({ store: this.store })
    this.distributionPipeline = new DistributionPipeline(this.store, this.stateRepo)
    this.discoveryEngine = new DiscoveryEngine(this.store, this.stateRepo, this.eligibility)
    this.cache = new CapabilityCacheManager()

    // Listen for external capability changes (e.g. PackageService installs/uninstalls).
    // PackageService dispatches 'capabilities:changed' on every mutation, including
    // project-scoped packages whose directory is NOT file-watched. When our own
    // notifyChange() also dispatches this event, the double-invalidation is harmless
    // (cache.invalidate() is idempotent on an already-cleared cache).
    if (this.dataBus) {
      this.unsubscribeDataBus = this.dataBus.onBroadcast((event) => {
        if (event.type === 'capabilities:changed') {
          this.cache.invalidate()
        }
      })
    }
  }

  // ── Project Resolution ───────────────────────────────────────────

  /**
   * Resolve projectId → filesystem path.
   * Returns undefined for global scope (no projectId).
   * Throws if projectId is provided but cannot be resolved.
   */
  async resolveProjectPathFromId(projectId?: string): Promise<string | undefined> {
    if (!projectId) return undefined
    if (!this.resolveProjectPathFn) {
      throw new Error('resolveProjectPath not configured — cannot resolve projectId')
    }
    const resolved = await this.resolveProjectPathFn(projectId)
    if (!resolved) {
      throw new Error(`Project not found: ${projectId}`)
    }
    return resolved
  }

  /**
   * Like resolveProjectPathFromId but requires a non-empty projectId.
   * Always returns `string` or throws — suitable for contexts where
   * the project path is mandatory (e.g. cross-project clone).
   */
  private async requireProjectPath(projectId: string): Promise<string> {
    const resolved = await this.resolveProjectPathFromId(projectId)
    if (!resolved) {
      throw new Error(`Failed to resolve project path for "${projectId}"`)
    }
    return resolved
  }

  private async appendProjectedEvoseSkills(
    snapshot: CapabilitySnapshot,
  ): Promise<CapabilitySnapshot> {
    if (!this.evoseSkillProvider) return snapshot

    const toggles = await this.stateRepo.batchGetToggles('global', undefined, 'skill')
    const projectedSkills = this.evoseSkillProvider.projectSkills(toggles)
    if (projectedSkills.length === 0) return snapshot

    const mergedSkills = [...snapshot.skills]
    const diagnostics = [...snapshot.diagnostics]
    const existing = new Set(mergedSkills.map((entry) => `${entry.scope}:${entry.name}`))

    for (const entry of projectedSkills) {
      const key = `${entry.scope}:${entry.name}`
      if (existing.has(key)) {
        diagnostics.push({
          level: 'warn',
          category: 'skill',
          name: entry.name,
          message: 'evose-skill-name-conflict: projected Evose skill skipped',
          timestamp: Date.now(),
        })
        continue
      }
      existing.add(key)
      mergedSkills.push(entry)
    }

    return {
      ...snapshot,
      skills: mergedSkills,
      diagnostics,
    }
  }

  // ── Snapshot ──────────────────────────────────────────────────────

  /** Get a (cached) snapshot of all managed capabilities */
  async getSnapshot(projectId?: string): Promise<CapabilitySnapshot> {
    // Piggyback: auto-import on first access per scope (awaited so the
    // returned snapshot already includes newly-imported items).
    await this.autoImport(projectId)

    const cacheKey = projectId ?? '__global__'
    const cached = this.cache.get(cacheKey)
    if (cached) return cached

    const projectPath = await this.resolveProjectPathFromId(projectId)
    const baseSnapshot = await this.discoveryEngine.buildSnapshot({ projectPath, projectId })
    const snapshot = await this.appendProjectedEvoseSkills(baseSnapshot)
    this.cache.set(cacheKey, snapshot)
    return snapshot
  }

  /**
   * Resolve virtual capability source content (non-filesystem entries).
   * Returns null when the source path is not recognized by any runtime provider.
   */
  readVirtualCapabilitySource(sourcePath: string): CapabilitySourceResult | null {
    if (!this.evoseSkillProvider) return null
    const content = this.evoseSkillProvider.readVirtualSource(sourcePath)
    if (content == null) return null
    return { content, language: 'markdown' }
  }

  // ── Session Injection ─────────────────────────────────────────────

  /** Build a capability plan for a session (skills, rules, hooks, MCP servers) */
  async buildCapabilityPlan(params: {
    projectId?: string
    request: CapabilityPlanRequest
  }): Promise<CapabilityPlan> {
    log.info(
      `Building capability plan: engine=${params.request.session.engineKind}, projectId=${params.projectId ?? '(none)'}, agent=${params.request.session.agentName ?? '(default)'}`,
    )
    const snapshot = await this.getSnapshot(params.projectId)
    log.info(
      `Snapshot for injection: ${snapshot.mcpServers.length} MCP servers, ` +
      `${snapshot.skills.length} skills, ${snapshot.rules.length} rules, ` +
      `${snapshot.hooks.length} hooks`,
    )
    return buildCapabilityPlan({
      snapshot,
      stateRepo: this.stateRepo,
      request: params.request,
    })
  }

  // ── CRUD ──────────────────────────────────────────────────────────

  /** Save a capability with raw content (caller handles serialization) */
  async save(params: {
    scope: 'global' | 'project'
    category: ManagedCapabilityCategory
    name: string
    content: string
    projectId?: string
  }): Promise<{ success: boolean; filePath: string }> {
    const projectPath = await this.resolveProjectPathFromId(params.projectId)
    const filePath = await this.store.saveRaw(
      params.scope, params.category, params.name, params.content, projectPath,
    )
    this.afterSave(params.scope, params.category, params.name, params.content, projectPath)
    return { success: true, filePath }
  }

  /** Save a capability from structured form data (v3.1 #9: backend handles serialization) */
  async saveForm(params: CapabilitySaveFormParams): Promise<{ success: boolean; filePath: string }> {
    const content = serializeFormToContent(params)
    const projectPath = await this.resolveProjectPathFromId(params.projectId)
    const filePath = await this.store.saveRaw(
      params.scope, params.category, params.name, content, projectPath,
    )
    this.afterSave(params.scope, params.category, params.name, content, projectPath)
    return { success: true, filePath }
  }

  /** Remove a capability from the store */
  async remove(params: {
    category: ManagedCapabilityCategory
    name: string
    scope?: 'global' | 'project'
    projectId?: string
  }): Promise<void> {
    const scope = params.scope ?? 'global'
    const projectPath = await this.resolveProjectPathFromId(params.projectId)

    // Guard: mount capabilities cannot be deleted individually — they belong to
    // an external mount (plugin or marketplace package) and must be managed there.
    const entry = await this.store.get(scope, params.category, params.name, projectPath)
    if (entry?.mountInfo) {
      if (entry.mountInfo.sourceOrigin === 'marketplace') {
        throw new Error(
          `Cannot delete "${params.name}" — it belongs to package "${entry.mountInfo.namespace}". ` +
          `Use package uninstall to remove the entire package.`,
        )
      }
      throw new Error(
        `Cannot delete "${params.name}" — it is managed by external mount "${entry.mountInfo.namespace}".`,
      )
    }

    await this.store.remove(scope, params.category, params.name, projectPath)
    // Auto-unpublish from all distribution targets (fire-and-forget)
    this.distributionPipeline.unpublishAll(params.category, params.name)
      .catch((err) => log.debug('Auto-unpublish on delete failed', err))
    this.notifyChange()
  }

  /** Toggle a capability's enabled state */
  async toggle(params: {
    category: ManagedCapabilityCategory
    name: string
    enabled: boolean
    scope?: 'global' | 'project'
    projectId?: string
  }): Promise<void> {
    await this.stateRepo.setToggle(
      params.scope ?? 'global',
      params.projectId,
      params.category,
      params.name,
      params.enabled,
    )
    if (params.enabled) {
      // Toggle ON: ensure published to Claude Code
      const projectPath = await this.resolveProjectPathFromId(params.projectId)
      this.autoPublishIfNeeded(
        params.scope ?? 'global', params.category, params.name, projectPath,
      ).catch(() => {})
    } else {
      // Toggle OFF: remove from Claude Code
      this.distributionPipeline.unpublishAll(params.category, params.name)
        .catch((err) => log.debug('Auto-unpublish on toggle-off failed', err))
    }
    this.notifyChange()
  }

  /** Set tags for a capability */
  async setTags(params: {
    scope: 'global' | 'project'
    category: ManagedCapabilityCategory
    name: string
    tags: string[]
    projectId?: string
  }): Promise<void> {
    await this.stateRepo.setTags(
      params.scope,
      params.projectId,
      params.category,
      params.name,
      params.tags,
    )
    this.notifyChange()
  }

  // ── Distribution ──────────────────────────────────────────────────

  /** Publish a capability to a managed engine target */
  async publish(params: {
    category: ManagedCapabilityCategory
    name: string
    target: DistributionTarget
    strategy?: 'copy' | 'symlink'
  }): Promise<void> {
    // External mount capabilities live in mount install dirs — never distribute them
    const entry = await this.store.get('global', params.category, params.name)
    if (entry?.mountInfo) {
      log.debug(`Skip distribution for external mount capability: ${params.name}`)
      return
    }
    try {
      await this.distributionPipeline.publish(params)
      this.notifyChange()
    } catch (err) {
      this.recordGovernanceDiagnostic('publish', params.category, params.name, err)
      throw err
    }
  }

  /** Unpublish a capability from a managed engine target */
  async unpublish(params: {
    category: ManagedCapabilityCategory
    name: string
    target: DistributionTarget
  }): Promise<void> {
    try {
      await this.distributionPipeline.unpublish(params)
      this.notifyChange()
    } catch (err) {
      this.recordGovernanceDiagnostic('unpublish', params.category, params.name, err)
      throw err
    }
  }

  /** Detect drifted distributions (source modified since last publish) */
  async detectDrift(params?: { engineKind?: AIEngineKind }): Promise<CapabilityDriftReport[]> {
    const drifts = await this.distributionPipeline.detectDrift({
      engineKind: params?.engineKind,
    })
    return drifts.map((d) => ({
      category: d.category,
      name: d.name,
      targetPath: d.targetPath,
      reason: d.reason,
      staleHash: d.staleHash,
      currentHash: d.currentHash,
    }))
  }

  /** Sync all drifted distributions */
  async syncAll(params?: { engineKind?: AIEngineKind }): Promise<{ synced: string[]; errors: string[] }> {
    const result = await this.distributionPipeline.syncAll({
      engineKind: params?.engineKind,
    })
    if (result.synced.length > 0) {
      this.notifyChange()
    }
    return result
  }

  // ── Import ────────────────────────────────────────────────────────

  /** Discover importable items from an external source */
  async discoverImportable(
    sourceType: CapabilityImportSourceType,
    projectId?: string,
    filePaths?: string[],
  ): Promise<CapabilityImportableItem[]> {
    const projectPath = await this.resolveProjectPathFromId(projectId)
    const items = await this.importPipeline.discoverImportable(
      sourceType as 'claude-code' | 'codex' | 'plugin' | 'marketplace' | 'template' | 'file',
      projectPath,
      filePaths,
    )
    return items.map((item) => ({
      name: item.name,
      category: item.category,
      description: item.description,
      sourcePath: item.sourcePath,
      sourceType: item.sourceType as CapabilityImportSourceType,
      alreadyImported: item.alreadyImported,
      sourceScope: item.sourceScope,
      isBundle: item.isBundle,
    }))
  }

  /** Execute import for selected items */
  async importItems(
    items: CapabilityImportableItem[],
    target?: { scope: 'global' | 'project'; projectId?: string },
  ): Promise<CapabilityImportResult> {
    const scope = target?.scope ?? 'global'
    const projectPath = await this.resolveProjectPathFromId(target?.projectId)
    const result = await this.importPipeline.importItems(
      items.map((item) => ({
        ...item,
        sourceType: item.sourceType as 'claude-code' | 'codex' | 'plugin' | 'marketplace' | 'template' | 'file',
      })),
      { scope, projectPath },
    )
    if (result.imported.length > 0) {
      this.notifyChange()
    }
    return result
  }

  // ── MCP Server Testing ──────────────────────────────────────────

  /** Test if an MCP server can be spawned and responds */
  async testMcpServer(params: {
    command: string
    args?: string[]
    env?: Record<string, string>
    timeout?: number
  }): Promise<{ success: boolean; error?: string; version?: string }> {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    const timeoutMs = params.timeout ?? MCP_TEST_TIMEOUT_MS

    try {
      const result = await execFileAsync(
        params.command,
        [...(params.args ?? []), '--version'],
        {
          env: { ...process.env, ...params.env },
          timeout: timeoutMs,
        },
      )
      return {
        success: true,
        version: result.stdout.trim().slice(0, VERSION_STRING_MAX_LEN),
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // ── Diagnostics ───────────────────────────────────────────────────

  /** Flush accumulated diagnostics */
  flushDiagnostics(): CapabilityDiagnostic[] {
    return this.diagnostics.flush()
  }

  // ── Version History (M6) ────────────────────────────────────────

  /** Get version history for a capability (newest first) */
  async getVersionHistory(params: {
    category: ManagedCapabilityCategory
    name: string
    limit?: number
  }): Promise<Array<{ id: number; contentHash: string; createdAt: number }>> {
    const records = await this.stateRepo.getVersionHistory(
      params.category,
      params.name,
      params.limit,
    )
    return records.map((r) => ({
      id: r.id,
      contentHash: r.contentHash,
      createdAt: r.createdAt,
    }))
  }

  /** Get a specific version's full content snapshot */
  async getVersionSnapshot(id: number): Promise<string | null> {
    const record = await this.stateRepo.getVersion(id)
    return record?.snapshot ?? null
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  /**
   * Start watching all capability directories for changes.
   * Monitors all 6 category directories + packages directory.
   * Registers DataBus broadcast on invalidation.
   */
  startWatching(): void {
    for (const category of ALL_MANAGED_CATEGORIES) {
      const dir = this.store.resolveCategoryDir('global', category)
      this.cache.watch(dir)
    }
    // Also watch global packages directory — catches manual edits and external installs
    if (this.packageService) {
      this.cache.watch(this.packageService.getGlobalPackagesRoot())
    }
    this.cache.onInvalidate(() => {
      this.dataBus?.dispatch({ type: 'capabilities:changed', payload: {} })
    })
  }

  /**
   * M6-4: Run startup drift check (best-effort, never blocks).
   * Broadcasts 'capabilities:drift' if drifted distributions are found.
   */
  startDriftCheck(): void {
    this.detectDrift()
      .then((drifts) => {
        if (drifts.length > 0) {
          this.dataBus?.dispatch({
            type: 'capabilities:drift',
            payload: { drifts },
          })
        }
      })
      .catch((err) => {
        log.debug('Startup drift check failed (advisory)', err)
      })
  }

  /**
   * One-time backfill: ensure items previously imported from Claude Code have
   * distribution records so the UI shows "Published · In sync" instead of
   * "Not published to Claude Code".
   *
   * Idempotent — skips items that already have a distribution record.
   * Best-effort — errors are logged and swallowed.
   */
  async backfillDistributionRecords(): Promise<void> {
    try {
      const claudeCodeImports = await this.stateRepo.getImportsByOrigin('claude-code')
      if (claudeCodeImports.length === 0) return

      const allDistributions = await this.stateRepo.getAllDistributions()
      const distributedKeys = new Set(
        allDistributions.map((d) => `${d.category}:${d.name}`),
      )

      const homedir = os.homedir()
      let backfilled = 0

      for (const imp of claudeCodeImports) {
        const key = `${imp.category}:${imp.name}`
        if (distributedKeys.has(key)) continue

        // Read stored content to compute hash.
        // Use resolveActualPath (not resolvePath) — skills may be stored as
        // bundles (skills/name/SKILL.md) rather than flat files (skills/name.md).
        const storedPath = await this.store.resolveActualPath('global', imp.category, imp.name)
        if (!storedPath) continue
        const content = await safeReadFile(storedPath)
        if (!content) continue

        const hash = `sha256:${createHash('sha256').update(content).digest('hex')}`

        // Determine target type: if source path is under ~/.claude/, it's global
        const isGlobal = imp.sourcePath.startsWith(homedir)
        const targetType = resolveDistributionTargetType({
          engineKind: 'claude',
          scope: isGlobal ? 'global' : 'project',
        })

        // Strip hash fragment from source path (e.g. settings.json#hooks.Event → settings.json)
        const hashIdx = imp.sourcePath.indexOf('#')
        const targetPath = hashIdx !== -1 ? imp.sourcePath.slice(0, hashIdx) : imp.sourcePath

        await this.stateRepo.recordDistribution({
          category: imp.category,
          name: imp.name,
          targetType,
          targetPath,
          strategy: 'copy',
          contentHash: hash,
          distributedAt: imp.importedAt,
        })
        backfilled++
      }

      if (backfilled > 0) {
        log.info(`Backfilled ${backfilled} distribution records for Claude Code imports`)
        this.notifyChange()
      }
    } catch (err) {
      log.debug('Distribution backfill failed (advisory)', err)
    }
  }

  /**
   * Auto-import capabilities from engine-native locations.
   *
   * Sources:
   * - Claude Code: `~/.claude/`, `{project}/.claude/`
   * - Codex: `~/.agents/skills`, `~/.codex/config.toml`,
   *          `{project}/.agents/skills`, `{project}/.codex/config.toml`
   */
  async autoImport(projectId?: string): Promise<void> {
    const projectPath = await this.resolveProjectPathFromId(projectId)
    await this.autoImportFromSource('claude-code', projectId, projectPath)
    await this.autoImportFromSource('codex', projectId, projectPath)
  }

  private async autoImportFromSource(
    sourceType: 'claude-code' | 'codex',
    projectId?: string,
    projectPath?: string,
  ): Promise<void> {
    const scopePrefix = projectId ? `project:${projectId}` : 'global'
    const engineKey = sourceType === 'codex' ? 'codex' : 'claude'
    const scopeKey = `${scopePrefix}:${engineKey}`
    if (this.autoImportedScopes.has(scopeKey)) return

    try {
      const allItems = await this.importPipeline.discoverImportable(sourceType, projectPath)

      const newItems = allItems.filter((item) => !item.alreadyImported)
      if (newItems.length === 0) {
        log.debug(`Auto-import [${scopeKey}]: nothing new to import`)
        this.autoImportedScopes.add(scopeKey)
        return
      }

      const globalItems = newItems.filter((i) => i.sourceScope === 'global')
      const projectItems = newItems.filter((i) => i.sourceScope === 'project')

      let totalImported = 0
      if (globalItems.length > 0) {
        const result = await this.importPipeline.importItems(globalItems, { scope: 'global' })
        totalImported += result.imported.length
      }
      if (projectItems.length > 0 && projectPath) {
        const result = await this.importPipeline.importItems(projectItems, {
          scope: 'project',
          projectPath,
        })
        totalImported += result.imported.length
      }

      this.autoImportedScopes.add(scopeKey)

      if (totalImported > 0) {
        log.info(`Auto-import [${scopeKey}]: imported ${totalImported} new capabilities`)
        this.notifyChange()
      } else {
        log.debug(`Auto-import [${scopeKey}]: all items already existed`)
      }
    } catch (err) {
      log.warn(`Auto-import [${scopeKey}] failed (will retry on next access)`, err)
    }
  }

  // ── Path Migration ──────────────────────────────────────────────

  /**
   * Handle a project path change: migrate distribution records and invalidate cache.
   *
   * Called when a project directory is renamed on disk. Performs:
   * 1. Batch-update all capability_distribution.target_path records whose path
   *    prefix matches the old project path, replacing with the new path.
   * 2. Invalidate snapshot cache so stale entries are rebuilt on next access.
   * 3. Broadcast a capabilities:changed event so the renderer refreshes.
   */
  async onProjectPathChanged(params: {
    projectId: string
    oldPath: string
    newPath: string
  }): Promise<void> {
    const migrated = await this.stateRepo.migrateDistributionPaths({
      oldProjectPath: params.oldPath,
      newProjectPath: params.newPath,
    })

    if (migrated > 0) {
      this.notifyChange()
      log.info(
        `Project path changed [${params.projectId}]: migrated ${migrated} distribution record(s)`,
      )
    }
  }

  /** Clean up watchers, caches, and event subscriptions */
  dispose(): void {
    this.unsubscribeDataBus?.()
    this.cache.dispose()
  }

  // ── Plugin Mount Resolution ────────────────────────────────────────

  /**
   * Resolve active (enabled & not blocked) plugin mounts for the CapabilityStore.
   *
   * Called lazily by CapabilityStore via the mountProviders callback.
   * Returns plugin capability directories for skill, command, and agent categories.
   * Best-effort: returns empty array on failure.
   */
  private async resolveActivePluginMounts(): Promise<CapabilityMount[]> {
    try {
      const plugins = await resolvePlugins(resolveClaudeCodePaths())
      return plugins
        .filter((p) => p.enabled && !p.blocked)
        .map((p) => ({
          namespace: p.name,
          origin: {
            type: 'claude-code' as const,
            marketplace: p.marketplace,
            version: p.version,
          },
          dirs: {
            skill: resolveCapabilityDirs(p, 'skills'),
            command: resolveCapabilityDirs(p, 'commands'),
            agent: resolveCapabilityDirs(p, 'agents'),
          },
        }))
    } catch (err) {
      log.debug('Plugin mount resolution failed (advisory)', err)
      return []
    }
  }

  // ── Clone (Cross-Project Copy) ───────────────────────────────────

  /**
   * Discover project-scoped capabilities in the source project that can be
   * cloned to the target project, with pre-checked conflict info.
   */
  async discoverClonable(params: {
    sourceProjectId: string
    targetProjectId: string
  }): Promise<ClonableCapability[]> {
    const sourcePath = await this.requireProjectPath(params.sourceProjectId)
    const targetPath = await this.requireProjectPath(params.targetProjectId)
    return this.clonePipeline.discoverClonable({
      source: { projectId: params.sourceProjectId, projectPath: sourcePath },
      target: { projectId: params.targetProjectId, projectPath: targetPath },
    })
  }

  /**
   * Clone selected capabilities from one project to another.
   *
   * Handles version recording and cache invalidation in a single batch
   * (not per-item) to avoid N notification storms.
   */
  async cloneCapabilities(params: {
    sourceProjectId: string
    targetProjectId: string
    items: CloneItemSelection[]
  }): Promise<CloneResult> {
    const sourcePath = await this.requireProjectPath(params.sourceProjectId)
    const targetPath = await this.requireProjectPath(params.targetProjectId)

    const result = await this.clonePipeline.executeClone({
      source: { projectId: params.sourceProjectId, projectPath: sourcePath },
      target: { projectId: params.targetProjectId, projectPath: targetPath },
      items: params.items,
    })

    // Batch post-clone side-effects: single cache invalidation + broadcast
    if (result.summary.succeeded > 0) {
      this.notifyChange()
    }

    return result
  }

  // ── Internal ──────────────────────────────────────────────────────

  /** Invalidate cache + broadcast DataBus event — single point for all mutations. */
  private notifyChange(): void {
    this.cache.invalidate()
    this.dataBus?.dispatch({ type: 'capabilities:changed', payload: {} })
  }

  /**
   * Unified post-save pipeline — single point for all save side-effects.
   *
   * Ordering:
   *   1. Record version snapshot (fire-and-forget)
   *   2. Auto-publish if no distribution record exists yet (fire-and-forget)
   *   3. Auto-sync to distribution targets (fire-and-forget)
   *   4. Invalidate cache + broadcast change event (sync)
   *
   * Adding new post-save behaviours? Add them here — not in save()/saveForm().
   */
  private afterSave(
    scope: 'global' | 'project',
    category: ManagedCapabilityCategory,
    name: string,
    content: string,
    projectPath?: string,
  ): void {
    this.recordVersionQuietly(category, name, content)
    // Ensure distribution record exists, then sync
    this.autoPublishIfNeeded(scope, category, name, projectPath)
      .then(() => this.autoSyncDistributions(category, name))
      .catch(() => {}) // best-effort
    this.notifyChange()
  }

  /**
   * Auto-sync distributions — fire-and-forget after save.
   *
   * If the capability was previously published to Claude Code targets,
   * re-publish to all known targets so the external copies stay in sync.
   * Never blocks save() — errors are logged and swallowed.
   */
  private autoSyncDistributions(
    category: ManagedCapabilityCategory,
    name: string,
  ): void {
    this.distributionPipeline
      .syncCapability(category, name)
      .then((result) => {
        if (result.synced.length > 0) {
          log.debug(`Auto-synced ${result.synced.join(', ')}`)
        }
        if (result.errors.length > 0) {
          log.debug(`Auto-sync errors: ${result.errors.join('; ')}`)
        }
      })
      .catch((err) => {
        log.debug('Auto-sync failed (best-effort)', err)
      })
  }

  /**
   * Auto-publish if no distribution record exists yet.
   * Ensures every non-plugin capability is always distributed to Claude Code
   * so users never need to manually "Publish".
   */
  private async autoPublishIfNeeded(
    scope: 'global' | 'project',
    category: ManagedCapabilityCategory,
    name: string,
    projectPath?: string,
  ): Promise<void> {
    // Skip external mount capabilities — they live in mount install dirs
    const entry = await this.store.get(scope, category, name, projectPath)
    if (entry?.mountInfo) return

    // Already has distribution → autoSyncDistributions handles re-publish
    const existing = await this.stateRepo.getDistributionsFor(category, name)
    if (existing.length > 0) return

    // First publish — create distribution record
    const targetType = resolveDistributionTargetType({ engineKind: 'claude', scope })
    const target = (scope === 'project' && projectPath
      ? { type: targetType, projectPath }
      : { type: targetType }) as DistributionTarget

    await this.distributionPipeline.publish({ category, name, target })
    log.debug(`Auto-published ${category}/${name} to ${target.type}`)
  }

  /**
   * Record a version snapshot — fire-and-forget so save() is never blocked.
   * Also prunes old versions to keep the table bounded.
   */
  private recordVersionQuietly(
    category: ManagedCapabilityCategory,
    name: string,
    content: string,
  ): void {
    const contentHash = createHash('sha256').update(content).digest('hex')
    this.stateRepo
      .recordVersion({ category, name, contentHash, snapshot: content })
      .then(() => this.stateRepo.pruneVersions(category, name))
      .catch((err) => {
        log.debug('Version recording failed (best-effort)', err)
      })
  }

  private recordGovernanceDiagnostic(
    operation: 'publish' | 'unpublish',
    category: ManagedCapabilityCategory,
    name: string,
    err: unknown,
  ): void {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('does not support category=')) {
      this.diagnostics.error(category, `unsupported-category: ${message}`, name)
      return
    }
    this.diagnostics.error(category, `${operation} failed: ${message}`, name)
  }
}
