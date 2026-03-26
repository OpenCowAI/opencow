// SPDX-License-Identifier: Apache-2.0

/**
 * Import Pipeline — discovers and imports capabilities from external sources.
 *
 * v3.1 fixes:
 *   #19 — complete Hook (settings.json) and MCP Server (.claude.json) import
 *   #27 — shared fsUtils instead of module-local duplicates
 *
 * v3.2 fixes:
 *   - Added structured logging throughout (createLogger)
 *   - Fixed Hook/MCP import: extract per-item config instead of raw file read
 *   - Eliminated redundant file reads in skill import path
 *   - Clearer error messages with contextual info
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { parseFrontmatter } from '@shared/frontmatter'
import { HOOK_MARKER_KEY } from '@shared/appIdentity'
import { isPlainObject } from '@shared/typeGuards'
import { DIR_TO_CAPABILITY_CATEGORY } from '@shared/types'
import type { ManagedCapabilityCategory } from '@shared/types'
import { createLogger } from '../../platform/logger'
import { SKILL_BUNDLE_FILENAME, type CapabilityStore } from './capabilityStore'
import type { StateRepository } from './stateRepository'
import type { DiagnosticsCollector } from './diagnostics'
import { safeDirEntries, safeReadFile, safeReadJson } from './shared/fsUtils'
import { BUILT_IN_TEMPLATES } from './builtInTemplates'
import { resolvePlugins, resolveCapabilityDirs } from '../capabilities/pluginResolver'
import { resolveClaudeCodePaths } from '../capabilities/paths'
import { resolveDistributionTargetType } from './distributionTargets'
import { ClaudeGovernanceDriver } from './governance/claudeGovernanceDriver'
import { CodexGovernanceDriver } from './governance/codexGovernanceDriver'
import type { EngineGovernanceDriver } from './governance/engineGovernanceDriver'
import {
  resolveCodexConfigPath,
  resolveCodexSkillFilePath,
  resolveCodexSkillsDir,
} from './governance/codexPaths'
import { extractMcpServersFromToml } from './governance/tomlPatch'

const log = createLogger('ImportPipeline')

// ─── Constants ──────────────────────────────────────────────────────────

/** Maximum directory depth for recursive skill bundle collection. */
const MAX_COLLECT_DEPTH = 5

/** Maximum directory depth for file-import discovery (prevent runaway recursion). */
const MAX_FILE_DISCOVER_DEPTH = 3

/** Maximum single asset file size (5 MB). Files larger than this are skipped during bundle collection. */
const MAX_ASSET_FILE_BYTES = 5 * 1024 * 1024

/**
 * Directory names to always skip during skill bundle asset collection.
 * These are never meaningful parts of a skill definition.
 */
const IGNORED_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', '.svn', '.hg',
  '__pycache__', '.pytest_cache', '.mypy_cache',
  '.venv', 'venv', '.env',
  '.idea', '.vscode',
  'dist', 'build', '.next', '.nuxt',
  '.tox', '.nox',
])

/**
 * File names / extensions to always skip during skill bundle asset collection.
 * These are OS / editor artifacts or sensitive files that should never be imported.
 */
const IGNORED_FILES: ReadonlySet<string> = new Set([
  '.DS_Store', 'Thumbs.db', 'desktop.ini',
  '.env', '.env.local', '.env.production',
  'credentials.json', 'secrets.json',
])

/** File extensions to always skip during asset collection. */
const IGNORED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pyc', '.pyo', '.class', '.o', '.obj',
  '.so', '.dylib', '.dll',
  '.exe', '.bin',
  '.lock',
])

/**
 * Known directory names that map directly to a capability category.
 * Derived from the shared DIR_TO_CAPABILITY_CATEGORY constant.
 */
const DIR_TO_CATEGORY = DIR_TO_CAPABILITY_CATEGORY

/**
 * Infer the capability category from file context — pure function, unit-testable.
 *
 * Priority:
 *   1. Parent directory name matches a known category → use it
 *   2. For .md: frontmatter contains `argument-hint` → command
 *   3. For .json: contains `eventName` → hook; contains `command`/`type` → mcp-server
 *   4. Default: .md → skill, .json → mcp-server
 */
export function inferCapabilityCategory(context: {
  ext: string
  parentDirName: string
  frontmatterAttributes?: Record<string, unknown>
  jsonKeys?: string[]
}): ManagedCapabilityCategory {
  // 1. Parent directory match
  const dirMatch = DIR_TO_CATEGORY[context.parentDirName]
  if (dirMatch) return dirMatch

  // 2. Content-based inference
  if (context.ext === '.md') {
    if (context.frontmatterAttributes?.['argument-hint'] != null) return 'command'
    return 'skill' // most common
  }

  if (context.ext === '.json' && context.jsonKeys) {
    if (context.jsonKeys.includes('eventName')) return 'hook'
    return 'mcp-server'
  }

  return 'skill' // safe default
}

// ─── Types ──────────────────────────────────────────────────────────────

export type ImportSourceType =
  | 'claude-code'
  | 'codex'
  | 'plugin'
  | 'marketplace'
  | 'template'
  | 'file'

export interface ImportableItem {
  name: string
  category: ManagedCapabilityCategory
  description: string
  sourcePath: string
  sourceType: ImportSourceType
  alreadyImported: boolean
  /** Where the item was discovered: global (~/.claude) or project ({project}/.claude) */
  sourceScope: 'global' | 'project'
  /** For skills: true = bundle (directory with SKILL.md + assets), false/undefined = flat .md file */
  isBundle?: boolean
  /** Marketplace origin metadata — only present when sourceType === 'marketplace' */
  marketInfo?: {
    marketplaceId: string
    slug: string
    version?: string
    repoUrl?: string
    author?: string
    installs?: number
  }
}

export interface ImportResult {
  imported: string[]
  skipped: string[]
  errors: Array<{ name: string; error: string }>
}

