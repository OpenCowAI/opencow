// SPDX-License-Identifier: Apache-2.0

/**
 * ClonePipeline — cross-project capability cloning.
 *
 * Reads capabilities from a source project's file-system store and writes
 * independent copies to a target project. Handles:
 *   - All 6 capability categories (skill, agent, command, rule, hook, mcp-server)
 *   - Skill bundles (SKILL.md + asset directories)
 *   - Conflict detection (pre-check) and resolution (skip / overwrite / rename)
 *   - Name synchronisation in frontmatter / JSON when renaming
 *
 * Design decisions (see docs/superpowers/specs/2026-03-17-clone-capabilities-design.md):
 *   - Separate from ImportPipeline: different source semantics (already-normalised
 *     StoreEntry vs raw external files), different conflict strategy (user-driven
 *     vs auto-skip), no provenance recording (clone creates independent copies).
 *   - Uses CapabilityStore primitives directly for reads and writes.
 *   - Does NOT trigger afterSave() side-effects — the caller (CapabilityCenter)
 *     handles version recording + cache invalidation in a single batch.
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { createLogger } from '../../platform/logger'
import type {
  ManagedCapabilityCategory,
  ClonableCapability,
  CloneConflictInfo,
  CloneItemSelection,
  CloneResultItem,
  CloneResult,
} from '@shared/types'
import { parseFrontmatter, buildFrontmatter } from '@shared/frontmatter'
import {
  type CapabilityStore,
  type StoreEntry,
  SKILL_BUNDLE_FILENAME,
  ALL_MANAGED_CATEGORIES,
} from './capabilityStore'
import { safeReadFile, safeDirEntries } from './shared/fsUtils'

const log = createLogger('ClonePipeline')

/** Maximum attempts when generating a unique name to avoid infinite loops. */
const MAX_RENAME_ATTEMPTS = 100

/** Maximum directory depth for recursive skill bundle asset collection. */
const MAX_COLLECT_DEPTH = 5

/** Maximum single asset file size (5 MB). */
const MAX_ASSET_FILE_BYTES = 5 * 1024 * 1024

// ── Directories / files to skip during bundle asset collection ───────────

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '.venv', '__pycache__',
  '.idea', '.vscode', 'dist', 'build', 'out', '.next', '.nuxt',
])

const IGNORED_FILES = new Set([
  '.DS_Store', 'Thumbs.db', '.env', 'credentials.json', 'secrets.json',
])

const IGNORED_EXTENSIONS = new Set([
  '.pyc', '.pyo', '.exe', '.dll', '.so', '.dylib', '.lock',
])

// ── Public interface ─────────────────────────────────────────────────────

export interface ClonePipelineDeps {
  store: CapabilityStore
}

export interface CloneSourceTarget {
  source: { projectId: string; projectPath: string }
  target: { projectId: string; projectPath: string }
}

export class ClonePipeline {
  private readonly store: CapabilityStore

  constructor(deps: ClonePipelineDeps) {
    this.store = deps.store
  }

  // ── Phase 1: Discovery ────────────────────────────────────────────────

  /**
   * Discover project-scoped capabilities in the source project and check
   * each against the target project for naming conflicts.
   *
   * Only reads project-scope entries (global capabilities are already
   * available everywhere — copying them would be meaningless).
   * Uses store.list() directly instead of DiscoveryEngine.buildSnapshot()
   * to avoid loading global capabilities, DB state, and eligibility data.
   */
  async discoverClonable(params: CloneSourceTarget): Promise<ClonableCapability[]> {
    log.info(
      `Discovering clonable capabilities: source=${params.source.projectPath}, ` +
      `target=${params.target.projectPath}`,
    )

    const [sourceEntries, targetEntries] = await Promise.all([
      this.listProjectCapabilities(params.source.projectPath),
      this.listProjectCapabilities(params.target.projectPath),
    ])

    // Build a lookup set from target entries for O(1) conflict checks
    const targetIndex = new Set(
      targetEntries.map(({ category, entry }) => `${category}:${entry.name}`),
    )

    const result: ClonableCapability[] = sourceEntries.map(({ category, entry }) => {
      const key = `${category}:${entry.name}`
      const conflict: CloneConflictInfo | null = targetIndex.has(key)
        ? { existingName: entry.name, existingCategory: category }
        : null

      return {
        name: entry.name,
        category,
        description: entry.description,
        conflict,
      }
    })

    log.info(
      `Discovery complete: ${result.length} clonable, ` +
      `${result.filter(r => r.conflict !== null).length} with conflicts`,
    )
    return result
  }

