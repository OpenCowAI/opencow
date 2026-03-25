// SPDX-License-Identifier: Apache-2.0

/**
 * PackageStore — manages multi-capability packages installed from Marketplace.
 *
 * Packages are preserved as coherent units under a `packages/` directory:
 *
 *   Global:  ~/.opencow/packages/superpowers/
 *   Project: {project}/.opencow/packages/superpowers/
 *
 * Each package directory mirrors the original repo layout:
 *
 *   packages/superpowers/
 *   ├── package.json          ← manifest (prefix, source, capability list)
 *   ├── skills/
 *   │   ├── brainstorming/SKILL.md
 *   │   └── test-driven-development/SKILL.md
 *   ├── commands/
 *   │   └── brainstorm.md
 *   └── agents/
 *       └── code-reviewer.md
 *
 * CapabilityStore integrates via CapabilityMount — presenting capabilities with
 * namespaced names like `superpowers:brainstorming`.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  ManagedCapabilityCategory,
  MarketplaceId,
} from '../../../src/shared/types'
import type { CapabilityMount } from './capabilityStore'
import { resolveProjectCapabilitiesPath } from '../../platform/dataPaths'
import { createLogger } from '../../platform/logger'

const log = createLogger('PackageStore')

// ─── Package Target ────────────────────────────────────────────────

/**
 * Identifies where a package operation targets.
 *
 * - `scope: 'global'` → `~/.opencow/packages/`
 * - `scope: 'project'` + `projectPath` → `{project}/.opencow/packages/`
 */
export interface PackageTarget {
  scope: 'global' | 'project'
  projectPath?: string
}

// ─── Package Manifest ──────────────────────────────────────────────

/**
 * Metadata stored in `{packageDir}/package.json`.
 * Tracks provenance, version, prefix, and the capabilities discovered at install time.
 */
export interface PackageManifest {
  /** Package name (usually repo name, e.g. "superpowers") */
  name: string
  /** Namespace prefix for all capabilities (user-customisable at install time) */
  prefix: string
  /** Marketplace provenance */
  source: {
    marketplaceId: MarketplaceId
    slug: string
    version?: string
    repoUrl?: string
    author?: string
    installedAt: string // ISO 8601
  }
  /** Discovered capabilities by category */
  capabilities: Partial<Record<ManagedCapabilityCategory, string[]>>
}

// ─── Category ↔ Directory mapping ──────────────────────────────────

/** Directory name → capability category (e.g. 'skills' → 'skill') */
const CATEGORY_DIR_MAP: Record<string, ManagedCapabilityCategory> = {
  skills: 'skill',
  commands: 'command',
  agents: 'agent',
  rules: 'rule',
}

/** Capability category → directory name — derived from CATEGORY_DIR_MAP to stay in sync */
const CATEGORY_TO_DIR: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_DIR_MAP).map(([dir, cat]) => [cat, dir]),
)

// ─── PackageStore ───────────────────────────────────────────────────

export class PackageStore {
  /** Default packages root (global): `~/.opencow/packages/` */
  private readonly globalPackagesRoot: string

  constructor(globalRoot: string) {
    // packages/ is a sibling to capabilities/
    // globalRoot = ~/.opencow/capabilities → globalPackagesRoot = ~/.opencow/packages
    this.globalPackagesRoot = path.join(path.dirname(globalRoot), 'packages')
  }

  /**
   * Resolve the packages root directory for a target scope.
   *
   * - Global: `~/.opencow/packages/`
   * - Project: `{project}/.opencow/packages/`
   */
  resolvePackagesRoot(target: PackageTarget): string {
    if (target.scope === 'project') {
      if (!target.projectPath) {
        throw new Error(
          'PackageStore: scope is "project" but projectPath is missing. ' +
          'Project-scoped operations require a valid projectPath.',
        )
      }
      return path.join(resolveProjectCapabilitiesPath(target.projectPath), 'packages')
    }
    return this.globalPackagesRoot
  }

  /** Get the global packages root directory path (for file watchers). */
  getGlobalPackagesRoot(): string {
    return this.globalPackagesRoot
  }

