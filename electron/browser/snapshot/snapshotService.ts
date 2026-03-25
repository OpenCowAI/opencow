// SPDX-License-Identifier: Apache-2.0

/**
 * SnapshotService — Orchestrator for the Snapshot-Ref pipeline.
 *
 * Chains: CDP AX tree → buildTree → cursor detection → allocateRefs → renderTree → compact.
 * Does NOT hold state — delegates to SnapshotState for ref storage.
 *
 * Receives CdpFn via constructor injection:
 *   - 100% unit-testable (mock CdpFn)
 *   - Automatically inherits Executor's timeout/abort/error-classification
 *   - No exposure of Executor's private cdp()
 */

import type {
  CdpAXNode,
  CdpFn,
  CursorElementInfo,
  SnapshotOptions,
  SnapshotResult,
  TreeNode,
} from './snapshotTypes'
import type { BrowserExecutionContext } from '../types'
import { buildTree } from './treeBuilder'
import { allocateRefs } from './refAllocator'
import { detectCursorInteractiveElements } from './cursorDetector'
import { renderTree, compactTree } from './renderer'

// ─── Dependencies ────────────────────────────────────────────────────────

export interface SnapshotServiceDeps {
  cdp: CdpFn
}

// ─── Service ─────────────────────────────────────────────────────────────

export class SnapshotService {
  private readonly cdp: CdpFn

  /** Ref counter persists across snapshots for stable iframe ref numbering. */
  private nextRefNum: number = 1

  constructor(deps: SnapshotServiceDeps) {
    this.cdp = deps.cdp
  }

  /**
   * Take a full accessibility snapshot of the current page.
   *
   * Pipeline:
   * 1. Enable CDP domains (Accessibility + DOM)
   * 2. (Optional) Resolve subtree scope via selector
   * 3. Fetch full AX tree
   * 4. Build indexed tree
   * 5. (Optional) Detect cursor-interactive elements
   * 6. Allocate refs
   * 7. Render tree to text
   * 8. (Optional) Compact mode
   * 9. Get page info
   * 10. Assemble result
   */
  async takeSnapshot(
    options: SnapshotOptions = {},
    context: BrowserExecutionContext = {},
  ): Promise<SnapshotResult> {
    const cdp = this.cdp

    // ── Step 1: Enable required CDP domains ─────────────────────────
    await this.ensureCdpDomains(context)

    // ── Step 2: (Optional) Resolve subtree scope ────────────────────
    let subtreeBackendIds: Set<number> | undefined
    if (options.selector) {
      subtreeBackendIds = await this.resolveSubtreeNodeIds(options.selector, context)
    }

    // ── Step 3: Fetch full AX tree ──────────────────────────────────
    const axResult = (await cdp('Accessibility.getFullAXTree', undefined, undefined, context)) as {
      nodes: CdpAXNode[]
    }

    // ── Step 4: Build indexed tree ──────────────────────────────────
    // Always build the FULL tree first to preserve parent-child links.
    // Subtree filtering happens at the rendering phase (step 7) by
    // restricting which root indices are rendered.
    const { treeNodes, rootIndices: fullRootIndices } = buildTree(axResult.nodes)

    // If selector was provided, find the subtree root(s) in the built tree
    // instead of filtering AXNodes (which would break childIds references).
    let rootIndices: number[]
    if (subtreeBackendIds) {
      rootIndices = findSubtreeRoots(treeNodes, subtreeBackendIds)
      if (rootIndices.length === 0) {
        // Fallback: selector matched DOM elements but no AX tree nodes
        rootIndices = fullRootIndices
      }
    } else {
      rootIndices = fullRootIndices
    }

    // ── Step 5: (Optional) Detect cursor-interactive elements ───────
    let cursorElements: Map<number, CursorElementInfo> | undefined
    if (options.detectCursorInteractive !== false) {
      try {
        cursorElements = await detectCursorInteractiveElements(cdp, context)
      } catch {
        // Cursor detection is best-effort — don't fail the snapshot
      }
    }

    // ── Step 6: Allocate refs ───────────────────────────────────────
    // Safety: reset ref counter if it grows unreasonably large (e.g. after
    // many SPA navigations without full page reload). Keeps ref strings short.
    if (this.nextRefNum > 100_000) {
      this.nextRefNum = 1
    }
    const { refMap, nextRefNum } = allocateRefs(treeNodes, cursorElements, this.nextRefNum)
    this.nextRefNum = nextRefNum

    // ── Step 7: Render tree to text ─────────────────────────────────
    const lines: string[] = []
    for (const rootIdx of rootIndices) {
      renderTree(treeNodes, rootIdx, 0, lines, {
        interactiveOnly: options.interactiveOnly,
        maxDepth: options.maxDepth,
      })
    }

    let tree = lines.join('\n')

    // ── Step 8: (Optional) Compact mode ─────────────────────────────
    if (options.compact) {
      tree = compactTree(tree, options.interactiveOnly)
    }

    // ── Step 9: Get page info ───────────────────────────────────────
    const pageInfoResult = (await cdp('Runtime.evaluate', {
      expression: '({url:location.href,title:document.title})',
      returnByValue: true,
    }, undefined, context)) as { result: { value: { url: string; title: string } } }

    const pageInfo = pageInfoResult.result.value

    // ── Step 10: Assemble result ────────────────────────────────────
    return {
      url: pageInfo.url,
      title: pageInfo.title,
      tree,
      refMap,
      refCount: refMap.size,
      timestamp: Date.now(),
    }
  }