/** Target scope for import operations. */
export interface ImportTarget {
  scope: 'global' | 'project'
  projectPath?: string
}

type GovernanceEngineKind = 'claude' | 'codex'

// ─── ImportPipeline ─────────────────────────────────────────────────────

export class ImportPipeline {
  private readonly governanceDrivers: Record<GovernanceEngineKind, EngineGovernanceDriver>

  constructor(
    private readonly store: CapabilityStore,
    private readonly stateRepo: StateRepository,
    private readonly diagnostics: DiagnosticsCollector,
  ) {
    this.governanceDrivers = this.createGovernanceDrivers()
  }

  /**
   * Discover importable items from an external source ("look" phase).
   * @param projectPath — optional project root; when provided, also scans {projectPath}/.claude/
   * @param filePaths — for sourceType='file': user-selected file/directory paths
   */
  async discoverImportable(sourceType: ImportSourceType, projectPath?: string, filePaths?: string[]): Promise<ImportableItem[]> {
    log.info(`Discovering importable items from source: ${sourceType}${projectPath ? ` (project: ${projectPath})` : ''}`)
    try {
      let items: ImportableItem[]
      switch (sourceType) {
        case 'claude-code':
          items = await this.discoverFromEngineSource('claude', projectPath)
          break
        case 'codex':
          items = await this.discoverFromEngineSource('codex', projectPath)
          break
        case 'plugin':
          items = await this.discoverFromPlugins()
          break
        case 'template':
          items = await this.discoverFromTemplates()
          break
        case 'file':
          items = await this.discoverFromFiles(filePaths ?? [], projectPath)
          break
        case 'marketplace':
          // Marketplace discovery is driven by MarketplaceService (search → download → import).
          // This case returns an empty list because the actual items are provided
          // directly to importItems() by MarketplaceService after download.
          items = []
          break
        default:
          items = []
      }
      const importable = items.filter((i) => !i.alreadyImported).length
      log.info(`Discovery complete: ${items.length} total, ${importable} importable`)
      return items
    } catch (err) {
      log.error('Discovery failed', err)
      throw err
    }
  }

