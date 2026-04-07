// SPDX-License-Identifier: Apache-2.0

/**
 * OpenCow MCP NativeCapability tool name constant registry.
 *
 * Eliminates the 7 hardcoded `mcp__opencow-capabilities__browser_*` switch cases
 * in ToolUseBlockView.tsx; all imports come from here, ensuring compile-time consistency.
 */

import { MCP_SERVER_QUALIFIED_NAME } from './appIdentity'

export const NativeCapabilityTools = {
  // ─── Browser Tools ─────────────────────────────────────────────────────────
  BROWSER_NAVIGATE:   `${MCP_SERVER_QUALIFIED_NAME}__browser_navigate`,
  BROWSER_CLICK:      `${MCP_SERVER_QUALIFIED_NAME}__browser_click`,
  BROWSER_TYPE:       `${MCP_SERVER_QUALIFIED_NAME}__browser_type`,
  BROWSER_EXTRACT:    `${MCP_SERVER_QUALIFIED_NAME}__browser_extract`,
  BROWSER_SCREENSHOT: `${MCP_SERVER_QUALIFIED_NAME}__browser_screenshot`,
  BROWSER_SCROLL:     `${MCP_SERVER_QUALIFIED_NAME}__browser_scroll`,
  BROWSER_WAIT:       `${MCP_SERVER_QUALIFIED_NAME}__browser_wait`,
  BROWSER_SNAPSHOT:   `${MCP_SERVER_QUALIFIED_NAME}__browser_snapshot`,
  BROWSER_REF_CLICK:  `${MCP_SERVER_QUALIFIED_NAME}__browser_ref_click`,
  BROWSER_REF_TYPE:   `${MCP_SERVER_QUALIFIED_NAME}__browser_ref_type`,
  BROWSER_UPLOAD:     `${MCP_SERVER_QUALIFIED_NAME}__browser_upload`,

  // ─── Issue Tools ───────────────────────────────────────────────────────────
  ISSUE_LIST:         `${MCP_SERVER_QUALIFIED_NAME}__list_issues`,
  ISSUE_GET:          `${MCP_SERVER_QUALIFIED_NAME}__get_issue`,
  ISSUE_PROPOSE_OPERATION: `${MCP_SERVER_QUALIFIED_NAME}__propose_issue_operation`,
  ISSUE_CREATE:       `${MCP_SERVER_QUALIFIED_NAME}__create_issue`,
  ISSUE_UPDATE:       `${MCP_SERVER_QUALIFIED_NAME}__update_issue`,

  // ─── Remote Issue Tools (Phase 3) ─────────────────────────────────────────
  REMOTE_ISSUE_SEARCH:  `${MCP_SERVER_QUALIFIED_NAME}__search_remote_issues`,
  REMOTE_ISSUE_GET:     `${MCP_SERVER_QUALIFIED_NAME}__get_remote_issue`,
  REMOTE_ISSUE_COMMENT: `${MCP_SERVER_QUALIFIED_NAME}__comment_remote_issue`,

  // ─── Project Tools ────────────────────────────────────────────────────────
  PROJECT_LIST:       `${MCP_SERVER_QUALIFIED_NAME}__list_projects`,
  PROJECT_GET:        `${MCP_SERVER_QUALIFIED_NAME}__get_project`,

  // ─── Schedule Tools ──────────────────────────────────────────────────────
  SCHEDULE_LIST:      `${MCP_SERVER_QUALIFIED_NAME}__list_schedules`,
  SCHEDULE_GET:       `${MCP_SERVER_QUALIFIED_NAME}__get_schedule`,
  SCHEDULE_PROPOSE_OPERATION: `${MCP_SERVER_QUALIFIED_NAME}__propose_schedule_operation`,
  SCHEDULE_CREATE:    `${MCP_SERVER_QUALIFIED_NAME}__create_schedule`,
  SCHEDULE_UPDATE:    `${MCP_SERVER_QUALIFIED_NAME}__update_schedule`,
  SCHEDULE_PAUSE:     `${MCP_SERVER_QUALIFIED_NAME}__pause_schedule`,
  SCHEDULE_RESUME:    `${MCP_SERVER_QUALIFIED_NAME}__resume_schedule`,
  SCHEDULE_PREVIEW:   `${MCP_SERVER_QUALIFIED_NAME}__preview_next_runs`,

  // ─── HTML Tools ───────────────────────────────────────────────────────────
  GEN_HTML:           `${MCP_SERVER_QUALIFIED_NAME}__gen_html`,

  // ─── Evose Gateway Tools ────────────────────────────────────────────────
  EVOSE_RUN_AGENT:    `${MCP_SERVER_QUALIFIED_NAME}__evose_run_agent`,
  EVOSE_RUN_WORKFLOW: `${MCP_SERVER_QUALIFIED_NAME}__evose_run_workflow`,
  EVOSE_LIST_APPS:    `${MCP_SERVER_QUALIFIED_NAME}__evose_list_apps`,

  // ─── Interaction Tools ─────────────────────────────────────────────────────
  ASK_USER_QUESTION:  `${MCP_SERVER_QUALIFIED_NAME}__ask_user_question`,
} as const

export type NativeCapabilityToolName = (typeof NativeCapabilityTools)[keyof typeof NativeCapabilityTools]
