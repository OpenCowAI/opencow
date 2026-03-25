// SPDX-License-Identifier: Apache-2.0

/**
 * renderer — TreeNode[] → compact text representation.
 *
 * Ported from Agent-Browser snapshot.rs `render_tree()` + `compact_tree()`.
 * Produces indented accessibility tree text that AI Agents can parse efficiently.
 *
 * @license Derived from Agent-Browser (Apache-2.0, Copyright 2025 Vercel Inc.)
 */

import type { TreeNode } from './snapshotTypes'

// ─── Roles to skip (transparent containers) ──────────────────────────────

const SKIP_ROLES: ReadonlySet<string> = new Set(['', 'RootWebArea', 'WebArea'])

/**
 * Hard recursion depth limit to prevent stack overflow on pathologically
 * deep DOM trees. Node.js default stack size allows ~10k frames;
 * we use a conservative limit to leave headroom for other call frames.
 */
const MAX_RECURSION_DEPTH = 500

// ─── Tree Rendering ──────────────────────────────────────────────────────

/**
 * Recursively render the accessibility tree into indented text lines.
 *
 * Skip rules:
 * - Empty role / RootWebArea / WebArea → skip self, promote children
 * - generic + no ref + ≤1 child → skip self, promote children (Agent-Browser rule)
 * - interactiveOnly + no ref → skip self, promote children
 * - maxDepth exceeded → stop recursion
 *
 * Output format per line:
 *   {indent}- {role} "{name}" [{attrs}]: {value}
 *
 * @param nodes - The full tree node array
 * @param idx - Current node index
 * @param indent - Current indentation level
 * @param lines - Accumulator for output lines (mutated)
 * @param options - Rendering options
 */
export function renderTree(
  nodes: readonly TreeNode[],
  idx: number,
  indent: number,
  lines: string[],
  options: { interactiveOnly?: boolean; maxDepth?: number } = {},
): void {
  const node = nodes[idx]
  if (!node) return

  // Hard recursion depth guard — prevents stack overflow on pathological trees.
  // Skipped nodes still promote children at the same indent, so `indent` doesn't
  // always track recursion depth. We use indent as a proxy since it's bounded
  // by the actual nesting level plus user's maxDepth.
  if (indent > MAX_RECURSION_DEPTH) return

  // Determine if this node should be skipped (children promoted)
  //
  // Skip rules:
  // 1. SKIP_ROLES: empty role, RootWebArea, WebArea — transparent containers
  // 2. interactiveOnly mode: non-ref nodes are skipped
  // 3. generic node: skip when no ref AND at most 1 child (Agent-Browser rule)
  //    This collapses meaningless wrapper <div>/<span> without losing structure.
  const isGenericSkip =
    node.role === 'generic' && !node.hasRef && node.children.length <= 1

  const skipSelf =
    SKIP_ROLES.has(node.role) ||
    isGenericSkip ||
    (options.interactiveOnly === true && !node.hasRef)

  if (skipSelf) {
    // Recurse children at the SAME indent level (promote)
    for (const childIdx of node.children) {
      renderTree(nodes, childIdx, indent, lines, options)
    }
    return
  }

  // Depth limit check
  if (options.maxDepth !== undefined && indent > options.maxDepth) {
    return
  }

  // ── Build the output line ──────────────────────────────────────────

  const padding = '  '.repeat(indent)
  let line = `${padding}- ${node.role}`

  // Quoted display name
  const displayName = node.name || node.cursorInfo?.text || ''
  if (displayName) {
    line += ` "${displayName}"`
  }

  // Attributes in [...]
  const attrs: string[] = []
  if (node.hasRef && node.refId) attrs.push(`ref=${node.refId}`)
  if (node.level !== undefined) attrs.push(`level=${node.level}`)
  if (node.checked !== undefined) attrs.push(`checked=${node.checked}`)
  if (node.expanded !== undefined) attrs.push(`expanded=${node.expanded}`)
  if (node.selected === true) attrs.push('selected')
  if (node.disabled === true) attrs.push('disabled')
  if (node.required === true) attrs.push('required')

  if (attrs.length > 0) {
    line += ` [${attrs.join(', ')}]`
  }

  // Value text (skip if same as name to avoid repetition)
  if (node.valueText && node.valueText !== node.name) {
    line += `: ${node.valueText}`
  }

  lines.push(line)

  // ── Recurse children at indent + 1 ────────────────────────────────

  for (const childIdx of node.children) {
    renderTree(nodes, childIdx, indent + 1, lines, options)
  }
}

// ─── Compact Mode ────────────────────────────────────────────────────────

/**
 * Count the indentation level of a line (each level = 2 spaces).
 */
export function countIndent(line: string): number {
  const stripped = line.trimStart()
  return (line.length - stripped.length) / 2
}

/**
 * Compact the rendered tree — keep only meaningful lines + their ancestors.
 *
 * A line is "meaningful" if it contains:
 * - `[ref=` (an interactable element)
 * - `]: ` (an element with a value — the `]` prefix anchors to attribute brackets,
 *         avoiding false positives from role/name text containing `: `)
 *
 * For each meaningful line, all ancestor lines (determined by indentation)
 * are also preserved to maintain tree structure context.
 *
 * @param tree - The full rendered tree text
 * @param interactive - Whether this was an interactive-only snapshot
 * @returns Compacted tree text
 */
export function compactTree(tree: string, interactive?: boolean): string {
  if (!tree) {
    return interactive ? '(no interactive elements)' : ''
  }

  const lines = tree.split('\n')
  const keep = new Set<number>()

  // Mark meaningful lines and their ancestors
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // A line is meaningful if it has a ref OR has a value.
    // Value lines end with `]: value` (when attrs present) or match `": value`
    // (when no attrs). We use `]: ` as primary check since most value nodes
    // also have ref/attrs. The `[ref=` check catches all interactive elements.
    if (line.includes('[ref=') || line.includes(']: ') || /"\s*: /.test(line)) {
      keep.add(i)

      // Backtrack to find and keep ancestor lines
      let currentIndent = countIndent(line)
      for (let j = i - 1; j >= 0 && currentIndent > 0; j--) {
        const ancestorIndent = countIndent(lines[j])
        if (ancestorIndent < currentIndent) {
          keep.add(j)
          currentIndent = ancestorIndent
        }
      }
    }
  }

  const result = lines.filter((_, i) => keep.has(i)).join('\n')

  if (!result && interactive) {
    return '(no interactive elements)'
  }

  return result
}