  /**
   * Execute import: copy selected items into the Capability Store ("do" phase).
   *
   * @param target — where to save (global or project scope)
   */
  async importItems(items: ImportableItem[], target: ImportTarget = { scope: 'global' }): Promise<ImportResult> {
    log.info(`Starting import of ${items.length} items → ${target.scope}${target.projectPath ? ` (${target.projectPath})` : ''}`)
    const result: ImportResult = { imported: [], skipped: [], errors: [] }

    for (const item of items) {
      const itemTag = `[${item.category}:${item.name}]`
      try {
        if (item.alreadyImported) {
          log.debug(`${itemTag} Skipped (already imported)`)
          result.skipped.push(item.name)
          continue
        }

        log.info(`${itemTag} Importing from ${item.sourcePath}`)
        await this.importSingleItemWithGovernance(item, target)
        await this.recordProvenance(item)
        await this.recordDistributionIfImportedFromEngine(item, target)
        result.imported.push(item.name)
        log.info(`${itemTag} Import successful`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result.errors.push({ name: item.name, error: message })
        log.error(`${itemTag} Import FAILED: ${message}`, err)
        this.diagnostics.error(item.category, `Import failed: ${message}`, item.name)
      }
    }

    log.info(
      `Import complete: ${result.imported.length} imported, ` +
      `${result.skipped.length} skipped, ${result.errors.length} errors`,
    )
    if (result.errors.length > 0) {
      log.warn('Failed items:', result.errors)
    }
    return result
  }

  private createGovernanceDrivers(): Record<GovernanceEngineKind, EngineGovernanceDriver> {
    const unsupportedOpError = (op: string): Error =>
      new Error(`Operation "${op}" is not handled by ImportPipeline governance drivers`)

    return {
      claude: new ClaudeGovernanceDriver({
        discover: async ({ projectPath }) => this.discoverFromClaudeCode(projectPath),
        importItem: async ({ item, target }) => this.importSingleItem(item, target),
        publish: async () => { throw unsupportedOpError('publish') },
        unpublish: async () => { throw unsupportedOpError('unpublish') },
        detectDrift: async () => { throw unsupportedOpError('detect-drift') },
      }),
      codex: new CodexGovernanceDriver({
        discover: async ({ projectPath }) => this.discoverFromCodex(projectPath),
        importItem: async ({ item, target }) => this.importSingleItem(item, target),
        publish: async () => { throw unsupportedOpError('publish') },
        unpublish: async () => { throw unsupportedOpError('unpublish') },
        detectDrift: async () => { throw unsupportedOpError('detect-drift') },
      }),
    }
  }

  private async discoverFromEngineSource(
    engineKind: GovernanceEngineKind,
    projectPath?: string,
  ): Promise<ImportableItem[]> {
    const driver = this.governanceDrivers[engineKind]
    return driver.discover({ projectPath })
  }

  private async importSingleItemWithGovernance(
    item: ImportableItem,
    target: ImportTarget,
  ): Promise<void> {
    const engineKind = sourceTypeToEngineKind(item.sourceType)
    if (!engineKind) {
      await this.importSingleItem(item, target)
      return
    }

    const driver = this.governanceDrivers[engineKind]
    if (!driver.supports(item.category, 'import')) {
      throw new Error(`${driver.engineKind} does not support category=${item.category}`)
    }
    await driver.importItem({
      item,
      target,
      store: this.store,
      stateRepo: this.stateRepo,
    })
  }

  // ── Single-item import dispatch ────────────────────────────────

  /**
   * Import a single item — dispatches to the correct handler by category.
   *
   * Each handler is self-adaptive: it inspects `item.sourcePath` format to decide
   * how to read the data (e.g. direct JSON file vs settings.json#fragment).
   */
  private async importSingleItem(item: ImportableItem, target: ImportTarget): Promise<void> {
    // Template items carry content in-memory, not from disk
    if (item.sourceType === 'template') {
      return this.importTemplateItem(item, target)
    }
    // Config-type categories (hook / mcp-server)
    if (item.category === 'hook') {
      return this.importHookItem(item, target)
    }
    if (item.category === 'mcp-server') {
      return this.importMCPServerItem(item, target)
    }
    // Skill bundles (directory with SKILL.md + assets)
    if (item.category === 'skill' && item.isBundle) {
      return this.importSkillBundle(item, target)
    }
    // All document-type categories (flat skills, agents, commands, rules): raw file copy
    return this.importDocumentItem(item, target)
  }

  // ── Template import ───────────────────────────────────────────

  private async importTemplateItem(item: ImportableItem, target: ImportTarget): Promise<void> {
    const tpl = BUILT_IN_TEMPLATES.find(
      (t) => t.name === item.name && t.category === item.category,
    )
    if (!tpl) {
      throw new Error(`Template "${item.name}" not found in built-in templates`)
    }
    await this.store.saveRaw(target.scope, tpl.category, tpl.name, tpl.content, target.projectPath)
  }

  // ── Document-type import (command / agent / rule) ─────────────

  private async importDocumentItem(item: ImportableItem, target: ImportTarget): Promise<void> {
    const content = await safeReadFile(item.sourcePath)
    if (!content) {
      throw new Error(`Source file not readable: ${item.sourcePath}`)
    }
    log.debug(`[${item.category}:${item.name}] Content size: ${Buffer.byteLength(content)} bytes`)
    await this.store.saveRaw(target.scope, item.category, item.name, content, target.projectPath)
  }

  // ── Skill bundle import ───────────────────────────────────────

  private async importSkillBundle(item: ImportableItem, target: ImportTarget): Promise<void> {
    const sourceDir = path.dirname(item.sourcePath)
    const content = await safeReadFile(item.sourcePath)
    if (!content) {
      throw new Error(`SKILL.md not readable: ${item.sourcePath}`)
    }

    const entries = await safeDirEntries(sourceDir)
    const assets: Array<{ relativePath: string; content: string | Buffer }> = []

    for (const entry of entries) {
      if (entry.name === SKILL_BUNDLE_FILENAME) continue
      if (shouldSkipEntry(entry)) continue
      const src = path.join(sourceDir, entry.name)
      if (entry.isDir) {
        await this.collectDirAssets(src, entry.name, assets)
      } else if (entry.isFile) {
        const fileContent = await this.readAssetSafe(src, entry.name)
        if (fileContent) assets.push({ relativePath: entry.name, content: fileContent })
      }
    }

    log.debug(
      `[skill:${item.name}] Bundle: SKILL.md (${Buffer.byteLength(content)} bytes) + ${assets.length} assets`,
    )

    await this.store.saveSkillBundle(target.scope, {
      name: item.name,
      skillContent: content,
      assets: assets.length > 0 ? assets : undefined,
    }, target.projectPath)
  }

  private async collectDirAssets(
    dir: string,
    prefix: string,
    assets: Array<{ relativePath: string; content: string | Buffer }>,
    depth = 0,
  ): Promise<void> {
    if (depth >= MAX_COLLECT_DEPTH) {
      log.warn(`Skipped deeply nested directory (depth ${depth}): ${prefix}`)
      this.diagnostics.warn('skill', `Skipped deeply nested directory (depth ${depth}): ${prefix}`)
      return
    }

    const entries = await safeDirEntries(dir)
    for (const entry of entries) {
      if (shouldSkipEntry(entry)) continue
      const fullPath = path.join(dir, entry.name)
      const relPath = path.join(prefix, entry.name)
      if (entry.isDir) {
        await this.collectDirAssets(fullPath, relPath, assets, depth + 1)
      } else if (entry.isFile) {
        const fileContent = await this.readAssetSafe(fullPath, relPath)
        if (fileContent) assets.push({ relativePath: relPath, content: fileContent })
      }
    }
  }

  /** Read an asset file with size guard. Returns null if skipped. */
  private async readAssetSafe(filePath: string, displayName: string): Promise<Buffer | null> {
    try {
      const stat = await fs.stat(filePath)
      if (stat.size > MAX_ASSET_FILE_BYTES) {
        log.warn(`Skipped oversized asset (${(stat.size / 1024 / 1024).toFixed(1)} MB): ${displayName}`)
        this.diagnostics.warn('skill', `Skipped oversized asset: ${displayName}`)
        return null
      }
      return await fs.readFile(filePath)
    } catch {
      log.warn(`Failed to read asset: ${displayName}`)
      return null
    }
  }

  // ── Hook import ───────────────────────────────────────────────

  /**
   * Import a hook.
   *
   * Self-adaptive based on sourcePath format:
   *   - "/path/settings.json#hooks.EventName" → extract from Claude Code settings.json
   *   - "/path/my-hook.json" → direct JSON file (from file import)
   */
  private async importHookItem(item: ImportableItem, target: ImportTarget): Promise<void> {
    // Direct JSON file — just read and save as config
    const hashIdx = item.sourcePath.indexOf('#hooks.')
    if (hashIdx === -1) {
      return this.importConfigFromFile(item, target)
    }
    const settingsPath = item.sourcePath.slice(0, hashIdx)
    const eventName = item.sourcePath.slice(hashIdx + '#hooks.'.length)
    log.debug(`[hook:${item.name}] Extracting from ${settingsPath} event: ${eventName}`)

    const settings = await safeReadJson(settingsPath)
    const hooksConfig = (settings['hooks'] ?? {}) as Record<string, unknown[]>

    const ruleGroups = hooksConfig[eventName]
    if (!Array.isArray(ruleGroups)) {
      throw new Error(`Hook event "${eventName}" not found in settings.json`)
    }

    // Find the matching rule group + hook that contains a command matching the item name
    let matchedHook: Record<string, unknown> | null = null
    let matchedMatcher: string | undefined
    for (const group of ruleGroups) {
      const g = group as Record<string, unknown>
      if (g[HOOK_MARKER_KEY]) continue
      const hooks = (g['hooks'] ?? []) as Array<Record<string, unknown>>
      for (const hook of hooks) {
        if (hook['type'] === 'command' && typeof hook['command'] === 'string') {
          const hookName = this.inferHookName(hook['command'], eventName)
          if (hookName === item.name) {
            matchedHook = hook
            matchedMatcher = typeof g['matcher'] === 'string' ? g['matcher'] : undefined
            break
          }
        }
      }
      if (matchedHook) break
    }

    if (!matchedHook) {
      throw new Error(`Hook "${item.name}" not found in settings.json hooks.${eventName}`)
    }

    // Save in canonical format: { name, events: { EventName: [{ matcher?, hooks: [...] }] } }
    // This matches what serializeHook() and distributionPipeline.publishHook() expect.
    const hookEntry: Record<string, unknown> = { type: matchedHook['type'] }
    if (matchedHook['command']) hookEntry['command'] = matchedHook['command']
    if (matchedHook['prompt']) hookEntry['prompt'] = matchedHook['prompt']

    const ruleGroup: Record<string, unknown> = { hooks: [hookEntry] }
    if (matchedMatcher) ruleGroup['matcher'] = matchedMatcher

    const config: Record<string, unknown> = {
      name: item.name,
      events: {
        [eventName]: [ruleGroup],
      },
    }
    await this.store.saveConfig(target.scope, 'hook', item.name, config, target.projectPath)
  }

  // ── MCP Server import ─────────────────────────────────────────

  /**
   * Import an MCP server.
   *
   * Self-adaptive based on sourcePath format:
   *   - "/path/.claude.json" → extract from Claude Code config (contains mcpServers object)
   *   - "/path/.codex/config.toml#mcp_servers.server_name" → extract from Codex config
   *   - "/path/my-server.json" → direct JSON file (from file import)
   */
  private async importMCPServerItem(item: ImportableItem, target: ImportTarget): Promise<void> {
    log.debug(`[mcp-server:${item.name}] Extracting from ${item.sourcePath}`)

    const codexHashIdx = item.sourcePath.indexOf('#mcp_servers.')
    if (codexHashIdx !== -1) {
      const tomlPath = item.sourcePath.slice(0, codexHashIdx)
      const configToml = await safeReadFile(tomlPath)
      if (!configToml) throw new Error(`Codex config not readable: ${tomlPath}`)

      const mcpServers = extractMcpServersFromToml(configToml)
      const serverConfig = mcpServers[item.name]
      if (!isPlainObject(serverConfig)) {
        throw new Error(`MCP server "${item.name}" not found in codex config`)
      }

      const normalized: Record<string, unknown> = {
        name: item.name,
        serverConfig: serverConfig as Record<string, unknown>,
      }
      await this.store.saveConfig(target.scope, 'mcp-server', item.name, normalized, target.projectPath)
      return
    }

    const jsonContent = await safeReadJson(item.sourcePath)

    // No mcpServers wrapper → standalone config file (from file import)
    if (!('mcpServers' in jsonContent)) {
      return this.importConfigFromFile(item, target)
    }

    const mcpServers = jsonContent['mcpServers'] as Record<string, unknown>
    const serverConfig = mcpServers[item.name]
    if (!isPlainObject(serverConfig)) {
      throw new Error(`MCP server "${item.name}" not found in .claude.json`)
    }

    // After isPlainObject guard, serverConfig is already Record<string, unknown>

    // Save in canonical format: { name, serverConfig: { type, command, args?, env? } }
    // This matches what serializeMcpServer() and distributionPipeline.publishMcpServer() expect.
    const serverCfg: Record<string, unknown> = {
      type: serverConfig['type'] ?? 'stdio',
      command: serverConfig['command'] ?? '',
    }
    const args = Array.isArray(serverConfig['args']) ? serverConfig['args'] : []
    if (args.length > 0) serverCfg['args'] = args
    const env = isPlainObject(serverConfig['env']) ? serverConfig['env'] : {}
    if (Object.keys(env as Record<string, unknown>).length > 0) serverCfg['env'] = env

    const normalized: Record<string, unknown> = {
      name: item.name,
      serverConfig: serverCfg,
    }

    await this.store.saveConfig(target.scope, 'mcp-server', item.name, normalized, target.projectPath)
  }

  // ── Config file import (direct JSON) ─────────────────────────

  /**
   * Import a config-type capability from a standalone JSON file.
   * Used by file import for hooks and MCP servers.
   *
   * Normalizes to canonical format before saving so that all stored configs
   * share the same shape — this eliminates the need for legacy format
   * detection downstream (configAdapters keeps legacy support as a safety net).
   */
  private async importConfigFromFile(item: ImportableItem, target: ImportTarget): Promise<void> {
    const content = await safeReadFile(item.sourcePath)
    if (!content) throw new Error(`Source file not readable: ${item.sourcePath}`)
    let config: Record<string, unknown>
    try {
      config = JSON.parse(content) as Record<string, unknown>
    } catch {
      throw new Error(`Invalid JSON in ${path.basename(item.sourcePath)}: file is not valid JSON`)
    }
    log.debug(`[${item.category}:${item.name}] Config from file: ${Object.keys(config).length} keys`)

    // Normalize to canonical format before saving
    const normalized = this.normalizeConfig(item.category, item.name, config)
    await this.store.saveConfig(target.scope, item.category, item.name, normalized, target.projectPath)
  }

  /**
   * Normalize a config blob to canonical storage format.
   *
   * If the config already has the canonical wrapper (`events` for hooks,
   * `serverConfig` for MCP servers), it passes through with `name` ensured.
   * Otherwise, it's wrapped into the expected shape.
   */
  private normalizeConfig(
    category: ManagedCapabilityCategory,
    name: string,
    config: Record<string, unknown>,
  ): Record<string, unknown> {
    if (category === 'hook') return this.normalizeHookConfig(name, config)
    if (category === 'mcp-server') return this.normalizeMCPConfig(name, config)
    return { name, ...config }
  }

  private normalizeHookConfig(name: string, config: Record<string, unknown>): Record<string, unknown> {
    // Already canonical: { events: { ... } }
    if (isPlainObject(config['events'])) {
      return { ...config, name }
    }
    // Legacy flat format: { eventName, rules: [...] }
    const eventName = (config['eventName'] as string) || 'PostToolUse'
    const rules = Array.isArray(config['rules']) ? config['rules'] : []
    const hooks = rules.map((r) => {
      const rule = r as Record<string, unknown>
      const entry: Record<string, unknown> = { type: rule['type'] ?? 'command' }
      if (rule['command']) entry['command'] = rule['command']
      if (rule['prompt']) entry['prompt'] = rule['prompt']
      return entry
    })
    return { name, events: { [eventName]: [{ hooks }] } }
  }

  private normalizeMCPConfig(name: string, config: Record<string, unknown>): Record<string, unknown> {
    // Already canonical: { serverConfig: { ... } }
    if (isPlainObject(config['serverConfig'])) {
      return { ...config, name }
    }
    // Legacy flat format: { type, command, args?, env? }
    const serverCfg: Record<string, unknown> = {
      type: config['type'] ?? 'stdio',
      command: config['command'] ?? '',
    }
    const args = Array.isArray(config['args']) ? config['args'] : []
    if (args.length > 0) serverCfg['args'] = args
    const env = isPlainObject(config['env']) ? config['env'] : {}
    if (Object.keys(env).length > 0) serverCfg['env'] = env
    return { name, serverConfig: serverCfg }
  }

  // ── Provenance recording ──────────────────────────────────────

  private async recordProvenance(item: ImportableItem): Promise<void> {
    await this.stateRepo.recordImport({
      category: item.category,
      name: item.name,
      sourcePath: item.sourcePath,
      sourceOrigin: item.sourceType,
      sourceHash: null,
      importedAt: Date.now(),
      // Marketplace provenance metadata (optional)
      ...(item.marketInfo
        ? {
            marketplaceId: item.marketInfo.marketplaceId,
            marketSlug: item.marketInfo.slug,
            marketVersion: item.marketInfo.version ?? null,
          }
        : {}),
    })
  }

  /**
   * For items imported FROM a managed engine source, record a distribution record
   * so the UI reflects that the capability already exists in that engine.
   */
  private async recordDistributionIfImportedFromEngine(item: ImportableItem, target: ImportTarget): Promise<void> {
    if (item.sourceType !== 'claude-code' && item.sourceType !== 'codex') return

    const targetType = item.sourceType === 'codex'
      ? resolveDistributionTargetType({ engineKind: 'codex', scope: item.sourceScope })
      : resolveDistributionTargetType({ engineKind: 'claude', scope: item.sourceScope })

    // Compute content hash from the stored copy (not the source file, which may
    // differ by the time we read it again — the store copy is the authoritative one).
    // Use resolveActualPath (not resolvePath) — skills may be stored as bundles
    // (skills/name/SKILL.md) rather than flat files (skills/name.md).
    const storedPath = await this.store.resolveActualPath(
      target.scope,
      item.category,
      item.name,
      target.projectPath,
    )
    if (!storedPath) {
      log.debug(`[${item.category}:${item.name}] Skip distribution record: stored path not found`)
      return
    }
    const content = await safeReadFile(storedPath)
    if (!content) {
      log.debug(`[${item.category}:${item.name}] Skip distribution record: stored content not readable`)
      return
    }

    const hash = `sha256:${createHash('sha256').update(content).digest('hex')}`

    const targetPath = this.resolveEngineTargetPath(item)

    await this.stateRepo.recordDistribution({
      category: item.category,
      name: item.name,
      targetType,
      targetPath,
      strategy: 'copy',
      contentHash: hash,
      distributedAt: Date.now(),
    })
    log.debug(`[${item.category}:${item.name}] Distribution record created (imported from ${item.sourceType})`)
  }

  /**
   * Resolve the canonical engine target path for an imported item.
   *
   * For document types (skill/command/agent/rule), sourcePath IS the file path.
   * For config types (hook/mcp-server), sourcePath may be composite
   * (e.g. "settings.json#hooks.Event") — strip the fragment.
   */
  private resolveEngineTargetPath(item: ImportableItem): string {
    const hashIdx = item.sourcePath.indexOf('#')
    return hashIdx !== -1 ? item.sourcePath.slice(0, hashIdx) : item.sourcePath
  }

  // ── Claude Code discovery ─────────────────────────────────────

  private async discoverFromClaudeCode(projectPath?: string): Promise<ImportableItem[]> {
    const claudePaths = resolveClaudeCodePaths(projectPath)

    // Pre-load existing capability names for "already imported" detection
    const existsCache = await this.buildExistsCache(projectPath)
    log.debug(`Exists cache built: ${existsCache.size} entries`)

    // Scan global ~/.claude/
    const globalItems = await this.scanClaudeDir(
      claudePaths.claudeDir,
      [claudePaths.claudeJson],
      'global',
      existsCache,
    )

    // Scan project-level {projectPath}/.claude/ (if applicable)
    let projectItems: ImportableItem[] = []
    if (claudePaths.project) {
      projectItems = await this.scanClaudeDir(
        claudePaths.project.claudeDir,
        // Prefer the current project MCP config location while keeping legacy compatibility.
        [claudePaths.project.mcpJson, path.join(claudePaths.project.root, '.claude.json')],
        'project',
        existsCache,
      )
    }

    // Note: plugin capabilities are surfaced via Virtual Plugin Mount in CapabilityStore,
    // not through the import pipeline. The discoverFromPlugins() method remains available
    // for explicit manual import via discoverImportable('plugin').

    return [...globalItems, ...projectItems]
  }

  /**
   * Scan a single .claude/ directory (global or project-level) for importable items.
   * Reused for both ~/.claude/ and {projectPath}/.claude/.
   */
  private async scanClaudeDir(
    claudeDir: string,
    claudeMcpConfigPaths: string[],
    sourceScope: 'global' | 'project',
    existsCache: Set<string>,
  ): Promise<ImportableItem[]> {
    const items: ImportableItem[] = []

    // ── Document-type categories ────────────────────────────────

    const scanTasks: Array<{
      category: ManagedCapabilityCategory
      dirName: string
      isSkill?: boolean
    }> = [
      { category: 'skill', dirName: 'skills', isSkill: true },
      { category: 'command', dirName: 'commands' },
      { category: 'agent', dirName: 'agents' },
      { category: 'rule', dirName: 'rules' },
    ]

    for (const task of scanTasks) {
      const dir = path.join(claudeDir, task.dirName)
      const entries = await safeDirEntries(dir)
      log.debug(`Scanning ${dir}: ${entries.length} entries`)

      for (const entry of entries) {
        if (task.isSkill) {
          // Skills are directories with SKILL.md inside
          if (!entry.isDir) continue
          const skillFile = path.join(dir, entry.name, 'SKILL.md')
          const content = await safeReadFile(skillFile)
          if (!content) continue
          const { attributes } = parseFrontmatter(content)
          items.push({
            name: entry.name,
            category: 'skill',
            description: (attributes['description'] as string) ?? '',
            sourcePath: skillFile,
            sourceType: 'claude-code',
            alreadyImported: existsCache.has(`skill:${entry.name}`),
            sourceScope,
            isBundle: true,
          })
        } else {
          // Other doc categories are single .md files
          if (entry.isDir || !entry.name.endsWith('.md')) continue
          const filePath = path.join(dir, entry.name)
          const content = await safeReadFile(filePath)
          if (!content) continue
          const { attributes } = parseFrontmatter(content)
          const name = entry.name.replace(/\.md$/, '')
          items.push({
            name,
            category: task.category,
            description: (attributes['description'] as string) ?? '',
            sourcePath: filePath,
            sourceType: 'claude-code',
            alreadyImported: existsCache.has(`${task.category}:${name}`),
            sourceScope,
          })
        }
      }
    }

    // ── Hook import from settings.json ──────────────────────────

    const settingsPath = path.join(claudeDir, 'settings.json')
    const settings = await safeReadJson(settingsPath)
    const hooksConfig = (settings['hooks'] ?? {}) as Record<string, unknown[]>

    for (const [eventName, ruleGroups] of Object.entries(hooksConfig)) {
      if (!Array.isArray(ruleGroups)) continue

      for (const group of ruleGroups) {
        const g = group as Record<string, unknown>
        // Skip OpenCow-managed hooks (marked with __opencow__)
        if (g[HOOK_MARKER_KEY]) continue

        const hooks = (g['hooks'] ?? []) as Array<Record<string, unknown>>
        for (const hook of hooks) {
          if (hook['type'] === 'command' && typeof hook['command'] === 'string') {
            const hookName = this.inferHookName(hook['command'], eventName)
            if (!hookName) continue

            items.push({
              name: hookName,
              category: 'hook',
              description: `Imported from Claude Code settings.json (${eventName})`,
              sourcePath: `${settingsPath}#hooks.${eventName}`,
              sourceType: 'claude-code',
              alreadyImported: existsCache.has(`hook:${hookName}`),
              sourceScope,
            })
          }
        }
      }
    }

    // ── MCP Server import from Claude/Cursor MCP config JSON ────

    const seenMcpNames = new Set<string>()
    for (const configPath of claudeMcpConfigPaths) {
      const config = await safeReadJson(configPath)
      const mcpServers = (config['mcpServers'] ?? {}) as Record<string, unknown>

      for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
        if (!isPlainObject(serverConfig)) continue
        if (seenMcpNames.has(serverName)) continue
        seenMcpNames.add(serverName)

        items.push({
          name: serverName,
          category: 'mcp-server',
          description: `MCP Server from ${sourceScope === 'project' ? 'project' : 'global'} ${path.basename(configPath)}`,
          sourcePath: configPath,
          sourceType: 'claude-code',
          alreadyImported: existsCache.has(`mcp-server:${serverName}`),
          sourceScope,
        })
      }
    }

    return items
  }

