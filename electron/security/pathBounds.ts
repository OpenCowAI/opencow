// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import fs from 'node:fs/promises'

/**
 * Returns true when targetPath is inside (or equal to) baseDir after path resolution.
 */
export function isPathWithinBase(targetPath: string, baseDir: string): boolean {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedBase = path.resolve(baseDir)
  const relative = path.relative(resolvedBase, resolvedTarget)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Resolve both target/base via realpath and validate that target still stays
 * within base after symlink resolution.
 *
 * This closes symlink-escape gaps that lexical path checks cannot catch.
 */
export async function isRealPathWithinBase(targetPath: string, baseDir: string): Promise<boolean> {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedBase = path.resolve(baseDir)
  if (!isPathWithinBase(resolvedTarget, resolvedBase)) {
    return false
  }

  const [realTarget, realBase] = await Promise.all([
    fs.realpath(resolvedTarget),
    fs.realpath(resolvedBase),
  ])
  return isPathWithinBase(realTarget, realBase)
}
