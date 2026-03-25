// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import { parseFrontmatter, buildFrontmatter } from '@shared/frontmatter'
import type { ManagedCapabilityCategory, CapabilityMountInfo, CapabilityImportRecord } from '@shared/types'
import { resolveProjectCapabilitiesPath } from '../../platform/dataPaths'
import { createLogger } from '../../platform/logger'
import {
  validateCapabilityContent,
  validateConfigContent,
  validateCapabilityPath,
  CapabilitySecurityError,
} from '../../security/capabilitySecurity'
import { safeReadFile as sharedSafeReadFile } from './shared/fsUtils'

const log = createLogger('CapabilityStore')

// ─── Constants ──────────────────────────────────────────────────────────

const CONFIG_CATEGORIES = new Set<ManagedCapabilityCategory>(['hook', 'mcp-server'])

/** Canonical filename for skill bundles: `skills/{name}/SKILL.md` */
export const SKILL_BUNDLE_FILENAME = 'SKILL.md'

const CATEGORY_DIR_MAP: Record<ManagedCapabilityCategory, string> = {
  skill: 'skills',
  agent: 'agents',
  command: 'commands',
  rule: 'rules',
  hook: 'hooks',
  'mcp-server': 'mcp-servers',
}

export const ALL_MANAGED_CATEGORIES: ManagedCapabilityCategory[] = [
  'skill',
  'agent',
  'command',
  'rule',
  'hook',
  'mcp-server',
]

export function isConfigCategory(category: ManagedCapabilityCategory): boolean {
  return CONFIG_CATEGORIES.has(category)
}

// ─── Store Entry Discriminated Union ────────────────────────────────────

export interface DocumentStoreEntry {
  kind: 'document'
  name: string
  description: string
  body: string
  attributes: Record<string, unknown>
  filePath: string
  category: ManagedCapabilityCategory
  /** Mount provenance — only set for entries from external mounts (plugins, packages) */
  mountInfo?: CapabilityMountInfo | null
}

export interface ConfigStoreEntry {
  kind: 'config'
  name: string
  description: string
  config: Record<string, unknown>
  filePath: string
  category: ManagedCapabilityCategory
  /** Mount provenance — only set for entries from external mounts (plugins, packages) */
  mountInfo?: CapabilityMountInfo | null
}

export type StoreEntry = DocumentStoreEntry | ConfigStoreEntry

// ─── Capability Mount (unified interface for all external sources) ────────

/**
 * External capability mount — shared by all mount sources (plugins, packages).
 *
 * Both plugin mounts and marketplace packages provide namespaced capabilities
 * (e.g. `superpowers:brainstorming`). This single interface captures what
 * CapabilityStore needs from any mount source.
 */
export interface CapabilityMount {
  /** Namespace prefix — displayed as `{namespace}:bareName` */
  readonly namespace: string
  /** Origin provenance */
  readonly origin: MountOrigin
  /** Category → list of directories containing that category's capabilities */
  readonly dirs: Partial<Record<ManagedCapabilityCategory, string[]>>
}

/** Provenance metadata for a mount source */
export interface MountOrigin {
  readonly type: CapabilityImportRecord['sourceOrigin']
  readonly marketplace: string
  readonly version: string
}

/** Async provider that returns active capability mounts */
export type MountProvider = () => Promise<CapabilityMount[]>

// ─── Config ─────────────────────────────────────────────────────────────

export interface CapabilityStoreConfig {
  /** ~/.opencow/capabilities/ */
  globalRoot: string
  /** External mount providers (plugins, marketplace packages, etc.) — global scope only */
  mountProviders?: MountProvider[]
  /**
   * Provider for project-scoped package mounts.
   *
   * Given a project path, returns CapabilityMount[] from that project's
   * `packages/` directory. This keeps CapabilityStore decoupled from
   * PackageStore — the wiring happens in CapabilityCenter.
   */
  projectPackageMountProvider?: (projectPath: string) => Promise<CapabilityMount[]>
}

// ─── Simple concurrency limiter ─────────────────────────────────────────

function pLimit(concurrency: number) {
  let active = 0
  const queue: Array<() => void> = []

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++
      queue.shift()!()
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        fn()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            active--
            next()
          })
      }
      queue.push(run)
      next()
    })
}

// ─── CapabilityStore ──────────────────────────────────────────────────────

