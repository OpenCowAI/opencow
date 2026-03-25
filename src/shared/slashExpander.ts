// SPDX-License-Identifier: Apache-2.0

import { extractBody } from './frontmatter'

// Re-export types and utilities from editorSegments for backward compat.
// Consumers should prefer importing directly from '@shared/editorSegments'.
export type { EditorSegment } from './editorSegments'
export {
  extractSegmentsFromJson as extractSegmentsFromTipTapJson,
  richContentHasSlashMentions,
  parseSlashMentionSegments,
} from './editorSegments'

// ─── Local imports ──────────────────────────────────────────────────────────

import type { EditorSegment } from './editorSegments'
import type { SlashCommandExecutionContract } from './types'
import { compactSlashExecutionContract } from './slashExecution'

// ─── Flat expansion ─────────────────────────────────────────────────────────

export interface ExpandResult {
  text: string
  /** Whether any slash command/skill was expanded */
  expanded: boolean
}

/**
 * Expand slash command / skill mentions by reading their .md source files.
 *
 * - `builtin` mentions are kept as `/<name>` (handled by SDK)
 * - `command` / `skill` mentions with a `sourcePath` are expanded to their .md body
 * - Missing sourcePath or read errors fall back to `/<name>`
 */
export async function expandSlashSegments(
  segments: EditorSegment[],
  readSource: (sourcePath: string) => Promise<string>
): Promise<ExpandResult> {
  let expanded = false
  const parts: string[] = []

  for (const seg of segments) {
    if (seg.type === 'text') {
      parts.push(seg.text)
      continue
    }

    // fileMention — render as @name (already handled by caller; this is a fallback)
    if (seg.type === 'fileMention') {
      parts.push(`@${seg.name}`)
      continue
    }

    // slashMention
    if (seg.category === 'builtin' || !seg.sourcePath) {
      parts.push(`/${seg.name}`)
      continue
    }

    // command or skill with sourcePath → expand
    try {
      const raw = await readSource(seg.sourcePath)
      const body = extractBody(raw).trim()
      if (body) {
        parts.push(body)
        expanded = true
      } else {
        // Source file has no body content — keep as raw command
        parts.push(`/${seg.name}`)
      }
    } catch (err) {
      console.error(`[slashExpander] Failed to read source for /${seg.name}:`, err)
      parts.push(`/${seg.name}`)
    }
  }

  return { text: parts.join(''), expanded }
}

// ─── Structured resolution ──────────────────────────────────────────────────

export type ResolvedBlock =
  | { type: 'text'; text: string }
  | {
      type: 'slash_command'
      name: string
      category: 'command' | 'skill'
      /**
       * Frozen display label captured at send-time.
       * Keeps message rendering stable even if capability metadata changes later.
       */
      label: string
      execution?: SlashCommandExecutionContract
      expandedText: string
    }

export interface ResolveResult {
  blocks: ResolvedBlock[]
  hasSlashCommands: boolean
}

/**
 * Resolve slash command / skill mentions into structured blocks.
 *
 * Unlike `expandSlashSegments` which produces flat text, this returns
 * an array of typed blocks preserving command identity for UI rendering.
 *
 * - `text` segment → `{ type: 'text', text }`
 * - `builtin` or no sourcePath → `{ type: 'text', text: '/<name>' }`
 * - `command`/`skill` + sourcePath → `{ type: 'slash_command', name, category, label, expandedText }`
 *   (falls back to text if body is empty or read fails)
 * - Adjacent text blocks are merged
 */
export async function resolveSlashSegments(
  segments: EditorSegment[],
  readSource: (sourcePath: string) => Promise<string>
): Promise<ResolveResult> {
  let hasSlashCommands = false
  const raw: ResolvedBlock[] = []

  for (const seg of segments) {
    if (seg.type === 'text') {
      raw.push({ type: 'text', text: seg.text })
      continue
    }

    // fileMention — render as @name (already handled by caller; this is a fallback)
    if (seg.type === 'fileMention') {
      raw.push({ type: 'text', text: `@${seg.name}` })
      continue
    }

    // slashMention
    if (seg.category === 'builtin' || !seg.sourcePath) {
      raw.push({ type: 'text', text: `/${seg.name}` })
      continue
    }

    // command or skill with sourcePath → try to expand
    try {
      const content = await readSource(seg.sourcePath)
      const body = extractBody(content).trim()
      if (body) {
        const normalizedExecution = compactSlashExecutionContract(seg.executionContract)
        raw.push({
          type: 'slash_command',
          name: seg.name,
          category: seg.category as 'command' | 'skill',
          label: seg.label?.trim() || seg.name,
          ...(normalizedExecution ? { execution: normalizedExecution } : {}),
          expandedText: body,
        })
        hasSlashCommands = true
      } else {
        raw.push({ type: 'text', text: `/${seg.name}` })
      }
    } catch (err) {
      console.error(`[slashExpander] Failed to read source for /${seg.name}:`, err)
      raw.push({ type: 'text', text: `/${seg.name}` })
    }
  }

  // Merge adjacent text blocks
  const blocks: ResolvedBlock[] = []
  for (const block of raw) {
    const prev = blocks.length > 0 ? blocks[blocks.length - 1] : null
    if (block.type === 'text' && prev?.type === 'text') {
      prev.text += block.text
    } else {
      blocks.push(block)
    }
  }

  return { blocks, hasSlashCommands }
}
