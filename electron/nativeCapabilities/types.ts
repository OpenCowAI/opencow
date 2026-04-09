// SPDX-License-Identifier: Apache-2.0

/**
 * NativeCapabilities — OpenCow's built-in tool provider framework.
 *
 * Phase 1B.11 migration: this file used to host 208 lines of OpenCow-private
 * type definitions (NativeCapability, NativeCapabilityMeta,
 * NativeCapabilitySessionContext, NativeToolDescriptor, NativeToolCallInput,
 * NATIVE_CAPABILITY_CATEGORIES, etc.). It is now a thin re-export layer that
 * aliases OpenCow's traditional names to the SDK Capability Provider
 * framework types, parameterised on `OpenCowSessionContext`.
 *
 * The OpenCow-specific session domain fields (projectId / issueId /
 * originSource / projectPath / startupCwd / relay) live on
 * `OpenCowSessionContext` (./openCowSessionContext.ts), which extends the
 * SDK's base `SessionContext`. The SDK framework's generic
 * `<TSessionCtx extends SessionContext>` is the extension point.
 *
 * Why aliases instead of direct SDK imports in capability subclasses:
 *   - Keeps the existing `import type { NativeCapabilityToolContext } from
 *     './types'` path stable across the 8 capability files (single line
 *     import in each, no rename churn).
 *   - The 8 capability subclasses' diff is then limited to: the meta strip
 *     (drop `name` and `version` from the meta literal — required by the
 *     SDK CapabilityMeta v2 shape), the `toolConfigs` → `nativeToolConfigs`
 *     rename (one line per file), and field path adjustments
 *     (`context.session` → `ctx.sessionContext` etc.).
 *
 * NATIVE_CAPABILITY_CATEGORIES / NativeCapabilityCategory /
 * isNativeCapabilityCategory live in
 * `./openCowCapabilityRegistry.ts` instead of here, because they
 * conceptually belong to the registry (and that's where the SDK
 * CapabilityRegistry consumes them via its `categories` constructor option).
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import type {
  CapabilityMeta,
  CapabilityProvider,
  CapabilityToolContext,
  ToolDescriptor,
} from '@opencow-ai/opencow-agent-sdk'

import type { OpenCowSessionContext } from './openCowSessionContext'

// ─── Re-exports ─────────────────────────────────────────────────────────

/** Re-export the real CallToolResult from the MCP SDK for use in tool handlers. */
export type { CallToolResult }

// ─── Capability primitive aliases ──────────────────────────────────────

/**
 * OpenCow's name for the SDK `CapabilityMeta`. Note: SDK v2 stripped `name`
 * and `version` from the meta shape — only `category` and `description`
 * remain. The 8 capability subclasses must drop those two fields from
 * their meta literals as part of the Phase 1B.11 migration.
 */
export type NativeCapabilityMeta = CapabilityMeta

/**
 * OpenCow's name for the SDK `ToolDescriptor`, parameterised on
 * `OpenCowSessionContext`. This is what `BaseNativeCapability.getToolDescriptors`
 * returns and what `OpenCowCapabilityRegistry.getDescriptorsForSession`
 * exposes to the Codex bridge.
 */
export type NativeToolDescriptor = ToolDescriptor<OpenCowSessionContext>

/**
 * OpenCow's name for the SDK `CapabilityProvider`, parameterised on
 * `OpenCowSessionContext`. The 8 capability subclasses do not implement this
 * interface directly — they `extends BaseNativeCapability`, which itself
 * implements `CapabilityProvider<OpenCowSessionContext>` via the SDK's
 * `BaseCapabilityProvider`.
 */
export type NativeCapability = CapabilityProvider<OpenCowSessionContext>

/**
 * OpenCow's name for the SDK `CapabilityToolContext<OpenCowSessionContext>`.
 *
 * Field migration from the pre-1B.11 shape:
 *   `{ session, relay, activeMcpServerNames? }`
 *     → `{ sessionContext, hostEnvironment }`
 *
 * Subclasses must adjust their field accesses accordingly:
 *   `context.session.projectId`        → `ctx.sessionContext.projectId`
 *   `context.relay.emit(...)`          → `ctx.sessionContext.relay.emit(...)`
 *   `context.activeMcpServerNames?.has(name)`
 *     → `ctx.hostEnvironment.activeMcpServerNames.includes(name)`
 *
 * Note: `relay` lives on `OpenCowSessionContext` (not `HostEnvironment`)
 * per spike 3 finding — it is OpenCow-internal infrastructure with a single
 * consumer (Evose). See ./openCowSessionContext.ts for the rationale.
 */
export type NativeCapabilityToolContext = CapabilityToolContext<OpenCowSessionContext>

// ─── Backwards-compat alias for legacy import paths ────────────────────

/**
 * Pre-1B.11 OpenCow defined a separate `NativeCapabilitySessionContext`
 * type with the 5 domain fields. Post-1B.11 those fields live on
 * `OpenCowSessionContext`. This alias preserves the legacy import name so
 * subclasses that imported `NativeCapabilitySessionContext` continue to
 * compile without renaming.
 */
export type NativeCapabilitySessionContext = OpenCowSessionContext

// ─── Category re-exports (live in openCowCapabilityRegistry) ───────────

export {
  isNativeCapabilityCategory,
  NATIVE_CAPABILITY_CATEGORIES,
  type NativeCapabilityCategory,
} from './openCowCapabilityRegistry'