  // ── Phase 2: Execution ────────────────────────────────────────────────

  /**
   * Execute the clone for user-selected items with conflict resolution.
   *
   * Returns a structured result with per-item outcomes and aggregated summary.
   * Does NOT trigger any post-save side-effects (version recording, cache
   * invalidation, DataBus broadcast) — the caller must handle those in batch.
   */
  async executeClone(params: CloneSourceTarget & {
    items: CloneItemSelection[]
  }): Promise<CloneResult> {
    log.info(`Executing clone: ${params.items.length} items`)

    const items: CloneResultItem[] = []

    for (const selection of params.items) {
      const itemTag = `[${selection.category}:${selection.name}]`
      try {
        // 1. Read source entry
        const entry = await this.store.get(
          'project', selection.category, selection.name,
          params.source.projectPath,
        )
        if (!entry) {
          items.push({
            outcome: 'failed', name: selection.name,
            category: selection.category, error: 'Source capability not found',
          })
          log.warn(`${itemTag} Source not found, skipping`)
          continue
        }

        // 2. Handle conflict resolution
        if (selection.conflictResolution === 'skip') {
          items.push({ outcome: 'skipped', name: selection.name, category: selection.category })
          log.debug(`${itemTag} Skipped (user chose skip)`)
          continue
        }

        let targetName = selection.name
        let outcome: 'created' | 'overwritten' | 'renamed'

        if (selection.conflictResolution === 'rename') {
          targetName = await this.generateUniqueName(
            selection.name, selection.category, params.target.projectPath,
          )
          outcome = 'renamed'
        } else if (selection.conflictResolution === 'overwrite') {
          outcome = 'overwritten'
        } else {
          outcome = 'created'
        }

        // 3. Execute write (with name sync for renames)
        const target: CloneEntryTarget = {
          category: selection.category,
          targetName,
          projectPath: params.target.projectPath,
        }

        if (targetName !== selection.name) {
          await this.cloneWithRename(entry, target)
        } else {
          await this.cloneEntry(entry, target)
        }

        // 4. Record result
        if (outcome === 'renamed') {
          items.push({
            outcome, originalName: selection.name, newName: targetName,
            category: selection.category,
          })
          log.info(`${itemTag} Renamed → ${targetName}`)
        } else {
          items.push({ outcome, name: targetName, category: selection.category })
          log.info(`${itemTag} ${outcome}`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        items.push({
          outcome: 'failed', name: selection.name,
          category: selection.category, error: message,
        })
        log.error(`${itemTag} Clone FAILED: ${message}`, err)
      }
    }

    const summary = {
      succeeded: items.filter(i =>
        i.outcome === 'created' || i.outcome === 'overwritten' || i.outcome === 'renamed',
      ).length,
      skipped: items.filter(i => i.outcome === 'skipped').length,
      failed: items.filter(i => i.outcome === 'failed').length,
    }

    log.info(
      `Clone complete: ${summary.succeeded} succeeded, ` +
      `${summary.skipped} skipped, ${summary.failed} failed`,
    )

    return { items, summary }
  }

  // ── Private: Project-scoped listing ───────────────────────────────────

  private async listProjectCapabilities(
    projectPath: string,
  ): Promise<Array<{ category: ManagedCapabilityCategory; entry: StoreEntry }>> {
    const results = await Promise.all(
      ALL_MANAGED_CATEGORIES.map(async (category) => {
        const entries = await this.store.list('project', category, projectPath)
        return entries
          .filter(entry => !entry.mountInfo) // exclude externally-mounted entries
          .map(entry => ({ category, entry }))
      }),
    )
    return results.flat()
  }

  // ── Private: Write dispatch ───────────────────────────────────────────

  /**
   * Clone a StoreEntry to the target project without name changes.
   * Dispatches to the correct CapabilityStore write method based on entry type.
   */
  private async cloneEntry(entry: StoreEntry, target: CloneEntryTarget): Promise<void> {
    if (entry.kind === 'config') {
      await this.store.saveConfig(
        'project', target.category, target.targetName,
        entry.config, target.projectPath,
      )
    } else if (target.category === 'skill' && this.isSkillBundle(entry.filePath)) {
      await this.cloneSkillBundle(entry, target)
    } else {
      // Document type (skill flat, agent, command, rule): raw file copy
      const rawContent = await safeReadFile(entry.filePath)
      if (!rawContent) throw new Error(`Cannot read source file: ${entry.filePath}`)
      await this.store.saveRaw(
        'project', target.category, target.targetName,
        rawContent, target.projectPath,
      )
    }
  }

  /**
   * Clone with name rename: updates the name field inside the content
   * (frontmatter for documents, JSON property for configs) to match the
   * new target name, preventing name-vs-content mismatch.
   */
  private async cloneWithRename(entry: StoreEntry, target: CloneEntryTarget): Promise<void> {
    if (entry.kind === 'config') {
      const updatedConfig = { ...entry.config, name: target.targetName }
      await this.store.saveConfig(
        'project', target.category, target.targetName,
        updatedConfig, target.projectPath,
      )
    } else if (target.category === 'skill' && this.isSkillBundle(entry.filePath)) {
      await this.cloneSkillBundleWithRename(entry, target)
    } else {
      // Document type: parse frontmatter, update name, re-serialise
      const rawContent = await safeReadFile(entry.filePath)
      if (!rawContent) throw new Error(`Cannot read source file: ${entry.filePath}`)
      const updated = this.replaceFrontmatterName(rawContent, target.targetName)
      await this.store.saveRaw(
        'project', target.category, target.targetName,
        updated, target.projectPath,
      )
    }
  }

  // ── Private: Skill bundle handling ────────────────────────────────────

  private async cloneSkillBundle(entry: StoreEntry, target: CloneEntryTarget): Promise<void> {
    const bundleDir = path.dirname(entry.filePath)
    const skillContent = await safeReadFile(entry.filePath)
    if (!skillContent) throw new Error(`Cannot read SKILL.md: ${entry.filePath}`)
    const assets = await this.collectBundleAssets(bundleDir)

    await this.store.saveSkillBundle(
      'project',
      { name: target.targetName, skillContent, assets: assets.length > 0 ? assets : undefined },
      target.projectPath,
    )
  }

  private async cloneSkillBundleWithRename(entry: StoreEntry, target: CloneEntryTarget): Promise<void> {
    const bundleDir = path.dirname(entry.filePath)
    const rawContent = await safeReadFile(entry.filePath)
    if (!rawContent) throw new Error(`Cannot read SKILL.md: ${entry.filePath}`)
    const updatedContent = this.replaceFrontmatterName(rawContent, target.targetName)
    const assets = await this.collectBundleAssets(bundleDir)

    await this.store.saveSkillBundle(
      'project',
      { name: target.targetName, skillContent: updatedContent, assets: assets.length > 0 ? assets : undefined },
      target.projectPath,
    )
  }

  /**
   * Recursively collect asset files from a skill bundle directory.
   * Mirrors ImportPipeline's bundle collection logic with identical
   * safety guards (depth limit, size limit, ignore lists).
   */
  private async collectBundleAssets(
    bundleDir: string,
    prefix = '',
    depth = 0,
  ): Promise<Array<{ relativePath: string; content: string | Buffer }>> {
    if (depth >= MAX_COLLECT_DEPTH) {
      log.warn(`Skipped deeply nested directory (depth ${depth}): ${prefix || bundleDir}`)
      return []
    }

    const entries = await safeDirEntries(bundleDir)
    const assets: Array<{ relativePath: string; content: string | Buffer }> = []

    for (const entry of entries) {
      if (entry.name === SKILL_BUNDLE_FILENAME && depth === 0) continue
      if (shouldSkipEntry(entry)) continue

      const fullPath = path.join(bundleDir, entry.name)
      const relPath = prefix ? path.join(prefix, entry.name) : entry.name

      if (entry.isDir) {
        const nested = await this.collectBundleAssets(fullPath, relPath, depth + 1)
        assets.push(...nested)
      } else if (entry.isFile) {
        const content = await this.readAssetSafe(fullPath, relPath)
        if (content) assets.push({ relativePath: relPath, content })
      }
    }

    return assets
  }

  private async readAssetSafe(filePath: string, displayName: string): Promise<Buffer | null> {
    try {
      const stat = await fs.stat(filePath)
      if (stat.size > MAX_ASSET_FILE_BYTES) {
        log.warn(`Skipped oversized asset (${(stat.size / 1024 / 1024).toFixed(1)} MB): ${displayName}`)
        return null
      }
      return await fs.readFile(filePath)
    } catch {
      log.warn(`Failed to read asset: ${displayName}`)
      return null
    }
  }

  // ── Private: Name utilities ───────────────────────────────────────────

  /**
   * Generate a unique name by appending `-copy`, `-copy-2`, etc.
   * Guards against infinite loops with MAX_RENAME_ATTEMPTS.
   */
  private async generateUniqueName(
    baseName: string,
    category: ManagedCapabilityCategory,
    projectPath: string,
  ): Promise<string> {
    let candidate = `${baseName}-copy`
    if (!(await this.store.exists('project', category, candidate, projectPath))) {
      return candidate
    }

    for (let i = 2; i <= MAX_RENAME_ATTEMPTS; i++) {
      candidate = `${baseName}-copy-${i}`
      if (!(await this.store.exists('project', category, candidate, projectPath))) {
        return candidate
      }
    }

    throw new Error(
      `Cannot generate unique name for "${baseName}" after ${MAX_RENAME_ATTEMPTS} attempts`,
    )
  }

  /**
   * Replace the `name` field in YAML frontmatter.
   * Uses structured parse → modify → re-serialise (not regex)
   * to avoid false positives in the document body.
   */
  private replaceFrontmatterName(rawContent: string, newName: string): string {
    const { attributes, body } = parseFrontmatter(rawContent)
    attributes.name = newName
    // body may contain a leading newline from the frontmatter parser;
    // trim it to avoid triple-newline between frontmatter and content.
    const trimmedBody = body.replace(/^\n+/, '')
    return `${buildFrontmatter(attributes)}\n\n${trimmedBody}`
  }

  private isSkillBundle(filePath: string): boolean {
    return path.basename(filePath) === SKILL_BUNDLE_FILENAME
  }
}

// ── Local helpers ────────────────────────────────────────────────────────

interface CloneEntryTarget {
  category: ManagedCapabilityCategory
  targetName: string
  projectPath: string
}

function shouldSkipEntry(entry: { name: string; isDir: boolean; isFile: boolean }): boolean {
  if (entry.name.startsWith('.')) return true
  if (entry.isDir) return IGNORED_DIRS.has(entry.name)
  if (entry.isFile) {
    if (IGNORED_FILES.has(entry.name)) return true
    const ext = path.extname(entry.name).toLowerCase()
    return IGNORED_EXTENSIONS.has(ext)
  }
  return false
}