  // ── Codex discovery ───────────────────────────────────────────

  private async discoverFromCodex(projectPath?: string): Promise<ImportableItem[]> {
    const existsCache = await this.buildExistsCache(projectPath)

    const globalItems = await this.scanCodexScope({
      sourceScope: 'global',
      existsCache,
    })

    const projectItems = projectPath
      ? await this.scanCodexScope({
          sourceScope: 'project',
          projectPath,
          existsCache,
        })
      : []

    return [...globalItems, ...projectItems]
  }

  private async scanCodexScope(params: {
    sourceScope: 'global' | 'project'
    projectPath?: string
    existsCache: Set<string>
  }): Promise<ImportableItem[]> {
    const items: ImportableItem[] = []
    const { sourceScope, existsCache, projectPath } = params

    const skillsDir = resolveCodexSkillsDir({ scope: sourceScope, projectPath })
    const skillEntries = await safeDirEntries(skillsDir)
    for (const entry of skillEntries) {
      if (!entry.isDir) continue
      const skillFile = resolveCodexSkillFilePath({ scope: sourceScope, projectPath, name: entry.name })
      const content = await safeReadFile(skillFile)
      if (!content) continue
      const { attributes } = parseFrontmatter(content)
      items.push({
        name: entry.name,
        category: 'skill',
        description: (attributes['description'] as string) ?? '',
        sourcePath: skillFile,
        sourceType: 'codex',
        alreadyImported: existsCache.has(`skill:${entry.name}`),
        sourceScope,
        isBundle: true,
      })
    }

    const codexConfigPath = resolveCodexConfigPath({ scope: sourceScope, projectPath })
    const configToml = await safeReadFile(codexConfigPath)
    if (!configToml) return items

    const mcpServers = extractMcpServersFromToml(configToml)
    for (const [serverName] of Object.entries(mcpServers)) {
      items.push({
        name: serverName,
        category: 'mcp-server',
        description: `MCP Server from ${sourceScope === 'project' ? 'project' : 'global'} codex config`,
        sourcePath: `${codexConfigPath}#mcp_servers.${serverName}`,
        sourceType: 'codex',
        alreadyImported: existsCache.has(`mcp-server:${serverName}`),
        sourceScope,
      })
    }

    return items
  }

