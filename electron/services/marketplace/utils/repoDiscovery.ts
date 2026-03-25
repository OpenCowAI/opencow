// SPDX-License-Identifier: Apache-2.0

/**
 * Multi-capability repository discovery utility.
 *
 * When a marketplace repo (like obra/superpowers) contains structured
 * capability directories (skills/, commands/, agents/, rules/), this
 * module discovers all importable items instead of treating the entire
 * repo as a single skill bundle.
 *
 * Detection strategy:
 *   1. Check root directory for known capability folder names
 *   2. skills/ → scan subdirectories for SKILL.md (each = one skill bundle)
 *   3. commands/, agents/, rules/ → scan for .md files (each = one document capability)
 *   4. hooks/, docs/, mcp-servers/ → skip with diagnostic message
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { parseFrontmatter } from '@shared/frontmatter'
import { DIR_TO_CAPABILITY_CATEGORY, CAPABILITY_SKIP_DIRS } from '../../../../src/shared/types'
import type { ManagedCapabilityCategory, MarketSkillInfo } from '../../../../src/shared/types'
import type { MarketplaceImportItem } from '../types'
import { createLogger } from '../../../platform/logger'

const log = createLogger('RepoDiscovery')

// ─── Constants ──────────────────────────────────────────────

/** Directories to skip during discovery (from shared constant). */
const SKIP_DIRS = CAPABILITY_SKIP_DIRS

/** Capability directories supported for marketplace import (derived from shared constant). */
const CAPABILITY_DIRS: Record<string, ManagedCapabilityCategory> = Object.fromEntries(
  Object.entries(DIR_TO_CAPABILITY_CATEGORY).filter(([dir]) => !(dir in SKIP_DIRS)),
) as Record<string, ManagedCapabilityCategory>

// ─── Types ──────────────────────────────────────────────────

export interface RepoDiscoveryResult {
  /** Whether the repo contains structured capability directories. */
  isMultiCapability: boolean
  /** Discovered importable items. */
  items: MarketplaceImportItem[]
  /** Directories/items that were skipped, with reasons. */
  skipped: string[]
}

// ─── Main Function ──────────────────────────────────────────

/**
 * Scan an extracted repository directory for all importable capabilities.
 *
 * Returns `isMultiCapability: false` when no known capability directories
 * are found — the caller should fall back to single-skill import.
 */
export async function discoverRepoCapabilities(
  repoDir: string,
  marketInfo: MarketSkillInfo,
  sourceScope: 'global' | 'project',
): Promise<RepoDiscoveryResult> {
  const items: MarketplaceImportItem[] = []
  const skipped: string[] = []

  // Read root directory entries
  let rootEntries: import('node:fs').Dirent[]
  try {
    rootEntries = await fs.readdir(repoDir, { withFileTypes: true })
  } catch {
    log.debug(`Cannot read repo directory: ${repoDir}`)
    return { isMultiCapability: false, items: [], skipped: [] }
  }

  const rootDirNames = new Set(
    rootEntries.filter((e) => e.isDirectory()).map((e) => e.name),
  )

  // Identify which capability directories exist
  const foundCapDirs = Object.keys(CAPABILITY_DIRS).filter((d) => rootDirNames.has(d))
  const foundSkipDirs = Object.keys(SKIP_DIRS).filter((d) => rootDirNames.has(d))

  // Record skipped directories
  for (const dir of foundSkipDirs) {
    skipped.push(`${dir}/: ${SKIP_DIRS[dir]}`)
  }

  // No capability directories found → not a multi-capability repo
  if (foundCapDirs.length === 0) {
    return { isMultiCapability: false, items, skipped }
  }

  // Scan each capability directory
  for (const dirName of foundCapDirs) {
    const category = CAPABILITY_DIRS[dirName]
    const dirPath = path.join(repoDir, dirName)

    if (category === 'skill') {
      await discoverSkills(dirPath, items, marketInfo, sourceScope)
    } else {
      await discoverDocuments(dirPath, category, items, marketInfo, sourceScope)
    }
  }

  log.info(
    `Repo discovery: ${items.length} capabilities found` +
    ` (${foundCapDirs.join(', ')})` +
    (skipped.length > 0 ? `, ${skipped.length} skipped` : ''),
  )

  return {
    isMultiCapability: items.length > 0,
    items,
    skipped,
  }
}

// ─── Skill Discovery ────────────────────────────────────────

/**
 * Scan skills/ directory: each subdirectory containing SKILL.md is a skill bundle.
 */
async function discoverSkills(
  skillsDir: string,
  items: MarketplaceImportItem[],
  marketInfo: MarketSkillInfo,
  sourceScope: 'global' | 'project',
): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue

    const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md')
    try {
      await fs.access(skillMdPath)
    } catch {
      continue // No SKILL.md → skip
    }

    // Extract description from frontmatter (best-effort)
    const description = await extractDescription(skillMdPath)

    items.push({
      name: entry.name,
      category: 'skill',
      description,
      sourcePath: skillMdPath,
      sourceType: 'marketplace',
      alreadyImported: false,
      sourceScope,
      isBundle: true,
      marketInfo,
    })
  }
}

// ─── Document Discovery ─────────────────────────────────────

/**
 * Scan commands/, agents/, or rules/ directory: each .md file is a document capability.
 */
async function discoverDocuments(
  dirPath: string,
  category: ManagedCapabilityCategory,
  items: MarketplaceImportItem[],
  marketInfo: MarketSkillInfo,
  sourceScope: 'global' | 'project',
): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue

    const filePath = path.join(dirPath, entry.name)
    const name = entry.name.replace(/\.md$/, '')

    // Extract description from frontmatter (best-effort)
    const description = await extractDescription(filePath)

    items.push({
      name,
      category,
      description,
      sourcePath: filePath,
      sourceType: 'marketplace',
      alreadyImported: false,
      sourceScope,
      isBundle: false,
      marketInfo,
    })
  }
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Extract description from a markdown file's YAML frontmatter.
 * Returns empty string on any failure — purely best-effort.
 */
async function extractDescription(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const { attributes } = parseFrontmatter(content)
    return (attributes['description'] as string) ?? ''
  } catch {
    return ''
  }
}
