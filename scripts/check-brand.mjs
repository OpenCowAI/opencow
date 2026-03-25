#!/usr/bin/env node
/**
 * check-brand.mjs — CI brand compliance gate
 *
 * Scans source code for leftover legacy brand identifiers (CCBoard / ccboard).
 * Excludes: docs/, node_modules, out/, dist/, .worktrees/,
 *           and the brand migration plan docs.
 *
 * Usage: node scripts/check-brand.mjs
 * Exit code: 0 = pass, 1 = legacy identifiers found
 */

import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// Legacy brand string patterns to detect
const LEGACY_PATTERNS = [
  'CCBoard',
  'ccboard',
  'CCBOARD',
  '__ccboard__',
  'mcp__ccboard',
  'ccboard-capabilities',
  'com\\.ccboard',
]

// Excluded paths (ripgrep --glob format)
const EXCLUDE_GLOBS = [
  '!docs/**',
  '!node_modules/**',
  '!out/**',
  '!dist/**',
  '!.worktrees/**',
  '!**/.git/**',
  '!scripts/check-brand.mjs',  // Exclude self
  '!docs/plans/**',             // Exclude historical migration plan docs
]

let hasViolations = false

for (const pattern of LEGACY_PATTERNS) {
  try {
    const globArgs = EXCLUDE_GLOBS.map(g => `--glob '${g}'`).join(' ')
    const result = execSync(
      `cd ${ROOT} && rg --count-matches ${globArgs} '${pattern}' 2>/dev/null || true`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )

    const lines = result.trim().split('\n').filter(Boolean)
    if (lines.length > 0) {
      console.error(`\n❌ Found legacy brand pattern: "${pattern}"`)
      for (const line of lines) {
        console.error(`   ${line}`)
      }
      hasViolations = true
    }
  } catch {
    // rg returns non-zero when no matches found — that's OK
  }
}

if (hasViolations) {
  console.error('\n✖ Brand check FAILED: legacy identifiers found in source code')
  console.error('  Run the migration script or update the affected files manually.\n')
  process.exit(1)
} else {
  console.log('✓ Brand check passed: no legacy identifiers found')
  process.exit(0)
}
