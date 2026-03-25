// SPDX-License-Identifier: Apache-2.0

/**
 * Agent Manifest Validator — safety gate between Agent output and user-facing UI.
 *
 * The analysis Agent produces an `AgentManifest` describing the capabilities it
 * found in a repository. Before presenting these to the user for confirmation,
 * ManifestValidator applies a set of defensive checks:
 *
 *   1. **Path traversal** — resolved path must stay within `repoDir`
 *   2. **File existence** — source file must exist on disk
 *   3. **File size** — source file must be readable text (≤ 512 KB)
 *   4. **Name format** — must be kebab-case (`/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/`)
 *   5. **Category** — must be an installable category (skill, command, agent, rule)
 *   6. **Duplicate detection** — same name+category keeps higher confidence only
 *
 * Uses synchronous fs operations since this runs once after the Agent completes,
 * not in a hot path.
 */

import * as path from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { createLogger } from '../../../platform/logger'
import type {
  AgentManifest,
  AgentCapability,
  ValidatedManifest,
  ValidatedCapability,
  RejectedCapability,
} from './types'

const log = createLogger('ManifestValidator')

// ─── Constants ──────────────────────────────────────────────────────────

/** Maximum source file size (512 KB). Files larger than this are unlikely to be readable text. */
const MAX_FILE_SIZE_BYTES = 512 * 1024

/** Valid kebab-case name: starts and ends with alphanumeric, hyphens allowed in between. */
const KEBAB_CASE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

/** Categories that can be installed via the marketplace pipeline. */
const INSTALLABLE_CATEGORIES = new Set(['skill', 'command', 'agent', 'rule'] as const)

/** Confidence ranking — higher index = higher confidence. */
const CONFIDENCE_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 }

// ─── Validator ──────────────────────────────────────────────────────────

/**
 * Validates an `AgentManifest` produced by the analysis Agent.
 *
 * Each capability is checked independently. Capabilities that pass all checks
 * are returned in `capabilities`; those that fail are returned in `rejected`
 * with human-readable issue descriptions.
 */
export class ManifestValidator {
  /**
   * Validate the given manifest against the repository directory.
   *
   * @param manifest - Raw manifest produced by the analysis Agent.
   * @param repoDir  - Absolute path to the repository root on disk.
   * @returns A `ValidatedManifest` with valid and rejected capabilities separated.
   */
  validate(manifest: AgentManifest, repoDir: string): ValidatedManifest {
    const sanitisedPackageName = this.sanitisePackageName(manifest.packageName)
    log.info(`Validating manifest "${sanitisedPackageName}" (${manifest.capabilities.length} capabilities)`)

    // Phase 1: validate each capability independently
    const valid: ValidatedCapability[] = []
    const rejected: RejectedCapability[] = []

    for (const cap of manifest.capabilities) {
      const issues = this.validateCapability(cap, repoDir)
      if (issues.length === 0) {
        valid.push({ ...cap, status: 'valid' })
      } else {
        log.warn(`Rejected capability "${cap.name}" [${cap.category}]: ${issues.join('; ')}`)
        rejected.push({ ...cap, status: 'rejected', issues })
      }
    }

    // Phase 2: deduplicate — same name+category keeps only the higher-confidence entry
    const { deduplicated, duplicateRejections } = this.deduplicateCapabilities(valid)

    const allRejected = [...rejected, ...duplicateRejections]

    log.info(
      `Validation complete: ${deduplicated.length} valid, ${allRejected.length} rejected` +
        (duplicateRejections.length > 0 ? ` (${duplicateRejections.length} duplicates)` : ''),
    )

    return {
      packageName: sanitisedPackageName,
      capabilities: deduplicated,
      rejected: allRejected,
      reasoning: manifest.reasoning,
    }
  }

  // ─── Per-Capability Validation ──────────────────────────────────────