/**
 * File-system store for managed capabilities.
 *
 * Supports dual scope (global / project) and dual form (document / config).
 * Provides a unified path API and parsing for both forms.
 *
 * External Mounts: when mount providers are configured, `list()`/`get()`/`exists()`
 * also scan external capability sources (plugins, marketplace packages) via the
 * unified CapabilityMount interface. Entries from mounts use namespaced names
 * (`{namespace}:{bareName}`, e.g. `superpowers:brainstorming`) and have `mountInfo` set.
 */
export class CapabilityStore {
  private readonly globalRoot: string
  private readonly limit = pLimit(8)
  private readonly mountProviders: MountProvider[]
  private readonly projectPackageMountProvider?: (projectPath: string) => Promise<CapabilityMount[]>

  /**
   * Shared-promise cache for all mounts.
   * 2s TTL covers a single buildSnapshot() cycle (6 concurrent list() calls).
   */
  private mountCache: { promise: Promise<CapabilityMount[]>; cachedAt: number } | null = null

  constructor(config: CapabilityStoreConfig) {
    this.globalRoot = config.globalRoot
    this.mountProviders = config.mountProviders ?? []
    this.projectPackageMountProvider = config.projectPackageMountProvider
  }

  // ── Mount Resolution ──────────────────────────────────────────────

  /**
   * Resolve all capability mounts with shared-promise dedup (2s TTL).
   * Each provider is individually caught — one failure never breaks others.
   */
  private async resolveMounts(): Promise<CapabilityMount[]> {
    if (this.mountProviders.length === 0) return []
    const now = Date.now()
    if (this.mountCache && (now - this.mountCache.cachedAt) < 2000) {
      return this.mountCache.promise
    }
    const promise = Promise.all(
      this.mountProviders.map(p => p().catch(err => {
        log.warn('Mount provider failed:', err)
        return [] as CapabilityMount[]
      })),
    ).then(results => results.flat())
    this.mountCache = { promise, cachedAt: now }
    return promise
  }

  /** Parse `namespace:bareName` → { namespace, bareName } or null if not a namespaced name */
  private static parseNamespacedName(name: string): { namespace: string; bareName: string } | null {
    const colonIdx = name.indexOf(':')
    if (colonIdx <= 0) return null
    return { namespace: name.slice(0, colonIdx), bareName: name.slice(colonIdx + 1) }
  }

  // ── Path Resolution ─────────────────────────────────────────────

  /** Root directory for a scope */
  resolveRoot(scope: 'global' | 'project', projectPath?: string): string {
    return scope === 'project' && projectPath
      ? resolveProjectCapabilitiesPath(projectPath)
      : this.globalRoot
  }

  /** Category directory for a scope */
  resolveCategoryDir(
    scope: 'global' | 'project',
    category: ManagedCapabilityCategory,
    projectPath?: string,
  ): string {
    return path.join(this.resolveRoot(scope, projectPath), CATEGORY_DIR_MAP[category])
  }

  /**
   * Deterministic file path for a capability entry (synchronous, no disk I/O).
   *
   * Returns the "canonical" flat-file path: `{category}/{name}.md` or `.json`.
   *
   * **Important**: For skills this returns the flat-file path even if the skill
   * is actually stored as a bundle directory. Use `resolveActualPath()` for read
   * operations and `resolveWritePath()` for write operations on skills.
   */
  resolvePath(
    scope: 'global' | 'project',
    category: ManagedCapabilityCategory,
    name: string,
    projectPath?: string,
  ): string {
    const dir = this.resolveCategoryDir(scope, category, projectPath)
    const ext = isConfigCategory(category) ? '.json' : '.md'
    return path.join(dir, `${name}${ext}`)
  }

  /**
   * Resolve the **actual** file path for reading a capability entry.
   *
   * For skills with dual storage, checks disk to find the real location
   * (flat file `skills/foo.md` or bundle `skills/foo/SKILL.md`).
   * For all other categories, returns the canonical path.
   *
   * Returns null if the entry does not exist on disk.
   */
  async resolveActualPath(
    scope: 'global' | 'project',
    category: ManagedCapabilityCategory,
    name: string,
    projectPath?: string,
  ): Promise<string | null> {
    if (category === 'skill') {
      const dir = this.resolveCategoryDir(scope, category, projectPath)
      return this.resolveSkillFilePath(dir, name)
    }
    const filePath = this.resolvePath(scope, category, name, projectPath)
    try {
      await fs.access(filePath)
      return filePath
    } catch {
      return null
    }
  }

