// SPDX-License-Identifier: Apache-2.0

/**
 * Context-files parsing — shared utility for extracting structured file
 * references from the `<context-files>` text block embedded in user messages.
 *
 * The `<context-files>` block is a serialisation format created by
 * `useMessageComposer` when the user @-mentions files/directories.  It is
 * embedded at the start of the first text content block and intended to be
 * consumed by the LLM.  UI renderers must parse it back into structured data
 * for visual display (file chips).
 *
 * This module centralises the parsing logic so that every consumer of
 * `UserMessageContent` (SessionMessageList, QueuedMessageList, etc.) can
 * decode and render context files consistently.
 */

import type { UserMessageContent } from '@shared/types'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ParsedContextFile {
  isDirectory: boolean
  path: string
}

export interface ParsedContextFilesResult {
  files: ParsedContextFile[]
  rest: string
}

/* ------------------------------------------------------------------ */
/*  Parsing                                                            */
/* ------------------------------------------------------------------ */

/**
 * Regex to match the `<context-files>` block at the beginning of a text string.
 *
 * Format:
 * ```
 * <context-files>
 * - [file] src/components/App.tsx
 * - [dir] src/utils
 * </context-files>
 *
 * ```
 */
const CONTEXT_FILES_RE = /^<context-files>\n([\s\S]*?)\n<\/context-files>\n\n/

/**
 * Parse a `<context-files>` block from the beginning of a text string.
 *
 * Returns the extracted file entries and the remaining text with the
 * block stripped.  If no block is found, returns an empty array and
 * the original text unchanged.
 */
export function parseContextFiles(text: string): ParsedContextFilesResult {
  const match = text.match(CONTEXT_FILES_RE)
  if (!match) return { files: [], rest: text }

  const lines = match[1].split('\n')
  const files: ParsedContextFile[] = []
  for (const line of lines) {
    const m = line.match(/^- \[(dir|file)\] (.+)$/)
    if (m) files.push({ isDirectory: m[1] === 'dir', path: m[2] })
  }
  return { files, rest: text.slice(match[0].length) }
}

/**
 * Extract context files from `UserMessageContent`.
 *
 * Scans all text blocks in the content and extracts any `<context-files>`
 * block found at the start of the first text block.  Returns the parsed
 * files and a cleaned preview string with the block stripped.
 */
export function extractContextFilesFromContent(
  content: UserMessageContent,
): { files: ParsedContextFile[]; cleanedTextParts: string[] } {
  if (typeof content === 'string') {
    const { files, rest } = parseContextFiles(content)
    return { files, cleanedTextParts: rest.trim() ? [rest] : [] }
  }

  const files: ParsedContextFile[] = []
  const cleanedTextParts: string[] = []
  let parsed = false

  for (const block of content) {
    if (block.type === 'text') {
      // Only parse the first text block — that's where the context-files block lives
      if (!parsed) {
        parsed = true
        const { files: parsedFiles, rest } = parseContextFiles(block.text)
        files.push(...parsedFiles)
        if (rest.trim()) cleanedTextParts.push(rest)
      } else {
        if (block.text.trim()) cleanedTextParts.push(block.text)
      }
    }
  }

  return { files, cleanedTextParts }
}

/* ------------------------------------------------------------------ */
/*  Serialisation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Serialise parsed context files back into the `<context-files>` text block.
 *
 * This is the inverse of `parseContextFiles` — it reconstructs the text
 * format that `useMessageComposer` originally creates.  Used when
 * re-assembling edited content that had context files extracted for display.
 *
 * Returns an empty string if the files array is empty.
 */
export function serializeContextFiles(files: ParsedContextFile[]): string {
  if (files.length === 0) return ''

  const lines = files.map(
    (f) => `- [${f.isDirectory ? 'dir' : 'file'}] ${f.path}`,
  )
  return `<context-files>\n${lines.join('\n')}\n</context-files>\n\n`
}
