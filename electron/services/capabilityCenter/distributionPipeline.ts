// SPDX-License-Identifier: Apache-2.0

/**
 * Distribution Pipeline — publishes capabilities to managed engine targets.
 *
 * v3.1 fixes:
 *   #10 — detectDrift uses camelCase DistributionRecord fields
 *   #21 — atomicWriteJson cleans up .tmp residuals on failure
 *   #27 — shared fsUtils
 */

import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { ManagedCapabilityCategory } from '@shared/types'
import { HOOK_MARKER_KEY } from '@shared/appIdentity'
import { isPlainObject } from '@shared/typeGuards'
import { type CapabilityStore, SKILL_BUNDLE_FILENAME } from './capabilityStore'
import type { StateRepository, DistributionRecord } from './stateRepository'
import { safeReadFile, safeReadJson } from './shared/fsUtils'
import {
  type CapabilityDistributionTargetType,
  isClaudeCodeTargetType,
  isCodexTargetType,
} from './distributionTargets'
import { ClaudeGovernanceDriver } from './governance/claudeGovernanceDriver'
import type { EngineGovernanceDriver } from './governance/engineGovernanceDriver'

// ─── Types ──────────────────────────────────────────────────────────────

export type DistributionTarget =
  | { type: 'claude-code-global' }
  | { type: 'claude-code-project'; projectPath: string }

export interface DriftReport {
  category: ManagedCapabilityCategory
  name: string
  targetType: string
  targetPath: string
  reason: string
  staleHash: string
  currentHash: string
}

export interface SyncResult {
  synced: string[]
  errors: string[]
}

type GovernanceEngineKind = 'claude'

// ─── DistributionPipeline ───────────────────────────────────────────────

export class DistributionPipeline {
  private readonly governanceDrivers: Record<GovernanceEngineKind, EngineGovernanceDriver>

  constructor(
    private readonly store: CapabilityStore,
    private readonly stateRepo: StateRepository,
  ) {
    this.governanceDrivers = this.createGovernanceDrivers()
  }

  // ── Publish ─────────────────────────────────────────────────────

  async publish(params: {
    category: ManagedCapabilityCategory
    name: string
    target: DistributionTarget
    strategy?: 'copy' | 'symlink'
  }): Promise<void> {
    const { category, name, target, strategy = 'copy' } = params
    const engineKind = targetTypeToEngineKind(target.type)
    const driver = this.governanceDrivers[engineKind]
    if (!driver.supports(category, 'publish')) {
      throw new Error(`${driver.engineKind} does not support category=${category}`)
    }
    await driver.publish({
      category,
      name,
      target: target.type,
      projectPath: 'projectPath' in target ? target.projectPath : undefined,
      store: this.store,
      stateRepo: this.stateRepo,
      strategy,
    })
  }

  // ── Unpublish ───────────────────────────────────────────────────

  async unpublish(params: {
    category: ManagedCapabilityCategory
    name: string
    target: DistributionTarget
  }): Promise<void> {
    const { category, name, target } = params
    const engineKind = targetTypeToEngineKind(target.type)
    const driver = this.governanceDrivers[engineKind]
    if (!driver.supports(category, 'unpublish')) {
      throw new Error(`${driver.engineKind} does not support category=${category}`)
    }
    await driver.unpublish({
      category,
      name,
      target: target.type,
      projectPath: 'projectPath' in target ? target.projectPath : undefined,
      stateRepo: this.stateRepo,
    })
  }

  // ── Drift Detection ─────────────────────────────────────────────

  async detectDrift(options?: { engineKind?: GovernanceEngineKind }): Promise<DriftReport[]> {
    const distributions = await this.stateRepo.getAllDistributions()
    const claudeDistributions = distributions.filter((d) =>
      isClaudeCodeTargetType(d.targetType) && (!options?.engineKind || options.engineKind === 'claude'),
    )
    const unknownDistributions = distributions.filter(
      (d) => !isClaudeCodeTargetType(d.targetType) && !isCodexTargetType(d.targetType),
    )

    const [claudeDrifts, unknownDrifts] = await Promise.all([
      this.governanceDrivers.claude.detectDrift({ distributions: claudeDistributions, store: this.store }),
      this.detectDriftForDistributions(unknownDistributions),
    ])

    return [...claudeDrifts, ...unknownDrifts]
  }

  // ── Single Capability Sync ────────────────────────────────────────

