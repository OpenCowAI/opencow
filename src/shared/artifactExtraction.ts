// SPDX-License-Identifier: Apache-2.0

/**
 * Shared artifact extraction logic — used by both renderer and main process.
 *
 * Scans session messages for tool_use blocks and text content, producing
 * ExtractedArtifact records ready for persistence or display.
 *
 * Design:
 * - ArtifactExtractor interface enables per-kind extraction strategies
 * - fileArtifactExtractor: Write/Edit tool_use → file artifacts
 * - diagramArtifactExtractor: ```mermaid fenced blocks in text → diagram artifacts
 */

import type { ManagedSessionMessage, ArtifactKind } from './types'
import { mimeTypeFromExtension, extractExtension } from './mimeTypes'
import { NativeCapabilityTools } from './nativeCapabilityToolNames'
import { parseGenHtmlInput } from './genHtmlInput'

// ─── Types ──────────────────────────────────────────────────────────────────

/** Extraction output — carries content for persistence, shared between layers */
export interface ExtractedArtifact {
  kind: ArtifactKind
  title: string                  // Human-readable title (fileName for files)
  mimeType: string               // Content MIME type
  filePath: string | null        // Only for 'file' kind
  fileExtension: string | null   // Only for 'file' kind (with leading dot)
  lastModifiedAt: number
  content: string | null         // Full content from latest Write (null if edit-only)
  contentHash: string            // SHA-256 hex, computed at extraction time
  stats: { writes: number; edits: number }
}

/** Per-kind extraction strategy */
export interface ArtifactExtractor {
  readonly kind: ArtifactKind
  extract(messages: ManagedSessionMessage[]): ExtractedArtifact[]
}

// ─── Hash ───────────────────────────────────────────────────────────────────

/**
 * Lightweight string hash for deduplication.
 * Uses djb2 algorithm — not cryptographic, but fast and sufficient for
 * content-change detection. Returns hex string.
 *
 * NOTE: This intentionally operates on UTF-16 code units (charCodeAt) rather
 * than grapheme clusters or code points. This is fine for hashing because
 * consistency matters more than Unicode correctness — identical strings always
 * produce the same hash regardless of surrogate pair boundaries.
 */
export function hashContent(content: string): string {
  let hash = 5381
  for (let i = 0; i < content.length; i++) {
     
    hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0
  }
  // Convert to unsigned 32-bit hex
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ─── File Artifact Extractor ────────────────────────────────────────────────

const WRITE_TOOLS = new Set(['Write'])
const EDIT_TOOLS = new Set(['Edit'])

interface FileAccumulator {
  filePath: string
  fileName: string
  fileExtension: string
  mimeType: string
  lastModifiedAt: number
  content: string | null
  writes: number
  edits: number
}

/**
 * File artifact extractor — scans Write/Edit tool_use blocks.
 * Supports ALL file types (not just .md).
 * Deduplicates by filePath (case-sensitive), keeps latest content from most recent Write.
 */
export const fileArtifactExtractor: ArtifactExtractor = {
  kind: 'file',

  extract(messages: ManagedSessionMessage[]): ExtractedArtifact[] {
    const map = new Map<string, FileAccumulator>()

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue

      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue

        const isWrite = WRITE_TOOLS.has(block.name)
        const isEdit = EDIT_TOOLS.has(block.name)
        if (!isWrite && !isEdit) continue

        const filePath = block.input.file_path
        if (typeof filePath !== 'string' || filePath.length === 0) continue

        const existing = map.get(filePath)
        const fileName = filePath.split('/').pop() ?? filePath
        const fileExtension = extractExtension(filePath)
        const mimeType = fileExtension ? mimeTypeFromExtension(fileExtension) : 'text/plain'

        if (isWrite) {
          const content = block.input.content != null
            ? String(block.input.content)
            : (existing?.content ?? null)

          map.set(filePath, {
            filePath,
            fileName,
            fileExtension,
            mimeType,
            lastModifiedAt: msg.timestamp,
            content,
            writes: (existing?.writes ?? 0) + 1,
            edits: existing?.edits ?? 0,
          })
        } else {
          // Edit — update timestamp & count, preserve last Write content
          map.set(filePath, {
            filePath,
            fileName,
            fileExtension,
            mimeType: existing?.mimeType ?? mimeType,
            lastModifiedAt: msg.timestamp,
            content: existing?.content ?? null,
            writes: existing?.writes ?? 0,
            edits: (existing?.edits ?? 0) + 1,
          })
        }
      }
    }

    return Array.from(map.values())
      .map((acc): ExtractedArtifact => ({
        kind: 'file',
        title: acc.fileName,
        mimeType: acc.mimeType,
        filePath: acc.filePath,
        fileExtension: acc.fileExtension || null,
        lastModifiedAt: acc.lastModifiedAt,
        content: acc.content,
        contentHash: acc.content ? hashContent(acc.content) : hashContent(acc.filePath),
        stats: { writes: acc.writes, edits: acc.edits },
      }))
      .sort((a, b) => b.lastModifiedAt - a.lastModifiedAt)
  },
}

