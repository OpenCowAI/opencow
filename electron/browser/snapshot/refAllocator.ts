// SPDX-License-Identifier: Apache-2.0

/**
 * refAllocator — Role classification + ref allocation.
 *
 * Ported from Agent-Browser snapshot.rs role constants + RoleNameTracker.
 * Role sets are strictly from the Rust source (18 + 10 + 20).
 *
 * @license Derived from Agent-Browser (Apache-2.0, Copyright 2025 Vercel Inc.)
 */

import type { TreeNode, CursorElementInfo, RefEntry } from './snapshotTypes'

// ─── Role Classification (strict Agent-Browser alignment) ────────────────

/**
 * Interactive roles — ALWAYS get a ref.
 * 18 roles matching Agent-Browser snapshot.rs.
 */
export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'treeitem',
  'Iframe',
])

/**
 * Content roles — get a ref IF they have a non-empty name.
 * 10 roles matching Agent-Browser snapshot.rs.
 */
export const CONTENT_ROLES: ReadonlySet<string> = new Set([
  'heading',
  'cell',
  'gridcell',
  'columnheader',
  'rowheader',
  'listitem',
  'article',
  'region',
  'main',
  'navigation',
])

/**
 * Structural roles — never get refs, but provide tree structure.
 * 20 roles matching Agent-Browser snapshot.rs.
 */
export const STRUCTURAL_ROLES: ReadonlySet<string> = new Set([
  'generic',
  'group',
  'list',
  'table',
  'row',
  'rowgroup',
  'grid',
  'treegrid',
  'menu',
  'menubar',
  'toolbar',
  'tablist',
  'tree',
  'directory',
  'document',
  'application',
  'presentation',
  'none',
  'WebArea',
  'RootWebArea',
])

// ─── Role-Name Tracker ───────────────────────────────────────────────────

/**
 * Tracks role:name pairs and counts occurrences.
 * Used to detect duplicate elements and assign nth indices.
 */
export class RoleNameTracker {
  private readonly counts = new Map<string, number>()

  /**
   * Track a role-name combination. Returns the occurrence index (0-based).
   */
  track(role: string, name: string): number {
    const key = `${role}:${name}`
    const count = this.counts.get(key) ?? 0
    this.counts.set(key, count + 1)
    return count
  }

  /**
   * Get all role-name keys that appear more than once.
   */
  getDuplicateKeys(): ReadonlySet<string> {
    const dupes = new Set<string>()
    for (const [key, count] of this.counts) {
      if (count > 1) dupes.add(key)
    }
    return dupes
  }
}

// ─── Ref Allocation ──────────────────────────────────────────────────────

/**
 * Allocate refs to tree nodes based on role classification.
 *
 * Allocation rules:
 * 1. INTERACTIVE_ROLES → always assign ref
 * 2. CONTENT_ROLES + non-empty name → assign ref
 * 3. cursorElements map hit (by backendNodeId) → assign ref
 * 4. Otherwise → no ref
 *
 * Refs are "e{N}" where N starts from startRef and increments.
 *
 * @param treeNodes - The built tree (mutated: hasRef + refId set on nodes)
 * @param cursorElements - Optional map from backendNodeId → cursor info
 * @param startRef - Starting ref number (default 1 → "e1")
 * @returns refMap + nextRefNum for chaining (iframe recursion)
 */
export function allocateRefs(
  treeNodes: TreeNode[],
  cursorElements?: ReadonlyMap<number, CursorElementInfo>,
  startRef: number = 1,
): { refMap: Map<string, RefEntry>; nextRefNum: number } {
  const refMap = new Map<string, RefEntry>()
  const tracker = new RoleNameTracker()
  let currentRefNum = startRef

  // ── First pass: determine which nodes get refs ────────────────────────

  const pendingRefs: Array<{
    nodeIdx: number
    role: string
    name: string
    nth: number
  }> = []

  for (let i = 0; i < treeNodes.length; i++) {
    const node = treeNodes[i]
    if (!node.role) continue

    let shouldAllocate = false

    if (INTERACTIVE_ROLES.has(node.role)) {
      shouldAllocate = true
    } else if (CONTENT_ROLES.has(node.role) && node.name.length > 0) {
      shouldAllocate = true
    } else if (cursorElements && node.backendNodeId !== undefined && cursorElements.has(node.backendNodeId)) {
      shouldAllocate = true
      // Attach cursor info to the tree node
      node.cursorInfo = cursorElements.get(node.backendNodeId)
    }

    if (shouldAllocate) {
      const nth = tracker.track(node.role, node.name)
      pendingRefs.push({ nodeIdx: i, role: node.role, name: node.name, nth })
    }
  }

  // ── Second pass: identify duplicates and assign refs ──────────────────

  const duplicateKeys = tracker.getDuplicateKeys()

  for (const pending of pendingRefs) {
    const refKey = `e${currentRefNum}`
    const key = `${pending.role}:${pending.name}`
    const hasDuplicate = duplicateKeys.has(key)

    // Update tree node
    treeNodes[pending.nodeIdx].hasRef = true
    treeNodes[pending.nodeIdx].refId = refKey

    // Create ref entry
    refMap.set(refKey, {
      ref: refKey,
      nodeIdx: pending.nodeIdx,
      backendNodeId: treeNodes[pending.nodeIdx].backendNodeId,
      role: pending.role,
      name: pending.name,
      nth: hasDuplicate ? pending.nth : undefined,
    })

    currentRefNum++
  }

  return { refMap, nextRefNum: currentRefNum }
}
