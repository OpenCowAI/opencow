// SPDX-License-Identifier: Apache-2.0

/**
 * snapshot/ — Snapshot-Ref system barrel file.
 *
 * Re-exports all public types and classes for the Snapshot-Ref system.
 */

// Types
export type {
  CdpFn,
  CdpAXNode,
  CdpAXValue,
  CdpAXProperty,
  CursorElementInfo,
  TreeNode,
  RefEntry,
  SnapshotOptions,
  SnapshotResult,
} from './snapshotTypes'

// Pure functions
export { buildTree, normalizeNodeId, extractAXString, extractProperties, optimizeStaticText, stripInvisibleChars } from './treeBuilder'
export { allocateRefs, RoleNameTracker, INTERACTIVE_ROLES, CONTENT_ROLES, STRUCTURAL_ROLES } from './refAllocator'
export { renderTree, compactTree, countIndent } from './renderer'
export { detectCursorInteractiveElements } from './cursorDetector'
// iframeResolver is reserved for future iframe recursive snapshot support.
// Not exported until actively consumed to keep the public API minimal.

// Classes
export { SnapshotState } from './snapshotState'
export { SnapshotService } from './snapshotService'
export type { SnapshotServiceDeps } from './snapshotService'
