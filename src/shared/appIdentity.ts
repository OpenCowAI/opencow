// SPDX-License-Identifier: Apache-2.0

/**
 * OpenCow Application Identity — Single Source of Truth.
 *
 * Contains all brand and protocol identifiers used across files and processes.
 * When rebranding in the future, only this file needs to be updated.
 */

// ─── Brand Identity ──────────────────────────────────────────────────────────

/** User-facing product name (macOS menu bar, window title, logs) */
export const APP_NAME = 'OpenCow' as const

/** Application version, injected from package.json at build time via Vite define */
declare const __APP_VERSION__: string
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'

/** Filesystem-safe name (used for the ~/.opencow data directory) */
export const APP_FS_NAME = 'opencow' as const

/** Short brand description used in the identity system prompt */
export const APP_DESCRIPTION = 'an AI-powered assistant' as const

// ─── External Protocol Contract (MCP) ────────────────────────────────────────

/**
 * MCP Server base registration name (passed to SDK createSdkMcpServer({ name })).
 * The SDK automatically prepends the `mcp__` prefix, producing `mcp__opencow-capabilities__<tool>`.
 */
export const MCP_SERVER_BASE_NAME = 'opencow-capabilities' as const

/**
 * MCP Server fully-qualified name (used by the renderer to identify tools).
 * The `satisfies` constraint enforces at compile time that it starts with `mcp__`.
 */
export const MCP_SERVER_QUALIFIED_NAME =
  `mcp__${MCP_SERVER_BASE_NAME}` as const satisfies `mcp__${string}`

// ─── Cross-Process API Contract ──────────────────────────────────────────────

/** IPC DataBus event channel name (must be consistent across preload / types / channels) */
export const IPC_EVENT_CHANNEL = 'opencow:event' as const

/**
 * Key name for contextBridge.exposeInMainWorld().
 *
 * ⚠ The property name in env.d.ts `interface Window { opencow: OpenCowAPI }`
 *   MUST match this literal value (TypeScript interfaces do not support computed
 *   property names — this is a known trade-off).
 */
export const APP_WINDOW_KEY = 'opencow' as const

// ─── Claude Code Integration Contract ────────────────────────────────────────

/**
 * Marker key written into ~/.claude/settings.json Hook entries.
 * Used to distinguish hooks managed by this application from user-defined hooks.
 *
 * Imported by the following three modules to ensure compile-time consistency:
 *   - electron/services/hooksInstaller.ts
 *   - electron/services/capabilityWriteService.ts
 *   - electron/services/capabilities/scanners/hookScanner.ts
 */
export const HOOK_MARKER_KEY = '__opencow__' as const

// ─── Development Environment ─────────────────────────────────────────────────

/** Environment variable to override dev/prod detection: OPENCOW_ENV=production pnpm preview */
export const APP_ENV_VAR = 'OPENCOW_ENV' as const