  /**
   * Re-publish a single capability to all its known distribution targets.
   * Called automatically after save — fire-and-forget, never throws.
   *
   * If the capability has no distribution records, this is a no-op.
   */
  async syncCapability(
    category: ManagedCapabilityCategory,
    name: string,
    options?: { engineKind?: GovernanceEngineKind },
  ): Promise<SyncResult> {
    const distributions = await this.stateRepo.getDistributionsFor(category, name)
    const filtered = options?.engineKind
      ? distributions.filter((d) => targetTypeToEngineKindStrict(d.targetType) === options.engineKind)
      : distributions
    return this.republishAll(
      filtered.map((d) => ({
        category,
        name,
        targetType: d.targetType,
        targetPath: d.targetPath,
        strategy: d.strategy,
      })),
    )
  }

  // ── Unpublish All ──────────────────────────────────────────────

  /**
   * Unpublish a capability from ALL its known distribution targets.
   * Called when a capability is deleted or toggled off — fire-and-forget.
   */
  async unpublishAll(
    category: ManagedCapabilityCategory,
    name: string,
  ): Promise<void> {
    const distributions = await this.stateRepo.getDistributionsFor(category, name)
    for (const dist of distributions) {
      const target = reconstructTarget(dist.targetType, dist.targetPath)
      if (!target) {
        await this.stateRepo.removeDistribution(category, name, dist.targetType).catch(() => {})
        continue
      }
      await this.unpublish({ category, name, target })
        .catch(() => {}) // best-effort — swallow per-target errors
    }
  }

  // ── Full Sync ───────────────────────────────────────────────────

  /** Sync all drifted distributions (source modified since last publish). */
  async syncAll(options?: { engineKind?: GovernanceEngineKind }): Promise<SyncResult> {
    const drifts = await this.detectDrift(options)
    return this.republishAll(
      drifts.map((d) => ({
        category: d.category,
        name: d.name,
        targetType: d.targetType,
        targetPath: d.targetPath,
      })),
    )
  }

  // ── Shared sync core ──────────────────────────────────────────

