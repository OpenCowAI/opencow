// SPDX-License-Identifier: Apache-2.0

/**
 * ToolLifecycleContext — tool_use ID → tool name lookup.
 *
 * Bridges the gap between ToolUseBlock (assistant message) and
 * ToolResultBlock (user message) by providing a unified name lookup.
 *
 * Usage:
 *   - SessionMessageList calls `buildToolLifecycleMap(messages)` in a useMemo
 *   - Wraps its render tree with `<ToolLifecycleProvider value={map}>`
 *   - ToolResultBlockView calls `useToolLifecycle(toolUseId)` to resolve name
 *     for routing to the correct ResultCard or Widget suppression check.
 */

import { createContext, useContext } from 'react'
import type { ManagedSessionMessage } from '@shared/types'

// ─── Types ──────────────────────────────────────────────────────────────────

/** Lifecycle info for a single tool invocation. */
export interface ToolLifecycle {
  /** Raw MCP-prefixed tool name (e.g. mcp__opencow-capabilities__create_issue) */
  readonly name: string
}

export type ToolLifecycleMap = ReadonlyMap<string, ToolLifecycle>

// ─── Context ────────────────────────────────────────────────────────────────

const EMPTY_MAP: ToolLifecycleMap = new Map()

const ToolLifecycleCtx = createContext<ToolLifecycleMap>(EMPTY_MAP)

export const ToolLifecycleProvider = ToolLifecycleCtx.Provider

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Resolve the lifecycle info for a given toolUseId.
 * Returns `undefined` when the id cannot be matched (graceful degradation).
 */
export function useToolLifecycle(toolUseId: string): ToolLifecycle | undefined {
  return useContext(ToolLifecycleCtx).get(toolUseId)
}

/**
 * Access the full lifecycle map (needed when a component must look up
 * tool names for multiple blocks — e.g. ContentBlockRenderer detecting
 * screenshot ImageBlocks by checking the preceding tool_result).
 */
export function useToolLifecycleMap(): ToolLifecycleMap {
  return useContext(ToolLifecycleCtx)
}

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Scan all messages and build a toolUseId → ToolLifecycle lookup map.
 *
 * Scans assistant messages for tool_use blocks to extract tool names.
 * O(n) linear scan — called inside a `useMemo` keyed on `messages`.
 */
export function buildToolLifecycleMap(messages: readonly ManagedSessionMessage[]): ToolLifecycleMap {
  const map = new Map<string, ToolLifecycle>()

  for (const msg of messages) {
    // System messages have `event` instead of `content` — skip them.
    if (msg.role === 'system') continue
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        map.set(block.id, { name: block.name })
      }
    }
  }

  return map
}
