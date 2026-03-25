// SPDX-License-Identifier: Apache-2.0

/**
 * Shared skill-bundle copy utility.
 *
 * Used by any adapter that downloads a GitHub tarball and needs to
 * copy the standard skill bundle files (SKILL.md, scripts/, references/, assets/)
 * from an extracted directory to the final target.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/** Directories to skip when copying a skill bundle (blacklist). */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.github',
  '__pycache__',
  '__extract__',
])

/**
 * Copy skill bundle files from `sourceDir` to `targetDir`.
 *
 * Copies all files and directories **except** known non-bundle entries
 * (dotfiles, .git, node_modules, etc.).  This blacklist approach ensures
 * directories like `bin/`, `lib/`, or custom folders are never silently
 * dropped — aligning with `importPipeline`'s own blacklist strategy.
 */
export async function copySkillBundle(sourceDir: string, targetDir: string): Promise<void> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
    const src = path.join(sourceDir, entry.name)
    const dest = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      await fs.cp(src, dest, { recursive: true })
    } else if (entry.isFile()) {
      await fs.copyFile(src, dest)
    }
  }
}
