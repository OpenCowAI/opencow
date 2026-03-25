// SPDX-License-Identifier: Apache-2.0

/**
 * Editor segment types and utilities for working with TipTap document
 * content — both from live ProseMirror documents and from serialized JSON.
 *
 * This module is the **single source of truth** for:
 * - `EditorSegment` — the canonical segment discriminated union
 * - `mergeSegments()` — merge adjacent text segments + trim whitespace
 * - `extractSegmentsFromJson()` — extract segments from stored TipTap JSON
 * - `richContentHasSlashMentions()` — fast boolean content query
 * - `parseSlashMentionSegments()` — parse + return segments (avoids double-parse)
 *
 * Consumers:
 * - `renderer/lib/extractEditorSegments.ts` — live editor → segments
 * - `shared/slashExpander.ts` — segments → expanded/resolved content
 * - `NotesView.tsx` — stored JSON → segments for send-to-chat resolution
 */

import type { SlashItemCategory } from './slashItems'
import type { SlashCommandExecutionContract } from './types'
import { compactSlashExecutionContract } from './slashExecution'

// ─── Segment type ───────────────────────────────────────────────────────────

export type EditorSegment =
  | { type: 'text'; text: string }
  | {
      type: 'slashMention'
      name: string
      category: SlashItemCategory
      sourcePath?: string
      label?: string
      mentionId?: string
      executionContract?: SlashCommandExecutionContract
    }
  | { type: 'fileMention'; path: string; name: string; isDirectory: boolean }

// ─── TipTap JSON types (minimal subset for segment extraction) ──────────────

interface TipTapNode {
  type: string
  content?: TipTapNode[]
  text?: string
  attrs?: Record<string, unknown>
}

// ─── Merge + trim ───────────────────────────────────────────────────────────

/**
 * Merge adjacent text segments and trim overall leading/trailing whitespace.
 *
 * Used by both `extractEditorSegments` (live ProseMirror doc) and
 * `extractSegmentsFromJson` (stored TipTap JSON) to normalise raw segments.
 */
export function mergeSegments(segments: EditorSegment[]): EditorSegment[] {
  const merged: EditorSegment[] = []

  for (const seg of segments) {
    if (seg.type === 'text' && merged.length > 0) {
      const prev = merged[merged.length - 1]
      if (prev.type === 'text') {
        prev.text += seg.text
        continue
      }
    }
    merged.push({ ...seg })
  }

  // Trim leading whitespace
  if (merged.length > 0 && merged[0].type === 'text') {
    merged[0].text = merged[0].text.replace(/^\s+/, '')
    if (!merged[0].text) merged.shift()
  }

  // Trim trailing whitespace
  if (merged.length > 0 && merged[merged.length - 1].type === 'text') {
    const last = merged[merged.length - 1] as { type: 'text'; text: string }
    last.text = last.text.replace(/\s+$/, '')
    if (!last.text) merged.pop()
  }

  return merged
}

// ─── Extract from TipTap JSON ───────────────────────────────────────────────

/**
 * Walk a TipTap document JSON tree and produce an ordered array of
 * `EditorSegment`s — the same format returned by `extractEditorSegments`
 * but without needing a live TipTap Editor instance.
 *
 * Used to extract segments from stored `richContent` (note persistence)
 * so that slash commands can be resolved on send-to-chat.
 */
export function extractSegmentsFromJson(json: unknown): EditorSegment[] {
  const doc = json as TipTapNode
  if (!doc || doc.type !== 'doc' || !doc.content) return []

  const raw: EditorSegment[] = []

  for (let blockIdx = 0; blockIdx < doc.content.length; blockIdx++) {
    const block = doc.content[blockIdx]

    // Paragraph separator
    if (blockIdx > 0) {
      raw.push({ type: 'text', text: '\n' })
    }

    if (!block.content) continue

    for (const inline of block.content) {
      if (inline.type === 'slashMention' && inline.attrs) {
        const rawLabel = inline.attrs.label
        const label = typeof rawLabel === 'string' ? rawLabel.trim() : ''
        const rawMentionId = inline.attrs.mentionId
        const mentionId = typeof rawMentionId === 'string' ? rawMentionId.trim() : ''
        const rawExecutionContract = inline.attrs.executionContract
        const executionContract =
          rawExecutionContract && typeof rawExecutionContract === 'object'
            ? compactSlashExecutionContract(rawExecutionContract as SlashCommandExecutionContract)
            : undefined
        raw.push({
          type: 'slashMention',
          name: inline.attrs.name as string,
          category: inline.attrs.category as SlashItemCategory,
          sourcePath: (inline.attrs.sourcePath as string) || undefined,
          ...(label ? { label } : {}),
          ...(mentionId ? { mentionId } : {}),
          ...(executionContract ? { executionContract } : {}),
        })
      } else if (inline.type === 'fileMention' && inline.attrs) {
        raw.push({
          type: 'fileMention',
          path: inline.attrs.path as string,
          name: inline.attrs.name as string,
          isDirectory: inline.attrs.isDirectory as boolean,
        })
      } else if (inline.text) {
        raw.push({ type: 'text', text: inline.text })
      }
    }
  }

  return mergeSegments(raw)
}

// ─── Content query ──────────────────────────────────────────────────────────

/**
 * Parse a richContent JSON string and return its segments **if** the content
 * contains at least one slashMention node; otherwise return `null`.
 *
 * Performs a fast `string.includes` check before JSON parsing for performance.
 * Callers that need the segments for further processing (e.g. slash command
 * resolution) should use this instead of the boolean `richContentHasSlashMentions`
 * to avoid double-parsing the same JSON.
 */
export function parseSlashMentionSegments(richContent: string | null | undefined): EditorSegment[] | null {
  if (!richContent) return null
  // Fast path: check if the string even contains slashMention
  if (!richContent.includes('slashMention')) return null
  try {
    const segments = extractSegmentsFromJson(JSON.parse(richContent))
    return segments.some((s) => s.type === 'slashMention') ? segments : null
  } catch {
    return null
  }
}

/**
 * Check whether a richContent JSON string contains any slashMention nodes.
 * Convenience wrapper over `parseSlashMentionSegments` for call-sites that
 * only need a boolean (e.g. UI badge display). Prefer `parseSlashMentionSegments`
 * when the segments will be used afterwards to avoid double-parsing.
 */
export function richContentHasSlashMentions(richContent: string | null | undefined): boolean {
  return parseSlashMentionSegments(richContent) !== null
}