  /**
   * Run all validation checks on a single capability.
   *
   * @returns An array of issue descriptions. Empty array means the capability is valid.
   */
  private validateCapability(cap: AgentCapability, repoDir: string): string[] {
    const issues: string[] = []

    // 1. Category validation (checked first — if category is wrong, everything else is moot)
    if (!INSTALLABLE_CATEGORIES.has(cap.category as never)) {
      issues.push(
        `Invalid category "${cap.category}"; must be one of: ${[...INSTALLABLE_CATEGORIES].join(', ')}`,
      )
    }

    // 2. Name validation (kebab-case)
    if (!KEBAB_CASE_RE.test(cap.name)) {
      issues.push(
        `Invalid name "${cap.name}"; must be kebab-case matching ${KEBAB_CASE_RE.source}`,
      )
    }

    // 3. Path traversal check
    const fullPath = path.resolve(repoDir, cap.sourcePath)
    const normalisedRepoDir = repoDir.endsWith(path.sep) ? repoDir : repoDir + path.sep
    if (!fullPath.startsWith(normalisedRepoDir) && fullPath !== repoDir) {
      issues.push(
        `Path traversal detected: "${cap.sourcePath}" resolves outside repository root`,
      )
      // Short-circuit — no point checking file existence for a traversal path
      return issues
    }

    // 4. File existence
    if (!existsSync(fullPath)) {
      issues.push(`Source file not found: "${cap.sourcePath}"`)
      // Short-circuit — cannot check size of non-existent file
      return issues
    }

    // 5. File size (readable text heuristic)
    try {
      const stat = statSync(fullPath)
      if (stat.size > MAX_FILE_SIZE_BYTES) {
        issues.push(
          `Source file too large (${(stat.size / 1024).toFixed(1)} KB); maximum is ${MAX_FILE_SIZE_BYTES / 1024} KB`,
        )
      }
    } catch (err) {
      issues.push(`Unable to stat source file: ${err instanceof Error ? err.message : String(err)}`)
    }

    return issues
  }

  // ─── Duplicate Detection ────────────────────────────────────────────

  /**
   * Remove duplicate capabilities (same name + category).
   *
   * When duplicates are found, the one with higher confidence is kept.
   * Ties are broken by insertion order (first occurrence wins).
   *
   * @returns The deduplicated list and any entries rejected as duplicates.
   */
  private deduplicateCapabilities(
    capabilities: ValidatedCapability[],
  ): { deduplicated: ValidatedCapability[]; duplicateRejections: RejectedCapability[] } {
    const seen = new Map<string, ValidatedCapability>()
    const duplicateRejections: RejectedCapability[] = []

    for (const cap of capabilities) {
      const key = `${cap.category}::${cap.name}`
      const existing = seen.get(key)

      if (!existing) {
        seen.set(key, cap)
        continue
      }

      // Compare confidence — higher wins; ties keep the first occurrence
      const existingRank = CONFIDENCE_RANK[existing.confidence] ?? 0
      const currentRank = CONFIDENCE_RANK[cap.confidence] ?? 0

      if (currentRank > existingRank) {
        // Current capability has higher confidence — evict the existing one
        duplicateRejections.push({
          ...existing,
          status: 'rejected',
          issues: [
            `Duplicate of "${cap.name}" [${cap.category}]; replaced by higher-confidence entry (${cap.confidence} > ${existing.confidence})`,
          ],
        })
        seen.set(key, cap)
      } else {
        // Existing capability wins — reject the current one
        duplicateRejections.push({
          ...cap,
          status: 'rejected',
          issues: [
            `Duplicate of "${existing.name}" [${existing.category}]; lower or equal confidence (${cap.confidence} ≤ ${existing.confidence})`,
          ],
        })
      }
    }

    return {
      deduplicated: [...seen.values()],
      duplicateRejections,
    }
  }

  // ─── Package Name Sanitisation ──────────────────────────────────────

  /**
   * Sanitise a package name into a safe kebab-case identifier.
   *
   * Rules:
   *   - Lowercase
   *   - Replace non-alphanumeric characters (except hyphens) with hyphens
   *   - Collapse consecutive hyphens into one
   *   - Trim leading and trailing hyphens
   *
   * @param raw - The raw package name from the Agent.
   * @returns A sanitised kebab-case package name.
   */
  private sanitisePackageName(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
  }
}
