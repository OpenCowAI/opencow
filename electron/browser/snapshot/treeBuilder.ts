// SPDX-License-Identifier: Apache-2.0

/**
 * treeBuilder — CDP AXNode[] → indexed TreeNode[] tree.
 *
 * Ported from Agent-Browser snapshot.rs `build_tree()`.
 * Two-pass algorithm: create nodes → establish parent-child links.
 *
 * @license Derived from Agent-Browser (Apache-2.0, Copyright 2025 Vercel Inc.)
 */

import type { CdpAXNode, CdpAXValue, CdpAXProperty, TreeNode } from './snapshotTypes'

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Normalize node ID — Chrome may return string or number.
 */
export function normalizeNodeId(v: string | number): string {
  return typeof v === 'string' ? v : String(v)
}

/**
 * Extract a string from a CDP AXValue.
 * Handles string, number, boolean, and nested value objects.
 */
export function extractAXString(axValue?: CdpAXValue): string {
  if (!axValue) return ''

  const v = axValue.value
  if (v === undefined || v === null) return ''

  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return String(v)

  // Handle nested object values — CDP sometimes wraps values in {type, value}
  if (typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    const nested = (v as Record<string, unknown>).value
    if (typeof nested === 'string') return nested
    if (nested !== undefined && nested !== null) return String(nested)
  }

  return ''
}

/**
 * Extract key state properties from an AXNode's property array.
 */
export function extractProperties(props?: CdpAXProperty[]): {
  level?: number
  checked?: string
  expanded?: boolean
  selected?: boolean
  disabled?: boolean
  required?: boolean
} {
  const result: {
    level?: number
    checked?: string
    expanded?: boolean
    selected?: boolean
    disabled?: boolean
    required?: boolean
  } = {}

  if (!props || props.length === 0) return result

  for (const prop of props) {
    const val = extractAXString(prop.value)
    if (!val) continue

    switch (prop.name) {
      case 'level': {
        const num = parseInt(val, 10)
        if (!isNaN(num)) result.level = num
        break
      }
      case 'checked':
        // "true" | "false" | "mixed"
        result.checked = val
        break
      case 'expanded':
        result.expanded = val === 'true'
        break
      case 'selected':
        result.selected = val === 'true'
        break
      case 'disabled':
        if (val === 'true') result.disabled = true
        break
      case 'required':
        if (val === 'true') result.required = true
        break
    }
  }

  return result
}

// ─── Main ────────────────────────────────────────────────────────────────

/**
 * Build an indexed tree from a flat CDP AXNode array.
 *
 * Algorithm:
 * 1. First pass: create TreeNode for each AXNode, index by nodeId
 * 2. Second pass: establish parent-child links via childIds
 * 3. Identify root nodes (those not referenced as children)
 * 4. DFS to set depth values
 *
 * @param nodes - Flat array from Accessibility.getFullAXTree
 * @returns treeNodes (indexed array) + rootIndices (entry points)
 */
export function buildTree(nodes: CdpAXNode[]): {
  treeNodes: TreeNode[]
  rootIndices: number[]
} {
  const treeNodes: TreeNode[] = []
  const nodeIdToIndex = new Map<string, number>()
  const childSet = new Set<string>()

  // ── Pass 1: Create TreeNodes ──────────────────────────────────────────

  for (const node of nodes) {
    const nodeId = normalizeNodeId(node.nodeId)
    const index = treeNodes.length
    nodeIdToIndex.set(nodeId, index)

    const isIgnored = node.ignored === true
    const roleStr = extractAXString(node.role)

    // Ignored nodes get empty shells (unless they're RootWebArea)
    if (isIgnored && roleStr !== 'RootWebArea') {
      treeNodes.push({
        role: '',
        name: '',
        children: [],
        parentIdx: undefined,
        depth: 0,
        hasRef: false,
      })
      continue
    }

    // Normal node creation
    const nameStr = extractAXString(node.name)
    const props = extractProperties(node.properties)

    const treeNode: TreeNode = {
      role: roleStr,
      name: nameStr,
      children: [],
      parentIdx: undefined,
      depth: 0,
      hasRef: false,
    }

    // Optional fields — only set if present
    if (node.backendDOMNodeId !== undefined) treeNode.backendNodeId = node.backendDOMNodeId
    if (props.level !== undefined) treeNode.level = props.level
    if (props.checked !== undefined) treeNode.checked = props.checked
    if (props.expanded !== undefined) treeNode.expanded = props.expanded
    if (props.selected !== undefined) treeNode.selected = props.selected
    if (props.disabled !== undefined) treeNode.disabled = props.disabled
    if (props.required !== undefined) treeNode.required = props.required

    // Value text
    const valueStr = extractAXString(node.value)
    if (valueStr) treeNode.valueText = valueStr

    treeNodes.push(treeNode)
  }

  // ── Pass 2: Establish parent-child links ──────────────────────────────

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (!node.childIds || node.childIds.length === 0) continue

    for (const childId of node.childIds) {
      const childNodeId = normalizeNodeId(childId)
      const childIndex = nodeIdToIndex.get(childNodeId)

      if (childIndex !== undefined) {
        childSet.add(childNodeId)
        treeNodes[i].children.push(childIndex)
        treeNodes[childIndex].parentIdx = i
      }
    }
  }

  // ── Find root nodes ───────────────────────────────────────────────────

  const rootIndices: number[] = []
  for (let i = 0; i < nodes.length; i++) {
    const nodeId = normalizeNodeId(nodes[i].nodeId)
    if (!childSet.has(nodeId)) {
      rootIndices.push(i)
    }
  }

  // ── DFS: set depth ────────────────────────────────────────────────────

  const setDepth = (idx: number, depth: number): void => {
    treeNodes[idx].depth = depth
    for (const childIdx of treeNodes[idx].children) {
      setDepth(childIdx, depth + 1)
    }
  }

  for (const rootIdx of rootIndices) {
    setDepth(rootIdx, 0)
  }

  // ── Post-processing: StaticText optimization ─────────────────────────
  // Ported from Agent-Browser snapshot.rs — 3 optimizations:
  // 1. Filter invisible characters from StaticText names
  // 2. Parent-child dedup: remove StaticText child if same as parent name
  // 3. Consecutive merge: merge adjacent StaticText siblings

  optimizeStaticText(treeNodes)

  return { treeNodes, rootIndices }
}

