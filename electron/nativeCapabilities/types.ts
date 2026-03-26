// SPDX-License-Identifier: Apache-2.0

/**
 * NativeCapabilities — OpenCow's built-in tool provider framework.
 *
 * NativeCapabilities vs Capabilities:
 * - NativeCapabilities = OpenCow's **internal** tool providers (Browser, Issues, Projects, Artifacts)
 *                        Compiled-in, registered programmatically.
 * - Capabilities       = Claude Code **ecosystem** items (commands, skills, hooks, MCP servers)
 *                        Managed by CapabilityCenter, discovered from the filesystem.
 *
 * Each NativeCapability exposes a set of MCP tools that are injected into the SDK session
 * via an in-process MCP server (zero extra processes).
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod/v4'

// ─── Re-exports ─────────────────────────────────────────────────────────

/** Re-export the real CallToolResult from the MCP SDK for use in tool handlers. */
export type { CallToolResult }

// ─── Tool Descriptor ────────────────────────────────────────────────────

/**
 * Engine-agnostic tool descriptor used by NativeCapabilities.
 *
 * This is the canonical domain model for built-in tools. Engine-specific
 * adapters (Claude/Codex) are responsible for translating this descriptor
 * to runtime-specific tool definitions.
 */
export interface NativeToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, z.ZodType>
  execute: (input: NativeToolCallInput) => Promise<CallToolResult>
}

export interface NativeToolExecutionContext {
  /** Cooperative cancellation signal for timeout/abort propagation. */
  readonly signal?: AbortSignal
  /** Epoch timestamp in ms after which the call should be considered expired. */
  readonly deadlineAt?: number
  /** Engine runtime that issued this tool call. */
  readonly engine?: 'claude' | 'codex'
  /**
   * Stable tool-use identifier emitted by the engine runtime when available.
   * Preferred key for projection/relay binding because it is unique per invocation.
   */
  readonly toolUseId?: string
  /**
   * Invocation identifier for runtimes that expose a separate request/call id.
   * Falls back to toolUseId when both refer to the same underlying call.
   */
  readonly invocationId?: string
}

/**
 * Structured invocation payload passed into NativeToolDescriptor.execute().
 *
 * Keeping invocation metadata in a structured object avoids growing positional
 * parameters as execution controls evolve (timeout/cancellation/tracing).
 */
export interface NativeToolCallInput {
  readonly args: Record<string, unknown>
  readonly context: NativeToolExecutionContext
}

// ─── Category ────────────────────────────────────────────────────────────

/**
 * Authoritative native capability categories.
 *
 * This is intentionally a closed set so category typos are caught at compile time.
 * Adding a new built-in native capability requires updating this constant.
 */
export const NATIVE_CAPABILITY_CATEGORIES = [
  'browser',
  'issues',
  'projects',
  'html',
  'interaction',
  'schedules',
  'evose',
  'repo-analyzer',
] as const

export type NativeCapabilityCategory = (typeof NATIVE_CAPABILITY_CATEGORIES)[number]

const NATIVE_CAPABILITY_CATEGORY_SET: ReadonlySet<string> = new Set(NATIVE_CAPABILITY_CATEGORIES)

export function isNativeCapabilityCategory(value: string): value is NativeCapabilityCategory {
  return NATIVE_CAPABILITY_CATEGORY_SET.has(value)
}

// ─── Meta ────────────────────────────────────────────────────────────────

export interface NativeCapabilityMeta {
  /** Unique category key */
  category: NativeCapabilityCategory
  /** Human-readable name shown in UI / logs */
  name: string
  /** One-line description of what this native capability does */
  description: string
  /** Semantic version for future compatibility tracking */
  version: string
}

// ─── Session Context ─────────────────────────────────────────────────────

/**
 * Session-scoped domain context available to all native capability tools.
 *
 * Structured as a dedicated interface (not flat fields on NativeCapabilityToolContext)
 * to maintain separation between domain context (session) and infrastructure
 * concerns (relay). New session-scoped fields are added here, not on the parent.
 */
export interface NativeCapabilitySessionContext {
  /** The OpenCow session ID (ccb-XXXXXXXXXXXX) that owns these tools. */
  readonly sessionId: string
  /** Resolved Project ID, or null if session is not scoped to a project. */
  readonly projectId: string | null
  /**
   * The `source` field from the session's `SessionOrigin`.
   *
   * Capabilities use this to self-adapt based on the client environment.
   * For example, InteractionNativeCapability suppresses interactive-card
   * tools when the session originates from an IM platform that cannot
   * render them.
   */
  readonly originSource: string
}

// ─── Tool Context ────────────────────────────────────────────────────────

/**
 * Contextual information injected into each NativeCapability when building
 * tools for a specific session.
 *
 * - `session` — domain context (identity, scoping)
 * - `relay`   — infrastructure (progress routing)
 *
 * Passing session identity at tool-creation time (rather than at invocation
 * time) lets each native capability produce closures that are bound to the
 * owning session — enabling per-session resource isolation (e.g. a dedicated
 * WebContentsView per session in BrowserNativeCapability).
 */
export interface NativeCapabilityToolContext {
  /** Structured session context — domain-level identity and scoping. */
  readonly session: NativeCapabilitySessionContext
  /**
   * Per-session ToolProgressRelay instance.
   * NativeCapability tools use this to emit progress chunks instead of the old global singleton.
   * This enables multi-session progress isolation — chunks never leak across sessions.
   */
  readonly relay: import('../utils/toolProgressRelay').ToolProgressRelay
  /**
   * Names of external MCP servers that will be active in this session.
   *
   * Populated from the Capability Center injection plan before built-in tools
   * are created. NativeCapabilities use this to implement mutual exclusion — e.g.
   * BrowserNativeCapability suppresses overlapping tools when a browser-automation
   * MCP server (like `chrome-devtools`) is active.
   */
  readonly activeMcpServerNames?: ReadonlySet<string>
}

// ─── NativeCapability Interface ──────────────────────────────────────────

/**
 * Every built-in native capability implements this interface.
 *
 * getToolDescriptors() returns engine-agnostic tool descriptors.
 * NativeCapabilityRegistry aggregates descriptors from all capabilities and
 * adapts them at engine integration boundaries.
 */
export interface NativeCapability {
  /** Metadata describing this native capability */
  readonly meta: NativeCapabilityMeta

  /**
   * Returns engine-agnostic tool descriptors for this session.
   *
   * Accepting a `NativeCapabilityToolContext` at the factory level (rather than
   * reading session identity at invocation time) ensures that each tool closure
   * captures the correct session identity and resources.
   */
  getToolDescriptors(context: NativeCapabilityToolContext): NativeToolDescriptor[]

  /**
   * Optional async initialisation (e.g. warm caches, open connections).
   * Called by NativeCapabilityRegistry.startAll().
   */
  start?(): Promise<void>

  /**
   * Optional cleanup on shutdown.
   * Called by NativeCapabilityRegistry.disposeAll().
   */
  dispose?(): Promise<void>
}
