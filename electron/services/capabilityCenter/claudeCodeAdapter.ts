// SPDX-License-Identifier: Apache-2.0

/**
 * ClaudeCodeAdapter — translates a CapabilityPlan into Claude Agent SDK format.
 *
 * This is the single concrete InjectionAdapter implementation (YAGNI: no
 * GenericPromptAdapter). It converts SDK-agnostic CapabilityPlan output
 * into Claude-specific types (HookCallbackMatcher, SDKHookEventName).
 *
 * Key design decision: translate() does NOT merge — it returns a typed
 * output that the caller (SessionOrchestrator) merges into session options.
 * This separation of concerns makes the adapter testable in isolation.
 *
 * mergeHooks() is a static utility that lives here (not in hookCallbackAdapter)
 * because hook merging is SDK-specific logic — CapabilityCenter's public API
 * should remain SDK-agnostic.
 */

import type { HookCallbackMatcher, HookEvent as SDKHookEventName } from '@anthropic-ai/claude-agent-sdk'
import type { CapabilityPlan, McpServerConfig } from './sessionInjector'
import { adaptDeclarativeHooks } from './hookCallbackAdapter'
import { createLogger } from '../../platform/logger'

const log = createLogger('ClaudeCodeAdapter')

// ─── SDK Hook Types ──────────────────────────────────────────────────────

/** SDK hook map type — used by both translate() output and mergeHooks() */
export type SDKHookMap = Partial<Record<SDKHookEventName, HookCallbackMatcher[]>>

// ─── Output Types ────────────────────────────────────────────────────────

/**
 * SDK-ready output from ClaudeCodeAdapter.translate().
 *
 * Contains everything the SessionOrchestrator needs to merge into
 * Claude Agent SDK session options — strongly typed, no ambiguity.
 */
export interface ClaudeAdapterOutput {
  /** Claude SDK hook callbacks, keyed by SDK event name */
  hooks: SDKHookMap
  /** Cleanup function for hook signal listeners — call on session end */
  hookCleanup: () => void
  /** MCP server configs ready for SDK options.mcpServers */
  mcpServers: Record<string, McpServerConfig>
  /** Set of external MCP server names — used for mutual exclusion in NativeCapabilities */
  activeMcpServerNames: ReadonlySet<string>
}

// ─── Adapter Interface ──────────────────────────────────────────────────

/**
 * InjectionAdapter — strategy interface for translating CapabilityPlan
 * to a target SDK format.
 *
 * Currently only ClaudeCodeAdapter exists (YAGNI). The interface is
 * defined here for documentation and future extensibility, not for
 * premature abstraction.
 */
export interface InjectionAdapter<T = ClaudeAdapterOutput> {
  readonly id: string
  translate(plan: CapabilityPlan): T
}

// ─── ClaudeCodeAdapter ──────────────────────────────────────────────────

export class ClaudeCodeAdapter implements InjectionAdapter<ClaudeAdapterOutput> {
  readonly id = 'claude-code'

  /**
   * Translate a CapabilityPlan into Claude Agent SDK format.
   *
   * Converts:
   * - declarativeHooks → SDK HookCallbackMatcher[] (via adaptDeclarativeHooks)
   * - mcpServers → passed through (already compatible)
   * - Computes activeMcpServerNames from mcpServers keys
   */
  translate(plan: CapabilityPlan): ClaudeAdapterOutput {
    // Adapt declarative hooks to SDK format
    const adapted = adaptDeclarativeHooks(plan.declarativeHooks)

    // Compute active MCP server names for mutual exclusion
    const mcpServerNames = Object.keys(plan.mcpServers)
    const activeMcpServerNames: ReadonlySet<string> = mcpServerNames.length > 0
      ? new Set(mcpServerNames)
      : new Set()

    log.debug(
      `Translated plan: ${Object.keys(adapted.hooks).length} hook events, ` +
      `${mcpServerNames.length} MCP servers`,
    )

    return {
      hooks: adapted.hooks,
      hookCleanup: adapted.cleanup,
      mcpServers: plan.mcpServers,
      activeMcpServerNames,
    }
  }

  /**
   * Merge two SDK hook maps (e.g. built-in + capability hooks) into one.
   * Same event name → concat matcher arrays.
   *
   * This is SDK-specific logic — lives on the adapter, not on CapabilityCenter.
   */
  static mergeHooks(
    builtIn: SDKHookMap,
    capabilityHooks: SDKHookMap,
  ): SDKHookMap {
    const merged: SDKHookMap = { ...builtIn }

    for (const [event, matchers] of Object.entries(capabilityHooks)) {
      const eventKey = event as SDKHookEventName
      const existing = merged[eventKey] ?? []
      merged[eventKey] = [...existing, ...(matchers ?? [])]
    }

    return merged
  }
}