  // ── Plugin discovery ──────────────────────────────────────────

  /**
   * Discover importable capabilities from installed Claude Code plugins.
   *
   * Delegates to `pluginResolver.resolvePlugins()` for plugin enumeration and
   * `resolveCapabilityDirs()` for directory resolution.  This ensures the import
   * pipeline honours the same convention-over-configuration contract as the
   * capability scanners — manifest-declared paths first, then fallback to both
   * `{installPath}/{category}/` and `{installPath}/.claude/{category}/`.
   */
  private async discoverFromPlugins(): Promise<ImportableItem[]> {
    const items: ImportableItem[] = []
    const existsCache = await this.buildExistsCache()

    // Resolve all installed plugins via the shared Plugin Resolver
    const plugins = await resolvePlugins(resolveClaudeCodePaths())

    const scanDefs: Array<{
      category: ManagedCapabilityCategory
      dirKey: 'skills' | 'commands' | 'agents'
      isSkill?: boolean
    }> = [
      { category: 'skill', dirKey: 'skills', isSkill: true },
      { category: 'command', dirKey: 'commands' },
      { category: 'agent', dirKey: 'agents' },
    ]

    for (const plugin of plugins) {
      for (const task of scanDefs) {
        // Use pluginResolver's convention-over-configuration resolution:
        //   1. Manifest-declared paths (if present)
        //   2. Fallback: {installPath}/{category}/ + {installPath}/.claude/{category}/
        const dirs = resolveCapabilityDirs(plugin, task.dirKey)

        for (const dir of dirs) {
          const entries = await safeDirEntries(dir)

          for (const entry of entries) {
            if (task.isSkill && entry.isDir) {
              const skillFile = path.join(dir, entry.name, 'SKILL.md')
              const content = await safeReadFile(skillFile)
              if (!content) continue
              const { attributes } = parseFrontmatter(content)
              const name = `${plugin.name}--${entry.name}`
              if (items.some(i => i.category === 'skill' && i.name === name)) continue // dedup across dirs
              items.push({
                name,
                category: 'skill',
                description: (attributes['description'] as string) ?? '',
                sourcePath: skillFile,
                sourceType: 'plugin',
                alreadyImported: existsCache.has(`skill:${name}`),
                sourceScope: 'global',
                isBundle: true,
              })
            } else if (!task.isSkill && !entry.isDir && entry.name.endsWith('.md')) {
              const filePath = path.join(dir, entry.name)
              const content = await safeReadFile(filePath)
              if (!content) continue
              const { attributes } = parseFrontmatter(content)
              const name = `${plugin.name}--${entry.name.replace(/\.md$/, '')}`
              if (items.some(i => i.category === task.category && i.name === name)) continue // dedup
              items.push({
                name,
                category: task.category,
                description: (attributes['description'] as string) ?? '',
                sourcePath: filePath,
                sourceType: 'plugin',
                alreadyImported: existsCache.has(`${task.category}:${name}`),
                sourceScope: 'global',
              })
            }
          }
        }
      }
    }

    return items
  }

