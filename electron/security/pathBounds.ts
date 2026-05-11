// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'

/**
 * Returns true when targetPath is inside (or equal to) baseDir after path resolution.
 *
 * This is a **lexical** check — it normalises the supplied strings but does
 * not follow symbolic links. It defends against textual escapes such as
 * `..` traversal and absolute paths pointing outside the base. Symlink
 * targets that physically resolve outside the base are deliberately allowed:
 * users routinely link sibling repositories or vendored directories into
 * a project, and read access through those links matches the affordance the
 * OS already grants the user. Writes are independently protected from
 * following symlinks via `O_NOFOLLOW` in the policy layer.
 */
export function isPathWithinBase(targetPath: string, baseDir: string): boolean {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedBase = path.resolve(baseDir)
  const relative = path.relative(resolvedBase, resolvedTarget)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