  /**
   * Re-publish a list of distribution entries to their reconstructed targets.
   * Shared by syncCapability (all targets for one capability) and syncAll (drifted targets).
   */
  private async republishAll(
    entries: Array<{
      category: ManagedCapabilityCategory
      name: string
      targetType: string
      targetPath: string
      strategy?: 'copy' | 'symlink'
    }>,
  ): Promise<SyncResult> {
    const result: SyncResult = { synced: [], errors: [] }
    if (entries.length === 0) return result

    for (const entry of entries) {
      const label = `${entry.category}:${entry.name}→${entry.targetType}`
      try {
        const target = reconstructTarget(entry.targetType, entry.targetPath)
        if (!target) {
          result.errors.push(`${label} — unsupported target type`)
          continue
        }
        await this.publish({
          category: entry.category,
          name: entry.name,
          target,
          strategy: entry.strategy,
        })
        result.synced.push(label)
      } catch (err) {
        result.errors.push(`${label} — ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return result
  }

  private createGovernanceDrivers(): Record<GovernanceEngineKind, EngineGovernanceDriver> {
    const unsupportedOpError = (op: string): Error =>
      new Error(`Operation "${op}" is not handled by DistributionPipeline governance drivers`)
    const resolveTarget = (
      targetType: CapabilityDistributionTargetType,
      projectPath?: string,
    ): DistributionTarget => {
      if (targetType.endsWith('-project')) {
        if (!projectPath) {
          throw new Error(`projectPath is required for target type "${targetType}"`)
        }
        return { type: 'claude-code-project', projectPath }
      }
      return { type: 'claude-code-global' }
    }

    return {
      claude: new ClaudeGovernanceDriver({
        discover: async () => { throw unsupportedOpError('discover') },
        importItem: async () => { throw unsupportedOpError('import') },
        publish: async ({ category, name, target, projectPath, strategy }) => {
          const resolvedTarget = resolveTarget(target, projectPath)
          switch (category) {
            case 'hook':
              await this.publishHook(name, resolvedTarget)
              return
            case 'mcp-server':
              await this.publishMcpServerClaude(name, resolvedTarget)
              return
            default:
              await this.publishDocument(category, name, resolvedTarget, strategy ?? 'copy')
          }
        },
        unpublish: async ({ category, name, target, projectPath }) => {
          const resolvedTarget = resolveTarget(target, projectPath)
          switch (category) {
            case 'hook':
              await this.unpublishHook(name, resolvedTarget)
              return
            case 'mcp-server':
              await this.unpublishMcpServerClaude(name, resolvedTarget)
              return
            default:
              await this.unpublishDocument(category, name, resolvedTarget)
          }
        },
        detectDrift: async ({ distributions }) => this.detectDriftForDistributions(distributions),
      }),
    }
  }

  private async detectDriftForDistributions(
    distributions: DistributionRecord[],
  ): Promise<DriftReport[]> {
    const drifts: DriftReport[] = []
    for (const dist of distributions) {
      // resolveActualPath handles skill dual storage transparently
      const sourcePath = await this.store.resolveActualPath('global', dist.category, dist.name)
      if (!sourcePath) continue

      const sourceContent = await safeReadFile(sourcePath)
      if (!sourceContent) continue

      const currentHash = contentHash(sourceContent)
      if (currentHash !== dist.contentHash) {
        drifts.push({
          category: dist.category,
          name: dist.name,
          targetType: dist.targetType,
          targetPath: dist.targetPath,
          reason: 'Source modified since last publish',
          staleHash: dist.contentHash,
          currentHash,
        })
      }
    }
    return drifts
  }

  // ── Document distribution (Skills / Agents / Commands / Rules) ──

  private async publishDocument(
    category: ManagedCapabilityCategory,
    name: string,
    target: DistributionTarget,
    strategy: 'copy' | 'symlink',
  ): Promise<void> {
    // 1. Resolve source (actual path, handles skill dual storage)
    const sourcePath = await this.store.resolveActualPath('global', category, name)
    if (!sourcePath) throw new Error(`${category} not found: ${name}`)

    // 2. Resolve target
    const targetPath = this.resolveDocumentTarget(category, name, target)
    await fs.mkdir(path.dirname(targetPath), { recursive: true })

    // 3. Distribute — skills may be directories; all others are single files
    if (category === 'skill') {
      await this.distributeSkill(sourcePath, targetPath, strategy)
    } else {
      await this.distributeSingleFile(sourcePath, targetPath, strategy)
    }

    // 4. Record distribution state (common for all document types)
    const content = await fs.readFile(sourcePath, 'utf-8')
    await this.stateRepo.recordDistribution({
      category,
      name,
      targetType: target.type,
      targetPath,
      strategy,
      contentHash: contentHash(content),
      distributedAt: Date.now(),
    })
  }

  /** Distribute a skill — bundles copy the whole directory, flat files copy as SKILL.md. */
  private async distributeSkill(
    sourcePath: string,
    targetPath: string,
    strategy: 'copy' | 'symlink',
  ): Promise<void> {
    const isBundle = path.basename(sourcePath) === SKILL_BUNDLE_FILENAME
    const targetDir = path.dirname(targetPath)

    if (isBundle) {
      // Bundle: copy/symlink the entire skill directory (may contain assets/scripts)
      const sourceDir = path.dirname(sourcePath)
      if (strategy === 'symlink') {
        await fs.rm(targetDir, { recursive: true, force: true })
        await fs.symlink(sourceDir, targetDir)
      } else {
        // Atomic swap: write to tmp dir, then rename
        const tmpDir = `${targetDir}.tmp.${process.pid}`
        try {
          await fs.cp(sourceDir, tmpDir, { recursive: true })
          await fs.rm(targetDir, { recursive: true, force: true })
          await fs.rename(tmpDir, targetDir)
        } catch (err) {
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
          throw err
        }
      }
    } else {
      // Flat file: copy single file into target bundle structure
      await fs.mkdir(targetDir, { recursive: true })
      await this.distributeSingleFile(sourcePath, targetPath, strategy)
    }
  }

  /** Copy or symlink a single file. */
  private async distributeSingleFile(
    sourcePath: string,
    targetPath: string,
    strategy: 'copy' | 'symlink',
  ): Promise<void> {
    if (strategy === 'symlink') {
      await fs.unlink(targetPath).catch((e) => { if (!isEnoent(e)) throw e })
      await fs.symlink(sourcePath, targetPath)
    } else {
      await fs.copyFile(sourcePath, targetPath)
    }
  }

  private async unpublishDocument(
    category: ManagedCapabilityCategory,
    name: string,
    target: DistributionTarget,
  ): Promise<void> {
    const targetPath = this.resolveDocumentTarget(category, name, target)

    if (category === 'skill') {
      await fs.rm(path.dirname(targetPath), { recursive: true, force: true })
    } else {
      await fs.unlink(targetPath).catch((e) => { if (!isEnoent(e)) throw e })
    }

    await this.stateRepo.removeDistribution(category, name, target.type)
  }

  private resolveDocumentTarget(
    category: ManagedCapabilityCategory,
    name: string,
    target: DistributionTarget,
  ): string {
    const baseDir =
      target.type === 'claude-code-global'
        ? path.join(os.homedir(), '.claude')
        : path.join((target as { projectPath: string }).projectPath, '.claude')

    switch (category) {
      case 'skill':
        return path.join(baseDir, 'skills', name, SKILL_BUNDLE_FILENAME)
      case 'command':
        return path.join(baseDir, 'commands', `${name}.md`)
      case 'agent':
        return path.join(baseDir, 'agents', `${name}.md`)
      case 'rule':
        return path.join(baseDir, 'rules', `${name}.md`)
      default:
        throw new Error(`Unsupported document category for distribution: ${category}`)
    }
  }

  // ── Hook distribution (settings.json merge) ─────────────────────

  private async publishHook(name: string, target: DistributionTarget): Promise<void> {
    const hookPath = this.store.resolvePath('global', 'hook', name)
    const hookContent = await safeReadFile(hookPath)
    if (!hookContent) throw new Error(`Hook not found: ${name}`)

    const parsed = JSON.parse(hookContent) as unknown
    if (!isPlainObject(parsed)) {
      throw new Error(`Invalid hook config for "${name}": expected a JSON object`)
    }
    const hookEvents = parsed['events']
    if (!isPlainObject(hookEvents)) {
      throw new Error(`Invalid hook config for "${name}": missing or invalid "events" field`)
    }

    const settingsPath = this.resolveSettingsPath(target)
    const settings = await safeReadJson(settingsPath)
    const hooks = (settings['hooks'] ?? {}) as Record<string, unknown[]>

    // Merge hook rules into settings.json, replacing existing entries with same marker
    for (const [event, ruleGroups] of Object.entries(hookEvents as Record<string, unknown[]>)) {
      if (!hooks[event]) hooks[event] = []

      // Remove existing entries with same opencow marker
      hooks[event] = (hooks[event] as Array<Record<string, unknown>>).filter(
        (g) => g[HOOK_MARKER_KEY] !== `opencow:${name}`,
      )

      // Add new entries with marker
      for (const group of ruleGroups as Array<Record<string, unknown>>) {
        hooks[event].push({ ...group, [HOOK_MARKER_KEY]: `opencow:${name}` })
      }
    }

    settings['hooks'] = hooks
    await atomicWriteJson(settingsPath, settings)

    await this.stateRepo.recordDistribution({
      category: 'hook',
      name,
      targetType: target.type,
      targetPath: settingsPath,
      strategy: 'copy',
      contentHash: contentHash(hookContent),
      distributedAt: Date.now(),
    })
  }

  private async unpublishHook(name: string, target: DistributionTarget): Promise<void> {
    const settingsPath = this.resolveSettingsPath(target)
    const settings = await safeReadJson(settingsPath)
    const hooks = (settings['hooks'] ?? {}) as Record<string, unknown[]>

    // Remove all entries with this hook's marker
    for (const event of Object.keys(hooks)) {
      hooks[event] = (hooks[event] as Array<Record<string, unknown>>).filter(
        (g) => g[HOOK_MARKER_KEY] !== `opencow:${name}`,
      )
      if (hooks[event].length === 0) delete hooks[event]
    }

    settings['hooks'] = hooks
    await atomicWriteJson(settingsPath, settings)
    await this.stateRepo.removeDistribution('hook', name, target.type)
  }

  // ── MCP Server distribution (Claude JSON + Codex TOML) ───────────

  private async publishMcpServerClaude(name: string, target: DistributionTarget): Promise<void> {
    const mcpPath = this.store.resolvePath('global', 'mcp-server', name)
    const mcpContent = await safeReadFile(mcpPath)
    if (!mcpContent) throw new Error(`MCP Server not found: ${name}`)

    const parsed = JSON.parse(mcpContent) as unknown
    if (!isPlainObject(parsed)) {
      throw new Error(`Invalid MCP server config for "${name}": expected a JSON object`)
    }
    const serverConfig = parsed['serverConfig']
    if (!isPlainObject(serverConfig)) {
      throw new Error(`Invalid MCP server config for "${name}": missing "serverConfig" field`)
    }

    const configPath = this.resolveClaudeMcpConfigPath(target)
    const config = await safeReadJson(configPath)
    const mcpServers = (config['mcpServers'] ?? {}) as Record<string, unknown>
    mcpServers[name] = serverConfig
    config['mcpServers'] = mcpServers

    await atomicWriteJson(configPath, config)

    await this.stateRepo.recordDistribution({
      category: 'mcp-server',
      name,
      targetType: target.type,
      targetPath: configPath,
      strategy: 'copy',
      contentHash: contentHash(mcpContent),
      distributedAt: Date.now(),
    })
  }

  private async unpublishMcpServerClaude(name: string, target: DistributionTarget): Promise<void> {
    const configPath = this.resolveClaudeMcpConfigPath(target)
    const config = await safeReadJson(configPath)
    const mcpServers = (config['mcpServers'] ?? {}) as Record<string, unknown>
    delete mcpServers[name]
    config['mcpServers'] = mcpServers

    await atomicWriteJson(configPath, config)
    await this.stateRepo.removeDistribution('mcp-server', name, target.type)
  }

  // ── Path helpers ────────────────────────────────────────────────

  private resolveSettingsPath(target: DistributionTarget): string {
    if (target.type === 'claude-code-global') {
      return path.join(os.homedir(), '.claude', 'settings.json')
    }
    return path.join(target.projectPath, '.claude', 'settings.json')
  }

  private resolveClaudeMcpConfigPath(target: DistributionTarget): string {
    if (target.type === 'claude-code-global') {
      return path.join(os.homedir(), '.claude.json')
    }
    return path.join(target.projectPath, '.mcp.json')
  }

}

// ─── Utility Functions ──────────────────────────────────────────────────

function contentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

/**
 * Reconstruct a DistributionTarget from persisted targetType + targetPath.
 * Centralises the reverse-engineering of project paths from distribution records.
 */
function reconstructTarget(targetType: string, targetPath: string): DistributionTarget | null {
  if (isClaudeCodeTargetType(targetType)) {
    return targetType === 'claude-code-project'
      ? { type: 'claude-code-project', projectPath: extractProjectPath(targetPath) }
      : { type: 'claude-code-global' }
  }
  return null
}

function targetTypeToEngineKind(_targetType: CapabilityDistributionTargetType): GovernanceEngineKind {
  return 'claude'
}

function targetTypeToEngineKindStrict(targetType: string): GovernanceEngineKind | null {
  if (isClaudeCodeTargetType(targetType)) return 'claude'
  return null
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT'
}

/**
 * Extract the project path from a distribution target path.
 *
 * Distribution paths for project targets follow the pattern:
 *   /some/project/.claude/skills/foo/SKILL.md
 *   /some/project/.claude/settings.json
 *   /some/project/.mcp.json
 *   /some/project/.agents/skills/foo/SKILL.md
 *   /some/project/.codex/config.toml
 *
 * We look for the `.claude` directory or `.mcp.json` suffix to find the boundary.
 */
function extractProjectPath(targetPath: string): string {
  const claudeIdx = targetPath.indexOf(`${path.sep}.claude${path.sep}`)
  if (claudeIdx !== -1) return targetPath.slice(0, claudeIdx)

  const agentsIdx = targetPath.indexOf(`${path.sep}.agents${path.sep}`)
  if (agentsIdx !== -1) return targetPath.slice(0, agentsIdx)

  const codexConfigSuffix = `${path.sep}.codex${path.sep}config.toml`
  const codexIdx = targetPath.indexOf(codexConfigSuffix)
  if (codexIdx !== -1) return targetPath.slice(0, codexIdx)

  // .mcp.json sits directly in the project root
  if (targetPath.endsWith('.mcp.json')) return path.dirname(targetPath)

  // Fallback: two levels up from target file (e.g., .claude/settings.json)
  return path.dirname(path.dirname(targetPath))
}

/**
 * Atomic JSON write: write to .tmp then rename.
 * v3.1 fix #21: cleans up .tmp residual on failure.
 */
async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp.${process.pid}`
  try {
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmpPath, filePath)
  } catch (err) {
    // v3.1 fix #21: cleanup residual .tmp file
    await fs.unlink(tmpPath).catch(() => {})
    throw err
  }
}