  /**
   * Copy a package from an extracted repo directory into the packages root.
   *
   * Pure filesystem operation: copies capability directories + writes manifest.
   * Does NOT check for conflicts or clean up prior installs — that lifecycle
   * is owned by PackageService (staging → trash → rename pattern).
   *
   * @param destName  Directory name under packagesRoot (may be a staging name)
   * @param repoDir   Source repo directory to copy from
   * @param source    Marketplace provenance metadata
   * @param capabilities  Discovered capabilities by category
   * @param target    Where to install (global or project)
   */
  async copyPackage(params: {
    destName: string
    repoDir: string
    source: Omit<PackageManifest['source'], 'installedAt'>
    capabilities: PackageManifest['capabilities']
    target: PackageTarget
  }): Promise<void> {
    const { destName, repoDir, source, capabilities, target } = params
    const packagesRoot = this.resolvePackagesRoot(target)
    const packageDir = path.join(packagesRoot, destName)

    await fs.mkdir(packageDir, { recursive: true })

    // Copy capability directories from repoDir to packageDir
    for (const [dirName] of Object.entries(CATEGORY_DIR_MAP)) {
      const srcDir = path.join(repoDir, dirName)
      try {
        await fs.access(srcDir)
        await copyDir(srcDir, path.join(packageDir, dirName))
      } catch {
        // Directory doesn't exist in repo — skip
      }
    }

    // Write package.json manifest
    const manifest: PackageManifest = {
      name: source.slug.split('/').pop() ?? destName,
      prefix: destName,
      source: {
        ...source,
        installedAt: new Date().toISOString(),
      },
      capabilities,
    }
    await fs.writeFile(
      path.join(packageDir, 'package.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    )

    log.info(
      `Package files copied to "${destName}" (${target.scope}) from ${source.slug}: ` +
      Object.entries(capabilities)
        .map(([cat, names]) => `${names?.length ?? 0} ${cat}s`)
        .join(', '),
    )
  }

  /** Remove a package by prefix from the given target scope. */
  async removePackage(prefix: string, target: PackageTarget): Promise<boolean> {
    const packagesRoot = this.resolvePackagesRoot(target)
    const packageDir = path.join(packagesRoot, prefix)
    try {
      await fs.access(packageDir)
      await fs.rm(packageDir, { recursive: true, force: true })
      log.info(`Package "${prefix}" removed (${target.scope})`)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get all CapabilityMounts from a specific packages root.
   *
   * This is the main integration point — CapabilityStore calls this
   * to discover all package-provided capabilities.
   */
  async getPackageMountsFrom(packagesRoot: string): Promise<CapabilityMount[]> {
    const mounts: CapabilityMount[] = []
    try {
      const entries = await fs.readdir(packagesRoot, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const manifest = await this.readManifestFrom(packagesRoot, entry.name)
        if (!manifest) continue
        const packageDir = path.join(packagesRoot, entry.name)
        mounts.push(this.manifestToMount(manifest, packageDir))
      }
    } catch {
      // packagesRoot doesn't exist yet — no packages
    }
    return mounts
  }

  /** Get all global CapabilityMounts (convenience for mount provider registration). */
  async getGlobalPackageMounts(): Promise<CapabilityMount[]> {
    return this.getPackageMountsFrom(this.globalPackagesRoot)
  }

  /** Get all project-scoped CapabilityMounts for a given project path. */
  async getProjectPackageMounts(projectPath: string): Promise<CapabilityMount[]> {
    const packagesRoot = this.resolvePackagesRoot({ scope: 'project', projectPath })
    return this.getPackageMountsFrom(packagesRoot)
  }

  /** Read and validate a package manifest by prefix from a specific root. */
  async readManifestFrom(packagesRoot: string, prefix: string): Promise<PackageManifest | null> {
    const manifestPath = path.join(packagesRoot, prefix, 'package.json')
    try {
      const content = await fs.readFile(manifestPath, 'utf-8')
      const parsed = JSON.parse(content) as Record<string, unknown>
      // Basic structural validation — guard against corrupted/hand-edited manifests
      if (
        typeof parsed.prefix !== 'string' ||
        typeof parsed.source !== 'object' ||
        parsed.source === null ||
        typeof parsed.capabilities !== 'object' ||
        parsed.capabilities === null
      ) {
        log.warn(`Invalid package manifest at ${manifestPath} — skipping`)
        return null
      }
      return parsed as unknown as PackageManifest
    } catch {
      return null
    }
  }

  /** Read manifest from a specific target scope. */
  async readManifest(prefix: string, target: PackageTarget): Promise<PackageManifest | null> {
    return this.readManifestFrom(this.resolvePackagesRoot(target), prefix)
  }

  // ── Internal ─────────────────────────────────────────────────

  /** Convert a manifest + packageDir into a CapabilityMount for CapabilityStore. */
  private manifestToMount(manifest: PackageManifest, packageDir: string): CapabilityMount {
    const dirs: Partial<Record<ManagedCapabilityCategory, string[]>> = {}

    for (const [category, names] of Object.entries(manifest.capabilities)) {
      if (!names || names.length === 0) continue
      const dirName = CATEGORY_TO_DIR[category]
      if (!dirName) continue
      dirs[category as ManagedCapabilityCategory] = [path.join(packageDir, dirName)]
    }

    return {
      namespace: manifest.prefix,
      origin: {
        type: 'marketplace',
        marketplace: manifest.source.marketplaceId,
        version: manifest.source.version ?? '',
      },
      dirs,
    }
  }
}

// ─── File System Helpers ────────────────────────────────────────────

/** Recursively copy a directory tree. */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else {
      await fs.copyFile(srcPath, destPath)
    }
  }
}