// ─── Diagram Artifact Extractor ─────────────────────────────────────────────

/**
 * Regex to match fenced ```mermaid code blocks in Markdown text.
 * Captures the content between the fences (group 1).
 */
const MERMAID_FENCE_RE = /```mermaid\s*\n([\s\S]*?)```/g

/** Map first Mermaid keyword to a human-readable diagram type name. */
const DIAGRAM_TYPE_NAMES: Record<string, string> = {
  flowchart: 'Flowchart',
  graph: 'Flowchart',
  sequencediagram: 'Sequence Diagram',
  classdiagram: 'Class Diagram',
  statediagram: 'State Diagram',
  erdiagram: 'ER Diagram',
}

/** Derive a title from the first meaningful line of Mermaid source. */
function deriveDiagramTitle(code: string, index: number): string {
  const firstLine = code.split('\n')[0]?.trim().toLowerCase().replace(/[-\s]/g, '') ?? ''
  for (const [keyword, name] of Object.entries(DIAGRAM_TYPE_NAMES)) {
    if (firstLine.startsWith(keyword)) return name
  }
  return `Diagram ${index + 1}`
}

/**
 * Diagram artifact extractor — scans assistant text blocks for
 * fenced ```mermaid code blocks.
 *
 * Deduplicates by content hash: identical diagrams across messages
 * are collapsed into a single artifact (timestamp updated to latest).
 */
export const diagramArtifactExtractor: ArtifactExtractor = {
  kind: 'diagram',

  extract(messages: ManagedSessionMessage[]): ExtractedArtifact[] {
    // Map<contentHash, artifact> for deduplication
    const map = new Map<string, ExtractedArtifact>()
    let globalIndex = 0

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue

      for (const block of msg.content) {
        if (block.type !== 'text') continue

        // Reset regex state for each text block
        MERMAID_FENCE_RE.lastIndex = 0
        let match: RegExpExecArray | null

        while ((match = MERMAID_FENCE_RE.exec(block.text)) !== null) {
          const code = match[1]!.trim()
          if (code.length === 0) continue

          const hash = hashContent(code)
          const existing = map.get(hash)

          if (existing) {
            // Same diagram seen again — update timestamp
            existing.lastModifiedAt = msg.timestamp
          } else {
            map.set(hash, {
              kind: 'diagram',
              title: deriveDiagramTitle(code, globalIndex),
              mimeType: 'text/x-mermaid',
              filePath: null,
              fileExtension: null,
              lastModifiedAt: msg.timestamp,
              content: code,
              contentHash: hash,
              stats: { writes: 0, edits: 0 },
            })
            globalIndex++
          }
        }
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.lastModifiedAt - a.lastModifiedAt)
  },
}

// ─── gen_html Artifact Extractor ────────────────────────────────────────────

/**
 * gen_html artifact extractor — scans gen_html tool_use blocks.
 *
 * gen_html content is in-memory (no file on disk), so filePath is null.
 * Deduplicates by content hash: identical HTML across messages → single artifact.
 */
export const genHtmlArtifactExtractor: ArtifactExtractor = {
  kind: 'file',

  extract(messages: ManagedSessionMessage[]): ExtractedArtifact[] {
    const map = new Map<string, ExtractedArtifact>()

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue

      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue
        if (block.name !== NativeCapabilityTools.GEN_HTML) continue

        const { title, html } = parseGenHtmlInput(block.input)
        if (!html) continue
        const hash = hashContent(html)
        const existing = map.get(hash)

        if (existing) {
          existing.lastModifiedAt = msg.timestamp
        } else {
          map.set(hash, {
            kind: 'file',
            title: `${title}.html`,
            mimeType: 'text/html',
            filePath: null,
            fileExtension: '.html',
            lastModifiedAt: msg.timestamp,
            content: html,
            contentHash: hash,
            stats: { writes: 1, edits: 0 },
          })
        }
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.lastModifiedAt - a.lastModifiedAt)
  },
}

