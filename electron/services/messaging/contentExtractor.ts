// SPDX-License-Identifier: Apache-2.0

/**
 * Shared content extraction utilities for IM message formatters.
 *
 * These functions extract meaningful text from ManagedSessionMessage.content
 * (ContentBlock[]) in a type-safe manner, eliminating duplicated logic across
 * platform formatters.
 */

import type { ContentBlock } from '../../../src/shared/types'

// ── Text extraction ───────────────────────────────────────────────────────

/**
 * Extract readable text from a ContentBlock array.
 *
 * - TextBlock → verbatim text
 * - ToolUseBlock → optional inline marker (configurable format)
 * - Other block types → skipped
 *
 * @param blocks   The content blocks from a ManagedSessionMessage.
 * @param toolUseFormat  Optional function to format tool_use blocks.
 *                       Receives the tool name, returns the inline string.
 *                       Defaults to `\n**Using: <name>**\n`.
 */
export function extractTextFromBlocks(
  blocks: ContentBlock[],
  toolUseFormat?: (toolName: string) => string,
): string {
  const fmt = toolUseFormat ?? ((name: string) => `\n**Using: ${name}**\n`)
  const parts: string[] = []

  for (const block of blocks) {
    if (!('type' in block)) continue

    if (block.type === 'text') {
      parts.push(block.text)
    } else if (block.type === 'tool_use') {
      parts.push(fmt(block.name))
    }
  }

  return parts.join('')
}

// ── Evose progress extraction ─────────────────────────────────────────────

/** Structured representation of an Evose Agent's sub-tool activity. */
export interface EvoseActivityInfo {
  /** The top-level agent tool name (e.g. "evose_run_agent") */
  agentName: string
  /** Sub-tool calls within the agent run */
  tools: Array<{
    name: string
    status: 'running' | 'completed' | 'error'
  }>
}

/**
 * Extract structured Evose Agent activity from content blocks.
 *
 * Walks the blocks looking for a ToolUseBlock that has `progressBlocks`
 * (indicating an Evose Agent relay call), then extracts each sub-tool call's
 * name and status.
 *
 * Returns `null` if no Evose progress is found.
 */
export function extractEvoseActivity(blocks: ContentBlock[]): EvoseActivityInfo | null {
  for (const block of blocks) {
    if (!('type' in block) || block.type !== 'tool_use') continue
    if (!block.progressBlocks?.length) continue

    const tools: EvoseActivityInfo['tools'] = []
    for (const pb of block.progressBlocks) {
      if (pb.type === 'tool_call') {
        tools.push({ name: pb.title || pb.toolName, status: pb.status })
      }
    }

    if (tools.length > 0) {
      return { agentName: block.name, tools }
    }
  }

  return null
}

/**
 * Format Evose activity into a human-readable string.
 *
 * Each platform can customise the icons/prefixes via the options parameter.
 * Defaults to a plain-text format suitable for most platforms.
 *
 * @param blocks  The content blocks to scan.
 * @param opts    Formatting options:
 *   - `agentPrefix`  — prefix for the header line (default: `"Agent: "`)
 *   - `agentSuffix`  — suffix for the header line (default: `""`)
 *   - `runningIcon`  — icon for in-progress tools (default: `"..."`)
 *   - `completedIcon` — icon for completed tools (default: `"done"`)
 *   - `errorIcon`    — icon for errored tools (default: `"err"`)
 */
export function formatEvoseActivity(
  blocks: ContentBlock[],
  opts?: {
    agentPrefix?: string
    agentSuffix?: string
    runningIcon?: string
    completedIcon?: string
    errorIcon?: string
  },
): string | null {
  const info = extractEvoseActivity(blocks)
  if (!info) return null

  const prefix = opts?.agentPrefix ?? 'Agent: '
  const suffix = opts?.agentSuffix ?? ''
  const icons = {
    running: opts?.runningIcon ?? '...',
    completed: opts?.completedIcon ?? 'done',
    error: opts?.errorIcon ?? 'err',
  }

  const lines = [`${prefix}${info.agentName}${suffix}`]
  for (const tool of info.tools) {
    lines.push(`  ${icons[tool.status]} ${tool.name}`)
  }
  return lines.join('\n')
}