  // ── Template discovery ────────────────────────────────────────

  private async discoverFromTemplates(): Promise<ImportableItem[]> {
    const items: ImportableItem[] = []

    for (const tpl of BUILT_IN_TEMPLATES) {
      const exists = await this.store.exists('global', tpl.category, tpl.name)
      items.push({
        name: tpl.name,
        category: tpl.category,
        description: tpl.description,
        sourcePath: `template://${tpl.name}`,
        sourceType: 'template',
        alreadyImported: exists,
        sourceScope: 'global',
      })
    }

    return items
  }

  // ── File discovery ───────────────────────────────────────────

  /**
   * Discover importable items from user-selected file paths.
   */
  private async discoverFromFiles(filePaths: string[], projectPath?: string): Promise<ImportableItem[]> {
    const items: ImportableItem[] = []
    const existsCache = await this.buildExistsCache(projectPath)
    const seen = new Set<string>() // dedup key: "category:name"
    log.debug(`[file] Analyzing ${filePaths.length} user-selected paths`)

    for (const filePath of filePaths) {
      const stat = await fs.stat(filePath).catch(() => null)
      if (!stat) {
        log.warn(`[file] Skipping inaccessible path: ${filePath}`)
        continue
      }

      if (stat.isDirectory()) {
        await this.discoverFromDirectory(filePath, items, existsCache, 0, seen)
      } else if (stat.isFile()) {
        // User directly selected a SKILL.md → treat as selecting its parent bundle directory
        if (path.basename(filePath) === SKILL_BUNDLE_FILENAME) {
          await this.discoverFromDirectory(path.dirname(filePath), items, existsCache, 0, seen)
        } else {
          const item = await this.analyzeFile(filePath, existsCache)
          if (item) {
            const key = `${item.category}:${item.name}`
            if (!seen.has(key)) {
              seen.add(key)
              items.push(item)
            }
          }
        }
      }
    }

    log.info(`[file] Discovered ${items.length} items from ${filePaths.length} paths`)
    return items
  }