  /**
   * Resolve the file path for **writing** a capability entry.
   *
   * For skills:
   *   - If the skill already exists, returns the existing path (preserves format)
   *   - If creating a new skill, returns the bundle path `skills/{name}/SKILL.md`
   *
   * For all other categories, returns the canonical flat-file path.
   */
  async resolveWritePath(
    scope: 'global' | 'project',
    category: ManagedCapabilityCategory,
    name: string,
    projectPath?: string,
  ): Promise<string> {
    if (category === 'skill') {
      const dir = this.resolveCategoryDir(scope, category, projectPath)
      const existing = await this.resolveSkillFilePath(dir, name)
      if (existing) return existing
      // New skill → default to bundle format
      return path.join(dir, name, SKILL_BUNDLE_FILENAME)
    }
    return this.resolvePath(scope, category, name, projectPath)
  }

  // ── CRUD Operations ─────────────────────────────────────────────

  /**
   * List all entries for a category within a scope.
   *
   * Skills support dual storage forms:
   *   - Flat file:  `skills/my-skill.md`
   *   - Bundle dir: `skills/my-skill/SKILL.md` (with optional assets)
   *
   * All other categories use flat file storage only.
   *
   * External Mounts: for global scope, also scans external mount sources
   * (plugins + packages) and returns entries with `{namespace}:{bareName}`
   * names and `mountInfo` set.
   */
  async list(
    scope: 'global' | 'project',
    category: ManagedCapabilityCategory,
    projectPath?: string,
  ): Promise<StoreEntry[]> {
    // 1. Scan user-managed directory
    const userEntries = await this.listFromDir(scope, category, projectPath)

    // 2. External mounts — scope-dependent
    if (scope === 'global') {
      // Global: plugins + global packages
      const mountEntries = await this.listFromGlobalMounts(category)
      return mountEntries.length > 0
        ? [...userEntries, ...mountEntries]
        : userEntries
    }

    // Project: project-level package mounts
    if (projectPath && this.projectPackageMountProvider) {
      const projectMounts = await this.projectPackageMountProvider(projectPath)
      const mountEntries = await this.listEntriesFromMounts(category, projectMounts)
      return mountEntries.length > 0
        ? [...userEntries, ...mountEntries]
        : userEntries
    }

    return userEntries
  }

  /**
   * List entries from a single user-managed directory (the original list() logic).
   */
  private async listFromDir(
    scope: 'global' | 'project',
    category: ManagedCapabilityCategory,
    projectPath?: string,
  ): Promise<StoreEntry[]> {
    const dir = this.resolveCategoryDir(scope, category, projectPath)

    if (category === 'skill') {
      return this.listSkillEntries(dir)
    }

    const entries = await safeReaddir(dir)
    const ext = isConfigCategory(category) ? '.json' : '.md'
    const matched = entries.filter((e) => e.endsWith(ext))

    const results = await Promise.all(
      matched.map((fileName) =>
        this.limit(() => this.parseEntry(path.join(dir, fileName), category)),
      ),
    )

    return results.filter((e): e is StoreEntry => e !== null)
  }

  /** List entries from global mounts (plugins + global packages). */
  private async listFromGlobalMounts(category: ManagedCapabilityCategory): Promise<StoreEntry[]> {
    const mounts = await this.resolveMounts()
    return this.listEntriesFromMounts(category, mounts)
  }

  /**
   * Core mount entry scanner — works with any set of CapabilityMounts.
   *
   * Only scans skill, agent, and command categories — hooks require format
   * conversion and are deferred to a follow-up iteration.
   *
   * Returns entries with:
   *   - `name`: `{namespace}:{bareName}` (e.g. `superpowers:brainstorming`)
   *   - `mountInfo`: populated with mount provenance
   */
  private async listEntriesFromMounts(
    category: ManagedCapabilityCategory,
    mounts: CapabilityMount[],
  ): Promise<StoreEntry[]> {
    if (category !== 'skill' && category !== 'agent' && category !== 'command') return []
    if (mounts.length === 0) return []

    const allEntries: StoreEntry[] = []

    for (const mount of mounts) {
      const dirs = mount.dirs[category]
      if (!dirs || dirs.length === 0) continue

      const mountInfo: CapabilityMountInfo = {
        namespace: mount.namespace,
        marketplace: mount.origin.marketplace,
        version: mount.origin.version,
        sourceOrigin: mount.origin.type,
      }

      for (const dir of dirs) {
        const entries = category === 'skill'
          ? await this.listSkillEntries(dir)
          : await this.listDocumentEntries(dir, category)

        for (const entry of entries) {
          allEntries.push({
            ...entry,
            name: `${mount.namespace}:${entry.name}`,
            mountInfo,
          })
        }
      }
    }

    return allEntries
  }

