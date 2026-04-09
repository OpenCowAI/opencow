// SPDX-License-Identifier: Apache-2.0

/**
 * OpenCow NativeCapability tool name constant registry.
 *
 * Single source of truth for the tool names that consumers (UI, services,
 * tests) compare against incoming SDK tool_use blocks.
 *
 * Phase 1B.11b: changed from MCP-prefixed names
 * (`mcp__opencow-capabilities__evose_run_agent`) to bare names
 * (`evose_run_agent`). The OpenCow electron main now uses the SDK's inline
 * tool exit (`Options.tools?: SdkTool[]`) instead of the MCP exit
 * (`Options.mcpServers`), so the model sees the bare descriptor name with
 * no `mcp__server__` transport-layer prefix.
 *
 * For backwards compatibility with stored sessions whose persisted
 * messages still contain MCP-prefixed names, the parsing helpers in
 * `evoseNames.ts` (and `toolMeta.ts` in the renderer) accept BOTH
 * forms via `extractEvoseLocalName` / extended `parseMcpToolName`.
 */

export const NativeCapabilityTools = {
  // ─── Browser Tools ─────────────────────────────────────────────────────────
  BROWSER_NAVIGATE:   'browser_navigate',
  BROWSER_CLICK:      'browser_click',
  BROWSER_TYPE:       'browser_type',
  BROWSER_EXTRACT:    'browser_extract',
  BROWSER_SCREENSHOT: 'browser_screenshot',
  BROWSER_SCROLL:     'browser_scroll',
  BROWSER_WAIT:       'browser_wait',
  BROWSER_SNAPSHOT:   'browser_snapshot',
  BROWSER_REF_CLICK:  'browser_ref_click',
  BROWSER_REF_TYPE:   'browser_ref_type',
  BROWSER_UPLOAD:     'browser_upload',

  // ─── Issue Tools ───────────────────────────────────────────────────────────
  ISSUE_LIST:              'list_issues',
  ISSUE_GET:               'get_issue',
  ISSUE_PROPOSE_OPERATION: 'propose_issue_operation',
  ISSUE_CREATE:            'create_issue',
  ISSUE_UPDATE:            'update_issue',

  // ─── Remote Issue Tools (Phase 3) ─────────────────────────────────────────
  REMOTE_ISSUE_SEARCH:  'search_remote_issues',
  REMOTE_ISSUE_GET:     'get_remote_issue',
  REMOTE_ISSUE_COMMENT: 'comment_remote_issue',

  // ─── Project Tools ────────────────────────────────────────────────────────
  PROJECT_LIST: 'list_projects',
  PROJECT_GET:  'get_project',

  // ─── Schedule Tools ──────────────────────────────────────────────────────
  SCHEDULE_LIST:              'list_schedules',
  SCHEDULE_GET:               'get_schedule',
  SCHEDULE_PROPOSE_OPERATION: 'propose_schedule_operation',
  SCHEDULE_CREATE:            'create_schedule',
  SCHEDULE_UPDATE:            'update_schedule',
  SCHEDULE_PAUSE:             'pause_schedule',
  SCHEDULE_RESUME:            'resume_schedule',
  SCHEDULE_PREVIEW:           'preview_next_runs',

  // ─── HTML Tools ───────────────────────────────────────────────────────────
  GEN_HTML: 'gen_html',

  // ─── Evose Gateway Tools ────────────────────────────────────────────────
  EVOSE_RUN_AGENT:    'evose_run_agent',
  EVOSE_RUN_WORKFLOW: 'evose_run_workflow',
  EVOSE_LIST_APPS:    'evose_list_apps',

  // ─── Interaction Tools ─────────────────────────────────────────────────────
  ASK_USER_QUESTION: 'ask_user_question',
} as const

export type NativeCapabilityToolName = (typeof NativeCapabilityTools)[keyof typeof NativeCapabilityTools]
