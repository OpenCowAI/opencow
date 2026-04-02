// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'child_process'
import type { PrerequisiteItem, PrerequisiteCheckResult } from '@shared/types'
import { getShellEnvironment } from '../platform/shellPath'

/**
 * Feature switch for onboarding Node.js prerequisite probing.
 *
 * Keep the implementation in place for possible future re-enable,
 * but disable execution so onboarding no longer blocks on system Node.
 */
const ENABLE_NODE_PREREQUISITE_CHECK = false

/**
 * Build a child-process env with the shell-resolved PATH.
 *
 * Electron on macOS launches with a minimal PATH (`/usr/bin:/bin`) that
 * doesn't include `node` from nvm / fnm / Homebrew / Volta.
 * `initShellEnvironment()` (called at startup) resolves the full PATH;
 * we inject it here so that `execFile('node', ...)` can actually find
 * the user's installed binaries.
 */
function resolvedEnv(): NodeJS.ProcessEnv {
  const shellEnv = getShellEnvironment()
  return { ...process.env, PATH: shellEnv.path }
}

/**
 * Execute a command and return its stdout, or null if it fails.
 *
 * Uses the shell-resolved PATH so that binaries installed via nvm,
 * fnm, Homebrew, Volta, etc. are discoverable — even when the app
 * is launched from Finder / Dock on macOS.
 */
function execVersion(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, env: resolvedEnv() }, (err, stdout) => {
      if (err) {
        resolve(null)
        return
      }
      resolve(stdout.trim())
    })
  })
}

/**
 * Parse a semver-like version from a raw version string.
 * e.g. "v22.11.0" → "22.11.0", "node v18.0.0" → "18.0.0"
 */
function extractVersion(raw: string): string | null {
  const match = raw.match(/(\d+\.\d+\.\d+)/)
  return match ? match[1] : null
}

/**
 * Check if a Node.js version meets the minimum requirement (>=18).
 */
function isNodeVersionOk(version: string): boolean {
  const major = parseInt(version.split('.')[0], 10)
  return !isNaN(major) && major >= 18
}

/**
 * Run all prerequisite checks and return a structured result.
 *
 * Required checks (blocks onboarding if missing):
 *   - Node.js >= 18
 *
 * Optional checks (informational):
 *   - Claude Code CLI (`claude`)
 */
export async function checkPrerequisites(): Promise<PrerequisiteCheckResult> {
  const items: PrerequisiteItem[] = []

  // ── Node.js (legacy, currently disabled) ───────────────────────────
  if (ENABLE_NODE_PREREQUISITE_CHECK) {
    const nodeRaw = await execVersion('node', ['--version'])
    const nodeVersion = nodeRaw ? extractVersion(nodeRaw) : null
    const nodeSatisfied = nodeVersion !== null && isNodeVersionOk(nodeVersion)

    items.push({
      name: 'Node.js',
      required: true,
      satisfied: nodeSatisfied,
      version: nodeVersion,
      hint: nodeSatisfied
        ? ''
        : 'Node.js >= 18 is required. Download from https://nodejs.org',
    })
  }

  // ── Claude Code CLI ────────────────────────────────────────────────
  const claudeRaw = await execVersion('claude', ['--version'])
  const claudeVersion = claudeRaw ? extractVersion(claudeRaw) : (claudeRaw ?? null)
  const claudeSatisfied = claudeRaw !== null

  items.push({
    name: 'Claude Code',
    required: false,
    satisfied: claudeSatisfied,
    version: claudeVersion,
    hint: claudeSatisfied
      ? ''
      : 'Claude Code CLI is optional. Install it to enable session monitoring and hooks.',
  })

  // Keep canProceed semantics for required checks (if any are enabled).
  const canProceed = items.filter((i) => i.required).every((i) => i.satisfied)

  return { canProceed, items }
}