  /**
   * List document entries (agents / commands) from a directory.
   * Extracted from the original list() logic for reuse in plugin mount scanning.
   */
  private async listDocumentEntries(dir: string, category: ManagedCapabilityCategory): Promise<StoreEntry[]> {
    const entries = await safeReaddir(dir)
    const matched = entries.filter((e) => e.endsWith('.md'))

    const results = await Promise.all(
      matched.map((fileName) =>
        this.limit(() => this.parseEntry(path.join(dir, fileName), category)),
      ),
    )

    return results.filter((e): e is StoreEntry => e !== null)
  }

  /**
   * List skill entries from both flat files and bundle directories.
   *
   * Scans the skills directory for:
   *   1. `*.md` files → flat skills (e.g. `skills/my-skill.md`)
   *   2. Subdirectories containing `SKILL.md` → bundles (e.g. `skills/my-skill/SKILL.md`)
   */
  private async listSkillEntries(dir: string): Promise<StoreEntry[]> {
    const dirEntries = await safeReaddirWithTypes(dir)

    const parseTasks: Array<{ filePath: string; entryName: string }> = []

    for (const entry of dirEntries) {
      if (entry.isFile && entry.name.endsWith('.md')) {
        // Flat skill: skills/my-skill.md
        parseTasks.push({
          filePath: path.join(dir, entry.name),
          entryName: entry.name.replace(/\.md$/, ''),
        })
      } else if (entry.isDir) {
        // Potential bundle: skills/my-skill/SKILL.md
        parseTasks.push({
          filePath: path.join(dir, entry.name, SKILL_BUNDLE_FILENAME),
          entryName: entry.name,
        })
      }
    }

    const results = await Promise.all(
      parseTasks.map(({ filePath, entryName }) =>
        this.limit(() => this.parseEntry(filePath, 'skill', entryName)),
      ),
    )

    return results.filter((e): e is StoreEntry => e !== null)
  }

  /** Get a single entry by name */
  async get(
    scope: 'global' | 'project',
    category: ManagedCapabilityCategory,
    name: string,
    projectPath?: string,
  ): Promise<StoreEntry | null> {
    // Namespaced name (e.g. "superpowers:brainstorming") → resolve from mount sources
    const nsParts = CapabilityStore.parseNamespacedName(name)
    if (nsParts) {
      if (scope === 'global') {
        return this.getFromGlobalMount(category, nsParts.namespace, nsParts.bareName)
      }
      // Project scope: check project-level package mounts
      if (projectPath && this.projectPackageMountProvider) {
        const projectMounts = await this.projectPackageMountProvider(projectPath)
        return this.getEntryFromMounts(category, nsParts.namespace, nsParts.bareName, projectMounts)
      }
      return null
    }

    // Skills can be flat files or bundle directories — resolve the actual path
    if (category === 'skill') {
      const dir = this.resolveCategoryDir(scope, category, projectPath)
      const filePath = await this.resolveSkillFilePath(dir, name)
      if (!filePath) return null
      return this.parseEntry(filePath, category, name)
    }
    const filePath = this.resolvePath(scope, category, name, projectPath)
    return this.parseEntry(filePath, category)
  }