// ─── StaticText Optimization ──────────────────────────────────────────────

/**
 * Invisible/whitespace characters to strip from StaticText names.
 * Ported from Agent-Browser snapshot.rs.
 */
// eslint-disable-next-line no-misleading-character-class
const INVISIBLE_CHARS = /[\uFEFF\u200B\u200C\u200D\u2060\u00A0]/g

/**
 * Strip invisible characters from a string and trim whitespace.
 * Returns empty string if result is only whitespace.
 */
export function stripInvisibleChars(text: string): string {
  return text.replace(INVISIBLE_CHARS, '').trim()
}

/**
 * Post-process StaticText nodes for optimal tree output.
 *
 * Three optimizations ported from Agent-Browser snapshot.rs:
 *
 * 1. **Invisible character filtering**: Strip BOM (\uFEFF), ZWSP (\u200B),
 *    ZWNJ (\u200C), ZWJ (\u200D), WJ (\u2060), NBSP (\u00A0) from
 *    StaticText names. Mark empty-after-strip nodes for removal.
 *
 * 2. **Parent-child dedup**: If a parent's name equals the text of its
 *    only StaticText child, remove the child (redundant).
 *
 * 3. **Consecutive merge**: Merge adjacent StaticText siblings into one,
 *    separating with a space. Uses a double-pointer algorithm to rewrite
 *    the children array in place.
 *
 * "Removed" nodes are marked with `role: ''` so the renderer naturally
 * skips them. This avoids costly array index remapping.
 */
export function optimizeStaticText(treeNodes: TreeNode[]): void {
  // ── Pass 1: Filter invisible characters from all StaticText nodes ────
  for (const node of treeNodes) {
    if (node.role === 'StaticText') {
      node.name = stripInvisibleChars(node.name)
      // Mark empty StaticText for skip (role = '' is already skipped by renderer)
      if (node.name.length === 0) {
        node.role = ''
      }
    }
  }

  // ── Pass 2: Parent-child dedup + consecutive merge ───────────────────
  for (const node of treeNodes) {
    if (node.children.length === 0) continue

    // ── 2a: Parent-child dedup ─────────────────────────────────────────
    // If parent has exactly one child and that child is StaticText with
    // the same name, remove the child.
    if (node.children.length === 1) {
      const childIdx = node.children[0]
      const child = treeNodes[childIdx]
      if (child.role === 'StaticText' && child.name === node.name) {
        child.role = '' // mark for skip
        node.children = []
        continue
      }
    }

    // ── 2b: Consecutive merge (double-pointer) ────────────────────────
    // Walk the children array. When consecutive StaticText nodes are found,
    // merge their names into the first one and mark the rest for skip.
    let writeIdx = 0
    let readIdx = 0
    const children = node.children

    while (readIdx < children.length) {
      const curIdx = children[readIdx]
      const curNode = treeNodes[curIdx]

      if (curNode.role !== 'StaticText') {
        children[writeIdx++] = children[readIdx++]
        continue
      }

      // Accumulate consecutive StaticText
      const parts: string[] = [curNode.name]
      let nextRead = readIdx + 1

      while (nextRead < children.length) {
        const nextIdx = children[nextRead]
        const nextNode = treeNodes[nextIdx]
        if (nextNode.role !== 'StaticText') break

        parts.push(nextNode.name)
        // Mark merged node for skip
        nextNode.role = ''
        nextRead++
      }

      if (parts.length > 1) {
        // Merge into the first node
        curNode.name = parts.filter(Boolean).join(' ')
      }

      children[writeIdx++] = children[readIdx]
      readIdx = nextRead
    }

    // Truncate children array to the compacted size
    if (writeIdx < children.length) {
      children.length = writeIdx
    }
  }
}