// ─── Extractor Registry ─────────────────────────────────────────────────────

/** Registered extractors — runs in order, results merged. */
const EXTRACTORS: ArtifactExtractor[] = [
  fileArtifactExtractor,
  diagramArtifactExtractor,
  genHtmlArtifactExtractor,
]

/**
 * Combined extraction — runs all registered extractors.
 * @returns All extracted artifacts sorted by lastModifiedAt descending.
 */
export function extractAllArtifacts(messages: ManagedSessionMessage[]): ExtractedArtifact[] {
  return EXTRACTORS
    .flatMap((e) => e.extract(messages))
    .sort((a, b) => b.lastModifiedAt - a.lastModifiedAt)
}

// ─── Supported Artifact Filter ──────────────────────────────────────────────

/** File extensions that support rich preview rendering (beyond code view). */
const RICH_PREVIEW_EXTENSIONS = new Set(['.md', '.html', '.htm'])

/**
 * Predicate: is this artifact a currently-supported type?
 *
 * Supported types:
 * - `diagram` kind (Mermaid)
 * - `file` kind with rich-preview extensions (.md, .html, .htm)
 *
 * Used by BOTH the display layer (Artifacts Tab) and the persistence layer
 * (ArtifactService) to ensure strict alignment — only supported types are
 * shown and stored.
 */
export function isSupportedArtifact(a: ExtractedArtifact): boolean {
  return a.kind === 'diagram'
    || (a.fileExtension != null && RICH_PREVIEW_EXTENSIONS.has(a.fileExtension))
}

// ─── JSONL Extraction (Monitor Sessions) ─────────────────────────────────────

/**
 * Extract artifacts from raw JSONL lines (session transcript).
 * Used for Monitor Sessions where we don't have parsed ManagedSessionMessage[].
 *
 * Scans for assistant messages containing Write/Edit tool_use content blocks.
 */
export function extractArtifactsFromJsonl(lines: string[]): ExtractedArtifact[] {
  const map = new Map<string, FileAccumulator>()

  for (const line of lines) {
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    // Only process assistant messages
    const message = entry.message as { role?: string; content?: unknown[] } | undefined
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue

    const timestamp = entry.timestamp
      ? new Date(entry.timestamp as string).getTime()
      : Date.now()

    for (const block of message.content) {
      const b = block as Record<string, unknown>
      if (b.type !== 'tool_use') continue

      const name = b.name as string | undefined
      const input = b.input as Record<string, unknown> | undefined
      if (!name || !input) continue

      const isWrite = WRITE_TOOLS.has(name)
      const isEdit = EDIT_TOOLS.has(name)
      if (!isWrite && !isEdit) continue

      const filePath = input.file_path
      if (typeof filePath !== 'string' || filePath.length === 0) continue

      const existing = map.get(filePath)
      const fileName = filePath.split('/').pop() ?? filePath
      const fileExtension = extractExtension(filePath)
      const mimeType = fileExtension ? mimeTypeFromExtension(fileExtension) : 'text/plain'

      if (isWrite) {
        const content = input.content != null
          ? String(input.content)
          : (existing?.content ?? null)

        map.set(filePath, {
          filePath, fileName, fileExtension, mimeType,
          lastModifiedAt: timestamp,
          content,
          writes: (existing?.writes ?? 0) + 1,
          edits: existing?.edits ?? 0,
        })
      } else {
        map.set(filePath, {
          filePath, fileName, fileExtension,
          mimeType: existing?.mimeType ?? mimeType,
          lastModifiedAt: timestamp,
          content: existing?.content ?? null,
          writes: existing?.writes ?? 0,
          edits: (existing?.edits ?? 0) + 1,
        })
      }
    }
  }

  return Array.from(map.values())
    .map((acc): ExtractedArtifact => ({
      kind: 'file',
      title: acc.fileName,
      mimeType: acc.mimeType,
      filePath: acc.filePath,
      fileExtension: acc.fileExtension || null,
      lastModifiedAt: acc.lastModifiedAt,
      content: acc.content,
      contentHash: acc.content ? hashContent(acc.content) : hashContent(acc.filePath),
      stats: { writes: acc.writes, edits: acc.edits },
    }))
    .sort((a, b) => b.lastModifiedAt - a.lastModifiedAt)
}
