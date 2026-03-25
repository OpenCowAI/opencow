// SPDX-License-Identifier: Apache-2.0

/**
 * Snapshot-Ref system type definitions.
 *
 * Pure type file — zero runtime code.
 *
 * Sources:
 * - CDP AX types: Chrome DevTools Protocol Accessibility domain
 * - TreeNode: Ported from Agent-Browser snapshot.rs (index-based model)
 * - RefEntry / SnapshotResult / SnapshotOptions: Original design
 *
 * @license Portions derived from Agent-Browser (Apache-2.0, Copyright 2025 Vercel Inc.)
 */

import type { BrowserExecutionContext } from '../types'

// ─── CDP Abstraction ─────────────────────────────────────────────────────

/**
 * CDP method invocation abstraction.
 *
 * Injected by BrowserActionExecutor via closure — SnapshotService never
 * touches WebContents directly. This enables:
 * 1. 100% unit-testable service (mock this function)
 * 2. Automatic inheritance of Executor's timeout/abort/error-classification
 * 3. No exposure of Executor's private cdp() method
 */
export type CdpFn = (
  method: string,
  params?: Record<string, unknown>,
  timeoutMs?: number,
  context?: BrowserExecutionContext,
) => Promise<unknown>

// ─── CDP Accessibility Types ─────────────────────────────────────────────

/** CDP AXValue object from Accessibility domain. */
export interface CdpAXValue {
  type: string
  value?: unknown
}

/** CDP AXProperty object. */
export interface CdpAXProperty {
  name: string
  value: CdpAXValue
}

/** CDP AXNode — corresponds to Accessibility.AXNode. */
export interface CdpAXNode {
  nodeId: string
  role?: CdpAXValue
  name?: CdpAXValue
  value?: CdpAXValue
  description?: CdpAXValue
  properties?: CdpAXProperty[]
  childIds?: string[]
  parentId?: string
  backendDOMNodeId?: number
  ignored?: boolean
  frameId?: string
}

// ─── Cursor Detection ────────────────────────────────────────────────────

/**
 * Cursor-interactive element detected by JS injection.
 *
 * These are non-standard interactive elements (div[onclick], span[cursor:pointer])
 * that lack ARIA roles but are clickable in the real world.
 */
export interface CursorElementInfo {
  text: string
  tagName: string
  hasOnClick: boolean
  hasCursorPointer: boolean
  hasTabIndex: boolean
  isEditable: boolean
}

// ─── Tree Model (Index-Based) ────────────────────────────────────────────

/**
 * Internal tree node — index-based model.
 *
 * Ported from Agent-Browser snapshot.rs TreeNode struct.
 * Uses array indices instead of pointers — serializable, no circular refs.
 *
 * @example
 * treeNodes[0].children = [1, 2, 3]  // children are indices into treeNodes[]
 * treeNodes[1].parentIdx = 0          // parent is also an index
 */
export interface TreeNode {
  /** Accessibility role (e.g. "button", "link", "heading") */
  role: string

  /** Accessibility name */
  name: string

  /** Child node indices into the TreeNode[] array */
  children: number[]

  /** Parent node index (undefined for root nodes) */
  parentIdx?: number

  /** Tree depth (0 = root) */
  depth: number

  /** DOM backend node ID — used for DOM.getBoxModel → precise clicking */
  backendNodeId?: number

  /** Heading level (1-6) */
  level?: number

  /** Checkbox/radio state: "true" | "false" | "mixed" */
  checked?: string

  /** Expanded state for collapsible elements */
  expanded?: boolean

  /** Selection state */
  selected?: boolean

  /** Disabled state */
  disabled?: boolean

  /** Required field marker */
  required?: boolean

  /** Value text (e.g. current input value, slider position) */
  valueText?: string

  /**
   * Whether this node has an allocated ref.
   * @mutatedBy allocateRefs() — initialized `false` by buildTree(), set `true` during ref allocation.
   */
  hasRef: boolean

  /**
   * The allocated ref string (e.g. "e1").
   * @mutatedBy allocateRefs() — set during ref allocation phase.
   */
  refId?: string

  /**
   * Cursor-interactive info detected by JS injection.
   * @mutatedBy allocateRefs() — set when cursor detection finds this element.
   */
  cursorInfo?: CursorElementInfo
}

// ─── Ref Entry ───────────────────────────────────────────────────────────

/**
 * Maps a human-readable ref string to a specific interactable element.
 *
 * The Agent uses refs (e.g. "e1", "e5") to precisely target elements
 * without needing to construct fragile CSS selectors.
 */
export interface RefEntry {
  /** Ref identifier (e.g. "e1", "e2") */
  readonly ref: string

  /** Index into the TreeNode[] array */
  readonly nodeIdx: number

  /** DOM backend node ID — for DOM.getBoxModel → click coordinates */
  readonly backendNodeId?: number

  /** Accessibility role */
  readonly role: string

  /** Accessibility name */
  readonly name: string

  /** Occurrence index for duplicate role+name pairs (0-based) */
  readonly nth?: number

  /** Iframe frame ID (when element is inside an iframe) */
  readonly frameId?: string
}

// ─── Snapshot Options ────────────────────────────────────────────────────

/** Options for snapshot generation. */
export interface SnapshotOptions {
  /** CSS selector to limit snapshot to a subtree */
  readonly selector?: string

  /** Only include elements with refs (interactive elements) */
  readonly interactiveOnly?: boolean

  /** Compact format — only ref lines + their ancestors */
  readonly compact?: boolean

  /** Maximum tree depth */
  readonly maxDepth?: number

  /** Detect cursor-interactive elements (default: true) */
  readonly detectCursorInteractive?: boolean
}

// ─── Snapshot Result ─────────────────────────────────────────────────────

/** Complete snapshot result returned to the Agent. */
export interface SnapshotResult {
  /** Page URL */
  readonly url: string

  /** Page title */
  readonly title: string

  /** Rendered accessibility tree as compact text */
  readonly tree: string

  /** Ref → RefEntry mapping */
  readonly refMap: ReadonlyMap<string, RefEntry>

  /** Total number of allocated refs */
  readonly refCount: number

  /** Snapshot timestamp (epoch ms) */
  readonly timestamp: number
}