  /**
   * Reset ref counter (e.g. after full page navigation).
   * Also resets CDP domain state so they re-enable on next snapshot.
   */
  resetRefCounter(): void {
    this.nextRefNum = 1
    this.domainsEnabled = false
  }

  // ── Helpers ────────────────────────────────────────────────────────

  /** Tracks whether CDP domains have been enabled for this session. */
  private domainsEnabled = false

  /**
   * Enable required CDP domains (Accessibility + DOM) once per session.
   * Idempotent — subsequent calls are no-ops until resetRefCounter().
   *
   * Fix for H4: avoid redundant Accessibility.enable + DOM.enable calls
   * on every snapshot.
   */
  private async ensureCdpDomains(context: BrowserExecutionContext): Promise<void> {
    if (this.domainsEnabled) return
    await this.cdp('Accessibility.enable', undefined, undefined, context)
    await this.cdp('DOM.enable', undefined, undefined, context)
    this.domainsEnabled = true
  }

  /**
   * Resolve a CSS selector to the set of backendNodeIds in its subtree.
   */
  private async resolveSubtreeNodeIds(
    selector: string,
    context: BrowserExecutionContext,
  ): Promise<Set<number>> {
    const cdp = this.cdp

    // Evaluate selector in page context
    const evalResult = (await cdp('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)})`,
      returnByValue: false,
    }, undefined, context)) as { result: { objectId?: string } }

    if (!evalResult.result.objectId) {
      throw {
        code: 'AX_TREE_FAILED' as const,
        message: `Selector "${selector}" did not match any element.`,
      }
    }

    // Resolve to DOM node
    const nodeResult = (await cdp('DOM.requestNode', {
      objectId: evalResult.result.objectId,
    }, undefined, context)) as { nodeId: number }

    // Describe the full subtree
    const described = (await cdp('DOM.describeNode', {
      nodeId: nodeResult.nodeId,
      depth: -1,
    }, undefined, context)) as { node: DomNode }

    // Collect all backendNodeIds recursively
    const ids = new Set<number>()
    collectBackendNodeIds(described.node, ids)
    return ids
  }
}

// ─── Internal DOM traversal ──────────────────────────────────────────────

interface DomNode {
  backendNodeId: number
  children?: DomNode[]
  contentDocument?: DomNode
  shadowRoots?: DomNode[]
}

function collectBackendNodeIds(node: DomNode, ids: Set<number>): void {
  ids.add(node.backendNodeId)

  if (node.children) {
    for (const child of node.children) {
      collectBackendNodeIds(child, ids)
    }
  }
  if (node.contentDocument) {
    collectBackendNodeIds(node.contentDocument, ids)
  }
  if (node.shadowRoots) {
    for (const root of node.shadowRoots) {
      collectBackendNodeIds(root, ids)
    }
  }
}

// ─── Subtree Root Finder ──────────────────────────────────────────────────

/**
 * Find the shallowest tree nodes whose backendNodeId is in the target set.
 *
 * Strategy: walk all tree nodes and find those with a matching backendNodeId
 * that are NOT descendants of another matching node. This gives us the
 * "subtree roots" to render.
 *
 * Fix for H5: Previously we filtered AXNodes by backendDOMNodeId before
 * building the tree. This broke childIds references because tree links use
 * AX nodeId, not backendDOMNodeId. Now we build the full tree first and
 * restrict rendering to subtree roots.
 */
function findSubtreeRoots(
  treeNodes: readonly TreeNode[],
  backendNodeIds: ReadonlySet<number>,
): number[] {
  // Find all nodes with matching backendNodeId
  const matchingIndices: number[] = []
  for (let i = 0; i < treeNodes.length; i++) {
    const node = treeNodes[i]
    if (node.backendNodeId !== undefined && backendNodeIds.has(node.backendNodeId)) {
      matchingIndices.push(i)
    }
  }

  if (matchingIndices.length === 0) return []

  // Build a set for fast lookup
  const matchingSet = new Set(matchingIndices)

  // Find the shallowest matches — those whose ancestors are NOT in the matching set.
  // These are the subtree roots.
  const roots: number[] = []
  for (const idx of matchingIndices) {
    let isDescendant = false
    let parent = treeNodes[idx].parentIdx

    while (parent !== undefined) {
      if (matchingSet.has(parent)) {
        isDescendant = true
        break
      }
      parent = treeNodes[parent].parentIdx
    }

    if (!isDescendant) {
      roots.push(idx)
    }
  }

  return roots
}
