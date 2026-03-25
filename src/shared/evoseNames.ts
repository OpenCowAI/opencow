// SPDX-License-Identifier: Apache-2.0

/**
 * evoseNames — Single Source of Truth for the Evose tool naming protocol.
 *
 * Referenced by both the main process (evoseCapability, sessionOrchestrator)
 * and the renderer (ToolUseBlockView).
 * Contains only pure functions with no side effects and no external dependencies.
 */

import { MCP_SERVER_QUALIFIED_NAME } from './appIdentity'

export type EvoseAppType = 'agent' | 'workflow'

/** Local gateway tool names (without MCP prefix). */
export const EVOSE_RUN_AGENT_LOCAL_NAME = 'evose_run_agent' as const
export const EVOSE_RUN_WORKFLOW_LOCAL_NAME = 'evose_run_workflow' as const
export const EVOSE_LIST_APPS_LOCAL_NAME = 'evose_list_apps' as const

export type EvoseGatewayLocalName =
  | typeof EVOSE_RUN_AGENT_LOCAL_NAME
  | typeof EVOSE_RUN_WORKFLOW_LOCAL_NAME
  | typeof EVOSE_LIST_APPS_LOCAL_NAME

const EVOSE_GATEWAY_LOCAL_NAMES: ReadonlySet<EvoseGatewayLocalName> = new Set([
  EVOSE_RUN_AGENT_LOCAL_NAME,
  EVOSE_RUN_WORKFLOW_LOCAL_NAME,
  EVOSE_LIST_APPS_LOCAL_NAME,
])

/**
 * OpenCow MCP server fully-qualified name.
 * Used to precisely identify and extract Evose tools from a full MCP block.name.
 * Sourced from MCP_SERVER_QUALIFIED_NAME in appIdentity.ts to ensure compile-time consistency.
 */
export const OPENCOW_MCP_SERVER = MCP_SERVER_QUALIFIED_NAME
const OPENCOW_MCP_PREFIX = `${OPENCOW_MCP_SERVER}__`

/** Sanitize app.name into a valid MCP tool name segment ([a-z0-9_]+, max 40 chars) */
export function sanitizeEvoseAppName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')     // spaces and hyphens → underscore
    .replace(/[^a-z0-9_]/g, '')  // remove remaining non-alphanumeric
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
}

function isEvoseGatewayLocalName(localName: string): localName is EvoseGatewayLocalName {
  return EVOSE_GATEWAY_LOCAL_NAMES.has(localName as EvoseGatewayLocalName)
}

/**
 * Determine whether a tool name belongs to an Evose gateway tool.
 *
 * Accepted forms:
 * - Fully-qualified MCP name: `mcp__opencow-capabilities__evose_run_agent`
 * - Local name: `evose_run_agent`
 *
 * Dynamic per-app tool names are intentionally unsupported.
 */
export function isEvoseToolName(blockName: string): boolean {
  return isEvoseGatewayLocalName(extractEvoseLocalName(blockName))
}

/** True when the tool is a static Evose gateway tool (run/list). */
export function isEvoseGatewayToolName(blockName: string): boolean {
  return isEvoseToolName(blockName)
}

/**
 * Extract the local name from a fully-qualified MCP name.
 * 'mcp__opencow-capabilities__evose_run_agent' → 'evose_run_agent'
 */
export function extractEvoseLocalName(blockName: string): string {
  return blockName.startsWith(OPENCOW_MCP_PREFIX) ? blockName.slice(OPENCOW_MCP_PREFIX.length) : blockName
}

// ─── Relay Key ────────────────────────────────────────────────────────────────

/**
 * Single Source of Truth for Evose relay key derivation.
 *
 * Both the **registration** side (evoseRelay.ts — projection layer) and the
 * **emission** side (evoseNativeCapability.ts — MCP tool handler) MUST use
 * this function so they converge on the same key.
 *
 * Why a deterministic key instead of `tool_use_id`:
 * The MCP `tools/call` protocol does not carry the Claude API `tool_use_id`.
 * The SDK's in-process MCP server handler receives `(args, extra)` where
 * `extra` comes from the MCP SDK's `RequestHandlerExtra` — it never includes
 * `tool_use_id`.  Because the relay bridges the Claude API layer (which has
 * `tool_use_id`) and the MCP tool layer (which does not), the key must be
 * derivable from data available on BOTH sides: `toolName` + `appId`.
 */
export function deriveEvoseRelayKey(toolName: string, appId: string): string {
  const local = extractEvoseLocalName(toolName)
  const trimmed = appId.trim()
  return trimmed ? `${local}:${trimmed}` : local
}

// ─── Structured App Info ──────────────────────────────────────────────────────

/**
 * Renderer-only: returns structured display info for an Evose app (name + avatar URL + type).
 * The name does not contain emoji; the avatar should be rendered by the caller.
 */
export interface EvoseAppInfo {
  /** Plain-text display name, e.g. "Customer Support" (no emoji) */
  displayName: string
  /** App avatar URL (from the API), may be undefined */
  avatar?: string
  /** App type */
  appType: EvoseAppType | 'catalog'
}

export function resolveEvoseAppInfo(
  blockName: string,
  apps: readonly { name: string; type: EvoseAppType; enabled: boolean; avatar?: string; appId?: string }[],
  input?: Record<string, unknown>,
): EvoseAppInfo | null {
  if (!isEvoseToolName(blockName)) return null
  const localName = extractEvoseLocalName(blockName)

  if (localName === EVOSE_LIST_APPS_LOCAL_NAME) {
    return {
      displayName: 'Evose Apps',
      appType: 'catalog',
    }
  }

  const appType: EvoseAppType = localName === EVOSE_RUN_AGENT_LOCAL_NAME ? 'agent' : 'workflow'
  const appId = typeof input?.['app_id'] === 'string' ? input['app_id'].trim() : ''
  const matched = appId
    ? apps.find((app) => app.type === appType && app.enabled && app.appId === appId)
    : undefined
  const fallbackName = appType === 'agent' ? 'Evose Agent' : 'Evose Workflow'

  return {
    displayName: matched?.name ?? (appId ? `${fallbackName} (${appId})` : fallbackName),
    avatar: matched?.avatar,
    appType,
  }
}
