// SPDX-License-Identifier: Apache-2.0

/**
 * Eligibility Engine — async eligibility evaluation for capabilities.
 *
 * v3.1 fix #11: fully async (execFile + promisify instead of execSync).
 * Checks 4 conditions: OS, required bins, any-of bins, env vars.
 * Binary check results are cached to avoid repeated I/O.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import type { CapabilityEligibility } from '@shared/types'
import { createLogger } from '../../platform/logger'

const execFileAsync = promisify(execFile)
const log = createLogger('EligibilityEngine')

/** Timeout for binary existence checks (which/where) */
const BIN_CHECK_TIMEOUT_MS = 5_000

const PLATFORM_MAP: Record<string, string> = {
  darwin: 'macos',
  linux: 'linux',
  win32: 'windows',
}

export class EligibilityEngine {
  private binCache = new Map<string, boolean>()

  /**
   * Evaluate eligibility of a capability based on its frontmatter attributes.
   * Returns { eligible: true, reasons: [] } when all checks pass.
   */
  async evaluate(attributes: Record<string, unknown>): Promise<CapabilityEligibility> {
    const reasons: string[] = []
    const metadata = (attributes['metadata'] ?? {}) as Record<string, unknown>
    const requires = (metadata['requires'] ?? {}) as Record<string, unknown>

    // ── OS check (pure computation, no I/O) ──
    const requiredOS = (metadata['os'] ?? []) as string[]
    if (requiredOS.length > 0) {
      const platform = os.platform()
      const mapped = PLATFORM_MAP[platform] ?? platform
      if (!requiredOS.includes(mapped)) {
        reasons.push(`Requires OS: ${requiredOS.join(' | ')}`)
      }
    }

    // ── Required binaries (async) ──
    const bins = (requires['bins'] ?? []) as string[]
    for (const bin of bins) {
      if (!(await this.checkBin(bin))) {
        reasons.push(`Missing binary: ${bin}`)
      }
    }

    // ── Any-of binaries (parallel async) ──
    const anyBins = (requires['anyBins'] ?? []) as string[]
    if (anyBins.length > 0) {
      const checks = await Promise.all(anyBins.map((b) => this.checkBin(b)))
      if (!checks.some(Boolean)) {
        reasons.push(`Requires one of: ${anyBins.join(' | ')}`)
      }
    }

    // ── Environment variables (pure computation) ──
    const envVars = (requires['env'] ?? []) as string[]
    for (const envVar of envVars) {
      if (!process.env[envVar]) {
        reasons.push(`Missing env: ${envVar}`)
      }
    }

    return { eligible: reasons.length === 0, reasons }
  }

  /** Check if a binary exists in PATH (result cached) */
  private async checkBin(name: string): Promise<boolean> {
    const cached = this.binCache.get(name)
    if (cached !== undefined) return cached

    try {
      const cmd = os.platform() === 'win32' ? 'where' : 'which'
      await execFileAsync(cmd, [name], { timeout: BIN_CHECK_TIMEOUT_MS })
      this.binCache.set(name, true)
      return true
    } catch (err) {
      log.debug(`Binary not found: ${name}`, err)
      this.binCache.set(name, false)
      return false
    }
  }

  /** Clear the binary check cache (e.g. after tool installation) */
  clearCache(): void {
    this.binCache.clear()
  }
}
