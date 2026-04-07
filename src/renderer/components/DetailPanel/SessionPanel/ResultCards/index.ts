// SPDX-License-Identifier: Apache-2.0

/**
 * ResultCards — rich card renderers for NativeCapability tool results.
 *
 * Rich-card tools are rendered in ToolResultBlockView via RESULT_CARD_REGISTRY.
 * The tool_result block's raw JSON content is parsed by the registered parser
 * and passed as typed props to the corresponding card component.
 *
 * This barrel re-exports card components, data types, and parsers.
 */

// ─── Card components ────────────────────────────────────────────────────────

export { IssueResultCard } from './IssueResultCard'
export { IssueListResultCard } from './IssueListResultCard'
export { LifecycleOperationResultCard } from './LifecycleOperationResultCard'
export { ProjectResultCard } from './ProjectResultCard'
export { ProjectListResultCard } from './ProjectListResultCard'
export { CardShell } from './CardShell'

// ─── Browser card components ─────────────────────────────────────────────────

export {
  BrowserNavigateCard,
  BrowserActionStatusCard,
  BrowserUploadStatusCard,
  BrowserExtractCard,
  BrowserSnapshotCard,
  BrowserScreenshotResultCard,
} from './BrowserResultCards'

// ─── Data types ─────────────────────────────────────────────────────────────

export type { IssueData, ChildIssueData } from './IssueResultCard'
export type { IssueListData, IssueSummary } from './IssueListResultCard'
export type { ProjectData } from './ProjectResultCard'
export type { ProjectListData, ProjectSummary } from './ProjectListResultCard'

export type {
  BrowserNavigateResult,
  BrowserActionResult,
  BrowserUploadResult,
  BrowserExtractResult,
  BrowserSnapshotResult,
  BrowserScreenshotResult,
} from './parseBrowserResult'

// ─── Parsers (stable references for RESULT_CARD_REGISTRY) ───────────────────

export { parseIssueData } from './IssueResultCard'
export { parseIssueListData } from './IssueListResultCard'
export { parseLifecycleOperationData } from './LifecycleOperationResultCard'
export { parseProjectData } from './ProjectResultCard'
export { parseProjectListData } from './ProjectListResultCard'

export {
  parseBrowserNavigate,
  parseBrowserAction,
  parseBrowserUpload,
  parseBrowserExtract,
  parseBrowserSnapshot,
  parseBrowserScreenshot,
} from './parseBrowserResult'