  /**
   * Recursively scan a directory for importable capability files.
   *
   * @param depth — current recursion depth (capped at MAX_FILE_DISCOVER_DEPTH)
   */
  private async discoverFromDirectory(
    dirPath: string,
    items: ImportableItem[],
    existsCache: Set<string>,
    depth: number,
    seen: Set<string>,
  ): Promise<void> {
    if (depth >= MAX_FILE_DISCOVER_DEPTH) {
      log.debug(`[file] Skipping deep directory (depth ${depth}): ${dirPath}`)
      return
    }

    const entries = await safeDirEntries(dirPath)

    // Case 1: this directory IS a skill bundle (contains SKILL.md)
    const hasSkillMd = entries.some((e) => e.name === SKILL_BUNDLE_FILENAME && e.isFile)
    if (hasSkillMd) {
      const skillPath = path.join(dirPath, SKILL_BUNDLE_FILENAME)
      const name = path.basename(dirPath)
      const key = `skill:${name}`
      if (!seen.has(key)) {
        seen.add(key)
        const content = await safeReadFile(skillPath)
        const { attributes } = content ? parseFrontmatter(content) : { attributes: {} as Record<string, unknown> }
        items.push({
          name,
          category: 'skill',
          description: ((attributes as Record<string, unknown>)['description'] as string) ?? '',
          sourcePath: skillPath,
          sourceType: 'file',
          alreadyImported: existsCache.has(key),
          sourceScope: 'global',
          isBundle: true,
        })
      }
      return // don't recurse into skill bundle internals
    }

    // Case 2: regular directory — recurse into children
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDir) {
        await this.discoverFromDirectory(fullPath, items, existsCache, depth + 1, seen)
      } else if (entry.isFile) {
        const item = await this.analyzeFile(fullPath, existsCache)
        if (item) {
          const key = `${item.category}:${item.name}`
          if (!seen.has(key)) {
            seen.add(key)
            items.push(item)
          }
        }
      }
    }
  }

  /**
   * Analyze a single file and produce an ImportableItem (or null if unsupported).
   */
  private async analyzeFile(
    filePath: string,
    existsCache: Set<string>,
  ): Promise<ImportableItem | null> {
    const ext = path.extname(filePath).toLowerCase()
    const baseName = path.basename(filePath, ext)
    const parentDirName = path.basename(path.dirname(filePath))

    // ── Markdown → document-type capability ──
    if (ext === '.md') {
      // SKILL.md should be discovered via directory scan, not standalone
      if (baseName === 'SKILL') return null

      const content = await safeReadFile(filePath)
      if (!content) return null

      const { attributes } = parseFrontmatter(content)
      const name = (attributes['name'] as string) || baseName
      const description = (attributes['description'] as string) || ''
      const category = inferCapabilityCategory({
        ext,
        parentDirName,
        frontmatterAttributes: attributes,
      })

      return {
        name,
        category,
        description,
        sourcePath: filePath,
        sourceType: 'file',
        alreadyImported: existsCache.has(`${category}:${name}`),
        sourceScope: 'global',
      }
    }

    // ── JSON → config-type capability ──
    if (ext === '.json') {
      const config = await safeReadJson(filePath)
      if (!isPlainObject(config) || Object.keys(config).length === 0) return null

      const name = baseName
      const description = (config['description'] as string) ?? ''
      const category = inferCapabilityCategory({
        ext,
        parentDirName,
        jsonKeys: Object.keys(config),
      })

      return {
        name,
        category,
        description,
        sourcePath: filePath,
        sourceType: 'file',
        alreadyImported: existsCache.has(`${category}:${name}`),
        sourceScope: 'global',
      }
    }

    return null // unsupported file type
  }

  // ── Helpers ───────────────────────────────────────────────────

  /**
   * Infer a hook name from its command path.
   *
   * Examples:
   *   "~/.opencow/hooks/deploy-guard.sh" → "deploy-guard"
   *   "bash -c 'echo test'" → "cli-hook-PreToolUse-a1b2c3d4"
   */
  private inferHookName(command: string, eventName: string): string | null {
    // Try extracting filename from path
    const match = command.match(/([^/\\]+?)(?:\.\w+)?$/)
    if (match?.[1] && !match[1].includes(' ')) {
      return match[1]
    }
    // Inline command: generate deterministic name from content hash
    const hash = createHash('sha256').update(command).digest('hex').slice(0, 8)
    return `cli-hook-${eventName}-${hash}`
  }

  /**
   * Build a Set of "category:name" strings for quick "already imported" checks.
   * Checks both global and project scopes (if projectPath provided).
   */
  private async buildExistsCache(projectPath?: string): Promise<Set<string>> {
    const cache = new Set<string>()
    const categories: ManagedCapabilityCategory[] = [
      'skill', 'agent', 'command', 'rule', 'hook', 'mcp-server',
    ]

    for (const category of categories) {
      // Global scope
      const globalEntries = await this.store.list('global', category)
      for (const entry of globalEntries) {
        cache.add(`${category}:${entry.name}`)
      }
      // Project scope (if applicable)
      if (projectPath) {
        const projectEntries = await this.store.list('project', category, projectPath)
        for (const entry of projectEntries) {
          cache.add(`${category}:${entry.name}`)
        }
      }
    }

    return cache
  }
}

// ─── Module-level helpers ───────────────────────────────────────────────

/** Check whether a directory entry should be skipped during asset collection. */
function shouldSkipEntry(entry: { name: string; isDir: boolean; isFile: boolean }): boolean {
  // Hidden files/directories (dotfiles) — except explicitly allowed ones
  if (entry.name.startsWith('.')) return true

  if (entry.isDir) {
    return IGNORED_DIRS.has(entry.name)
  }

  if (entry.isFile) {
    if (IGNORED_FILES.has(entry.name)) return true
    const ext = path.extname(entry.name).toLowerCase()
    return IGNORED_EXTENSIONS.has(ext)
  }

  return false // symlinks etc. — let the caller decide
}

function sourceTypeToEngineKind(sourceType: ImportSourceType): GovernanceEngineKind | null {
  if (sourceType === 'claude-code') return 'claude'
  if (sourceType === 'codex') return 'codex'
  return null
}