  /** Check if a capability file exists */
  async exists(
    scope: 'global' | 'project',
    category: ManagedCapabilityCategory,
    name: string,
    projectPath?: string,
  ): Promise<boolean> {
    // Namespaced name → check from mount sources (scope-aware)
    const nsParts = CapabilityStore.parseNamespacedName(name)
    if (nsParts) {
      const entry = await this.get(scope, category, name, projectPath)
      return entry !== null
    }

    // Skills can be flat files or bundle directories
    if (category === 'skill') {
      const dir = this.resolveCategoryDir(scope, category, projectPath)
      const filePath = await this.resolveSkillFilePath(dir, name)
      return filePath !== null
    }
    const filePath = this.resolvePath(scope, category, name, projectPath)
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  /** Get a single entry from global mounts by namespace + bareName. */
  private async getFromGlobalMount(
    category: ManagedCapabilityCategory,
    namespace: string,
    bareName: string,
  ): Promise<StoreEntry | null> {
    const mounts = await this.resolveMounts()
    return this.getEntryFromMounts(category, namespace, bareName, mounts)
  }

  /**
   * Core mount entry getter — works with any set of CapabilityMounts.
   *
   * Searches the given mounts for a matching `{namespace}:{bareName}` entry.
   * Returns the entry with full namespaced name and mountInfo set.
   */
  private async getEntryFromMounts(
    category: ManagedCapabilityCategory,
    namespace: string,
    bareName: string,
    mounts: CapabilityMount[],
  ): Promise<StoreEntry | null> {
    if (category !== 'skill' && category !== 'agent' && category !== 'command') return null

    const mount = mounts.find(m => m.namespace === namespace)
    if (!mount) return null

    const dirs = mount.dirs[category]
    if (!dirs || dirs.length === 0) return null

    const mountInfo: CapabilityMountInfo = {
      namespace: mount.namespace,
      marketplace: mount.origin.marketplace,
      version: mount.origin.version,
      sourceOrigin: mount.origin.type,
    }

    for (const dir of dirs) {
      let entry: StoreEntry | null = null

      if (category === 'skill') {
        const filePath = await this.resolveSkillFilePath(dir, bareName)
        if (filePath) {
          entry = await this.parseEntry(filePath, category, bareName)
        }
      } else {
        const filePath = path.join(dir, `${bareName}.md`)
        entry = await this.parseEntry(filePath, category)
      }

      if (entry) {
        return {
          ...entry,
          name: `${namespace}:${bareName}`,
          mountInfo,
        }
      }
    }

    return null
  }

  /** Save a document-type entry (skills / agents / commands / rules) */
  async saveDocument(
    scope: 'global' | 'project',
    category: ManagedCapabilityCategory,
    name: string,
    fields: Record<string, unknown>,
    body: string,
    projectPath?: string,
  ): Promise<string> {
    const fm = buildFrontmatter(fields)
    const content = `${fm}\n\n${body}`
    validateCapabilityContent(content, name)
    const filePath = await this.resolveWritePath(scope, category, name, projectPath)
    await validateCapabilityPath(filePath, { projectPath, globalRoot: this.globalRoot })
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')
    return filePath
  }

  /** Save a config-type entry (hooks / mcp-servers) */
  async saveConfig(
    scope: 'global' | 'project',
    category: ManagedCapabilityCategory,
    name: string,
    config: Record<string, unknown>,
    projectPath?: string,
  ): Promise<string> {
    const content = JSON.stringify(config, null, 2)
    validateConfigContent(content, name)
    const filePath = this.resolvePath(scope, category, name, projectPath)
    await validateCapabilityPath(filePath, { projectPath, globalRoot: this.globalRoot })
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')
    return filePath
  }

  /**
   * Unified save: auto-detects document vs config by category.
   * Writes raw content as-is (caller is responsible for formatting).
   * Security validation is enforced at this layer — callers cannot bypass.
   */
  async saveRaw(
    scope: 'global' | 'project',
    category: ManagedCapabilityCategory,
    name: string,
    content: string,
    projectPath?: string,
  ): Promise<string> {
    if (isConfigCategory(category)) {
      validateConfigContent(content, name)
    } else {
      validateCapabilityContent(content, name)
    }
    const filePath = await this.resolveWritePath(scope, category, name, projectPath)
    await validateCapabilityPath(filePath, { projectPath, globalRoot: this.globalRoot })
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')
    return filePath
  }

  /**
   * Save a skill bundle (SKILL.md + optional asset files).
   * Skills are stored as directories: `skills/{name}/SKILL.md` + assets.
   */
  async saveSkillBundle(
    scope: 'global' | 'project',
    params: {
      name: string
      skillContent: string
      assets?: Array<{ relativePath: string; content: string | Buffer }>
    },
    projectPath?: string,
  ): Promise<string> {
    validateCapabilityContent(params.skillContent, params.name)

    const skillDir = path.join(
      this.resolveCategoryDir(scope, 'skill', projectPath),
      params.name,
    )
    await validateCapabilityPath(skillDir, { projectPath, globalRoot: this.globalRoot })
    await fs.mkdir(skillDir, { recursive: true })

    // Write SKILL.md — re-validate after mkdir to close TOCTOU window
    const skillPath = path.join(skillDir, SKILL_BUNDLE_FILENAME)
    await validateCapabilityPath(skillPath, { projectPath, globalRoot: this.globalRoot })
    await fs.writeFile(skillPath, params.skillContent, 'utf-8')

    // Write asset files — verify each asset path stays within skillDir
    if (params.assets) {
      for (const asset of params.assets) {
        const assetPath = path.resolve(skillDir, asset.relativePath)
        if (!assetPath.startsWith(skillDir + path.sep)) {
          throw new CapabilitySecurityError(
            `Asset path escapes skill directory: ${asset.relativePath}`,
            'PATH_TRAVERSAL',
          )
        }
        await fs.mkdir(path.dirname(assetPath), { recursive: true })
        await fs.writeFile(assetPath, asset.content)
      }
    }

    return skillPath
  }

  /** Remove a capability file (or directory for skill bundles) */
  async remove(
    scope: 'global' | 'project',
    category: ManagedCapabilityCategory,
    name: string,
    projectPath?: string,
  ): Promise<void> {
    if (category === 'skill') {
      // Skills can be either single files (skills/foo.md) or bundles (skills/foo/SKILL.md).
      // Try removing the bundle directory first, then fall back to single file.
      const bundleDir = path.join(
        this.resolveCategoryDir(scope, category, projectPath),
        name,
      )
      try {
        const stat = await fs.stat(bundleDir)
        if (stat.isDirectory()) {
          await fs.rm(bundleDir, { recursive: true })
          return
        }
      } catch (err) {
        if (!isEnoent(err)) throw err
      }
    }

    const filePath = this.resolvePath(scope, category, name, projectPath)
    try {
      await fs.unlink(filePath)
    } catch (err) {
      if (!isEnoent(err)) throw err
    }
  }

  /** Serialize a StoreEntry back to file content */
  serializeContent(entry: StoreEntry): string {
    if (entry.kind === 'document') {
      const fm = buildFrontmatter(entry.attributes)
      return `${fm}\n\n${entry.body}`
    }
    return JSON.stringify(entry.config, null, 2)
  }

  // ── Internal ────────────────────────────────────────────────────

  /**
   * Resolve the actual file path for a skill entry (supports dual storage).
   *
   * Checks flat file first (`skills/{name}.md`), then bundle (`skills/{name}/SKILL.md`).
   * Returns null if neither exists.
   */
  private async resolveSkillFilePath(dir: string, name: string): Promise<string | null> {
    // Flat file: skills/my-skill.md
    const flatPath = path.join(dir, `${name}.md`)
    try {
      await fs.access(flatPath)
      return flatPath
    } catch { /* not found — try bundle */ }

    // Bundle: skills/my-skill/SKILL.md
    const bundlePath = path.join(dir, name, SKILL_BUNDLE_FILENAME)
    try {
      await fs.access(bundlePath)
      return bundlePath
    } catch { /* not found */ }

    return null
  }

  /**
   * Parse a single capability file into a StoreEntry.
   *
   * @param nameOverride — Used for skill bundles where basename is "SKILL" not the entry name.
   */
  private async parseEntry(
    filePath: string,
    category: ManagedCapabilityCategory,
    nameOverride?: string,
  ): Promise<StoreEntry | null> {
    const content = await safeReadFile(filePath)
    if (content === null) return null

    const name = nameOverride ?? path.basename(filePath).replace(/\.(md|json)$/, '')

    if (isConfigCategory(category)) {
      try {
        const config = JSON.parse(content) as Record<string, unknown>
        return {
          kind: 'config',
          name,
          description: typeof config['description'] === 'string' ? config['description'] : '',
          config,
          filePath,
          category,
        }
      } catch {
        return null
      }
    }

    // Document-type: parse frontmatter
    const { attributes, body } = parseFrontmatter(content)
    return {
      kind: 'document',
      name: typeof attributes['name'] === 'string' ? attributes['name'] : name,
      description: typeof attributes['description'] === 'string' ? attributes['description'] : '',
      body,
      attributes,
      filePath,
      category,
    }
  }
}

// ─── File System Helpers ────────────────────────────────────────────────

/** List only file names from a directory (non-recursive). */
async function safeReaddir(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries.filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return []
  }
}

/**
 * List all entries from a directory with type information.
 *
 * Returns both files and directories — needed for skill bundles
 * where a skill can be stored as a subdirectory.
 */
async function safeReaddirWithTypes(
  dirPath: string,
): Promise<Array<{ name: string; isFile: boolean; isDir: boolean }>> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries.map((e) => ({
      name: e.name,
      isFile: e.isFile(),
      isDir: e.isDirectory(),
    }))
  } catch {
    return []
  }
}

// Re-use shared safeReadFile (v3.1 fix #27: single source of truth)
const safeReadFile = sharedSafeReadFile

/** Type-safe ENOENT check — avoids `as NodeJS.ErrnoException` assertions */
function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT'
}
