// SPDX-License-Identifier: Apache-2.0

/**
 * codeFenceScanner — Generic code-fence extraction engine.
 *
 * A line-scanning state machine that correctly handles nested code fences
 * within the body content. Returns the **last** matched block (most recent
 * revision) so iterative AI refinement is handled naturally.
 *
 * This is the shared foundation extracted from `capabilityOutputParser`.
 * Consumers (capabilityOutputParser, issueOutputParser, etc.) call this
 * scanner and then apply their own domain-specific field mapping.
 *
 * @module
 */

import { parseFrontmatter } from './frontmatter'
import type { ManagedSessionMessage } from './types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScannedFencedBlock {
  /** Captured fence tag (e.g. 'skill-output', 'issue-output') */
  tag: string
  /** YAML frontmatter attributes parsed into a key-value record */
  attributes: Record<string, unknown>
  /** Markdown body content after frontmatter */
  body: string
  /** Raw content (frontmatter + body) for verbatim saving */
  raw: string
  /**
   * `true` when the block was extracted from an **unclosed** code fence.
   * This typically indicates the AI output was truncated (e.g. token limit).
   * Consumers should treat such blocks as potentially incomplete.
   */
  partial?: boolean
}

export interface ScanOptions {
  /**
   * When `true`, if no properly closed fence is found but an open fence
   * exists, return its accumulated content marked as `partial: true`.
   * Useful for showing in-progress or truncated AI output.
   * @default false
   */
  allowUnclosed?: boolean
}

// ─── Pre-built regex ─────────────────────────────────────────────────────────

/**
 * Closing fence pattern — exactly 3 backticks on their own line.
 */
const BARE_CLOSE_RE = /^```\s*$/

/**
 * Detects the start of any inner code fence (3+ backticks with optional lang).
 */
const INNER_OPEN_RE = /^```[^`]*$/

// ─── Regex cache ─────────────────────────────────────────────────────────────

const openReCache = new Map<string, RegExp>()

/**
 * Build (and cache) a regex that matches the opening fence for the given tags.
 *
 * - Single tag: /^```issue-output\s*$/
 * - Multiple tags: /^```(skill-output|agent-output|...)\s*$/
 */
function getOpenRegex(tags: readonly string[]): RegExp {
  const key = tags.join('|')
  let re = openReCache.get(key)
  if (!re) {
    const escaped = tags.map((t) => t.replace(/-/g, '\\-'))
    const pattern = tags.length === 1
      ? `^\`\`\`${escaped[0]}\\s*$`
      : `^\`\`\`(${escaped.join('|')})\\s*$`
    re = new RegExp(pattern)
    openReCache.set(key, re)
  }
  return re
}

// ─── Core scanner ────────────────────────────────────────────────────────────

/**
 * Scan text for the **last** fenced block matching any of the given tags.
 *
 * Uses a line-scanning state machine to correctly handle nested code fences.
 * Returns `null` if no matching block is found.
 *
 * When `options.allowUnclosed` is `true`, falls back to returning content from
 * an in-progress (unclosed) fence — marked with `partial: true`. This is useful
 * for showing AI output that was truncated mid-generation.
 *
 * @param text - Full text to scan (may contain multiple fenced blocks)
 * @param tags - One or more fence tags to match (e.g. `['issue-output']`)
 * @param options - Optional scan options
 */
export function scanLastFencedBlock(
  text: string,
  tags: readonly string[],
  options?: ScanOptions
): ScannedFencedBlock | null {
  if (tags.length === 0) return null

  const openRe = getOpenRegex(tags)
  const lines = text.split('\n')

  let inFence = false
  let innerFenceDepth = 0
  let fenceLines: string[] = []
  let lastClosedContent: string | null = null
  let lastClosedTag: string | null = null
  /** Tag of the most recently opened fence (may still be open at end of scan). */
  let openTag: string | null = null

  for (const line of lines) {
    if (!inFence) {
      const match = openRe.exec(line)
      if (match) {
        inFence = true
        innerFenceDepth = 0
        fenceLines = []
        // For single-tag mode, match[1] may be undefined — use the tag directly
        openTag = match[1] ?? tags[0]
      }
    } else {
      if (innerFenceDepth > 0) {
        if (BARE_CLOSE_RE.test(line)) {
          innerFenceDepth--
        }
        fenceLines.push(line)
      } else if (BARE_CLOSE_RE.test(line)) {
        // Fence properly closed — save as the latest complete block
        lastClosedContent = fenceLines.join('\n')
        lastClosedTag = openTag
        inFence = false
        openTag = null
      } else {
        if (INNER_OPEN_RE.test(line) && !openRe.test(line)) {
          innerFenceDepth++
        }
        fenceLines.push(line)
      }
    }
  }

  // Prefer a properly closed fence
  if (lastClosedContent != null && lastClosedTag) {
    const raw = lastClosedContent.trim()
    const { attributes, body } = parseFrontmatter(raw)
    return { tag: lastClosedTag, attributes, body: body.trim(), raw }
  }

  // Fallback: return partial content from an unclosed fence if allowed.
  // This handles truncated AI output (e.g. token limit) where the closing
  // ``` was never emitted.
  if (options?.allowUnclosed && inFence && openTag && fenceLines.length > 0) {
    const raw = fenceLines.join('\n').trim()
    if (!raw) return null
    const { attributes, body } = parseFrontmatter(raw)
    return { tag: openTag, attributes, body: body.trim(), raw, partial: true }
  }

  return null
}

// ─── Message-level scanner ──────────────────────────────────────────────────

/**
 * Scan session messages in reverse order and extract the most recent
 * fenced block from assistant messages.
 *
 * @param messages - Session messages (searched newest-first)
 * @param tags - One or more fence tags to match
 * @param options - Optional scan options (e.g. allowUnclosed)
 */
export function scanLastFencedBlockFromMessages(
  messages: ManagedSessionMessage[],
  tags: readonly string[],
  options?: ScanOptions
): ScannedFencedBlock | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue

    const text = msg.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('\n')

    const result = scanLastFencedBlock(text, tags, options)
    if (result) return result
  }

  return null
}
