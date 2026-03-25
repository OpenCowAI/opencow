// SPDX-License-Identifier: Apache-2.0

/**
 * RepoStructurer — transforms Agent-selected files into the canonical
 * package directory layout expected by PackageService.
 *
 * The Agent analysis session produces a ValidatedManifest listing which
 * files belong to which capability category.  This class copies those
 * files into a staging directory with the standard layout:
 *
 *   skills/{name}/SKILL.md   — skill bundles (may include sibling assets)
 *   commands/{name}.md       — slash-command documents
 *   agents/{name}.md         — agent documents
 *   rules/{name}.md          — rule documents
 *
 * The resulting `StructuredRepo` is consumed directly by the existing
 * PackageService install pipeline.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import type { ManagedCapabilityCategory } from '../../../../src/shared/types'
import type { ValidatedManifest, ValidatedCapability, StructuredRepo } from './types'
import { createLogger } from '../../../platform/logger'

const log = createLogger('RepoStructurer')

// ─── Constants ──────────────────────────────────────────────

/** Category → staging subdirectory name. */
const CATEGORY_DIR: Record<ManagedCapabilityCategory, string> = {
  skill: 'skills',
  command: 'commands',
  agent: 'agents',
  rule: 'rules',
  hook: 'hooks',
  'mcp-server': 'mcp-servers',
}

/**
 * Directories and dotfiles to exclude when copying a skill bundle.
 * Mirrors the blacklist in `utils/bundle.ts` for consistency.
 */
const BUNDLE_SKIP = new Set([
  '.git',
  '.github',
  'node_modules',
  '__pycache__',
  '__extract__',
])

// ─── RepoStructurer ─────────────────────────────────────────

export class RepoStructurer {
  /**
   * Copy Agent-selected files into a canonical directory layout.
   *
   * @param params.repoDir     — root of the downloaded repository
   * @param params.manifest    — validated manifest from the Agent session
   * @param params.stagingDir  — empty directory to write the structured output into
   * @returns a `StructuredRepo` with the staging path and a capabilities map
   */
  async prepare(params: {
    repoDir: string
    manifest: ValidatedManifest
    stagingDir: string
  }): Promise<StructuredRepo> {
    const { repoDir, manifest, stagingDir } = params
    const capabilities: Partial<Record<ManagedCapabilityCategory, string[]>> = {}

    log.info(
      `Structuring ${manifest.capabilities.length} capabilities ` +
        `into staging directory: ${stagingDir}`,
    )

    for (const cap of manifest.capabilities) {
      try {
        await this.placeCapability(repoDir, cap, stagingDir)
        // Track in the capabilities map
        const list = capabilities[cap.category] ?? []
        list.push(cap.name)
        capabilities[cap.category] = list
      } catch (err) {
        log.warn(
          `Failed to place capability "${cap.name}" (${cap.category}): ${err}`,
        )
        // Continue with remaining capabilities — one failure should not
        // abort the entire structuring pass.
      }
    }

    log.info(
      `Structuring complete: ` +
        Object.entries(capabilities)
          .map(([cat, names]) => `${names.length} ${cat}(s)`)
          .join(', '),
    )

    return { stagingDir, capabilities }
  }

  // ─── Internal Helpers ───────────────────────────────────────

  /**
   * Place a single validated capability into the staging directory
   * according to its category.
   */
  private async placeCapability(
    repoDir: string,
    cap: ValidatedCapability,
    stagingDir: string,
  ): Promise<void> {
    if (cap.category === 'skill') {
      await this.placeSkill(repoDir, cap, stagingDir)
    } else {
      await this.placeDocument(repoDir, cap, stagingDir)
    }
  }

  /**
   * Place a skill capability.
   *
   * Skills live under `skills/{name}/SKILL.md`.  If the source file has
   * sibling files in its parent directory (assets, scripts, etc.) and the
   * parent is *not* the repo root, the entire bundle is copied.
   */
  private async placeSkill(
    repoDir: string,
    cap: ValidatedCapability,
    stagingDir: string,
  ): Promise<void> {
    const sourcePath = path.resolve(repoDir, cap.sourcePath)
    const targetDir = path.join(stagingDir, CATEGORY_DIR.skill, cap.name)
    await fs.mkdir(targetDir, { recursive: true })

    const sourceDir = path.dirname(sourcePath)
    const isRepoRoot = path.resolve(sourceDir) === path.resolve(repoDir)

    if (!isRepoRoot && (await this.hasSiblings(sourcePath, sourceDir))) {
      // Bundle mode — copy all non-junk siblings from the parent directory
      log.debug(`Skill "${cap.name}": copying bundle from ${sourceDir}`)
      await this.copyBundle(sourceDir, targetDir)

      // Ensure the main file is named SKILL.md in the target
      const copiedName = path.basename(sourcePath)
      if (copiedName !== 'SKILL.md') {
        const copiedPath = path.join(targetDir, copiedName)
        const skillMdPath = path.join(targetDir, 'SKILL.md')
        // Only rename if the copied file exists and SKILL.md doesn't already exist
        if (await this.fileExists(copiedPath) && !(await this.fileExists(skillMdPath))) {
          await fs.rename(copiedPath, skillMdPath)
        }
      }
    } else {
      // Single-file mode — copy and rename to SKILL.md
      log.debug(`Skill "${cap.name}": copying single file ${sourcePath}`)
      await fs.copyFile(sourcePath, path.join(targetDir, 'SKILL.md'))
    }
  }

  /**
   * Place a document capability (command, agent, or rule).
   *
   * Documents are flat files: `{category}/{name}.md`.
   */
  private async placeDocument(
    repoDir: string,
    cap: ValidatedCapability,
    stagingDir: string,
  ): Promise<void> {
    const sourcePath = path.resolve(repoDir, cap.sourcePath)
    const categoryDir = CATEGORY_DIR[cap.category]
    const targetDir = path.join(stagingDir, categoryDir)
    await fs.mkdir(targetDir, { recursive: true })

    const targetFile = path.join(targetDir, `${cap.name}.md`)
    await fs.copyFile(sourcePath, targetFile)

    log.debug(`${cap.category} "${cap.name}": copied to ${targetFile}`)
  }

  /**
   * Check whether the source file has sibling entries in `sourceDir`.
   *
   * Returns `true` if the directory contains files or subdirectories
   * beyond the source file itself (excluding dotfiles and known junk).
   */
  private async hasSiblings(sourcePath: string, sourceDir: string): Promise<boolean> {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true })
    const sourceBasename = path.basename(sourcePath)

    for (const entry of entries) {
      if (entry.name === sourceBasename) continue
      if (entry.name.startsWith('.')) continue
      if (BUNDLE_SKIP.has(entry.name)) continue
      // Found at least one meaningful sibling
      return true
    }

    return false
  }

  /**
   * Copy all bundle-worthy files and directories from `sourceDir`
   * into `targetDir`, skipping dotfiles and known junk directories.
   */
  private async copyBundle(sourceDir: string, targetDir: string): Promise<void> {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name.startsWith('.') || BUNDLE_SKIP.has(entry.name)) continue

      const src = path.join(sourceDir, entry.name)
      const dest = path.join(targetDir, entry.name)

      if (entry.isDirectory()) {
        await fs.cp(src, dest, { recursive: true })
      } else if (entry.isFile()) {
        await fs.copyFile(src, dest)
      }
    }
  }

  /**
   * Check whether a file exists at the given path.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }
}
