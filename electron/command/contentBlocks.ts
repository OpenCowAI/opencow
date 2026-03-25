// SPDX-License-Identifier: Apache-2.0

import type { ContentBlock, DocumentMediaType, ImageMediaType } from '../../src/shared/types'

/**
 * SDK content block shape (loosely typed — the SDK doesn't export strict types).
 */
export interface SDKContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  progress?: string
  tool_use_id?: string
  content?: string | ToolResultContentItem[]
  is_error?: boolean
  thinking?: string
  // Image / Document support
  source?: {
    type: string
    media_type?: string
    data?: string
  }
  title?: string
}

/**
 * Shape of a single item in tool_result.content arrays.
 *
 * Covers both Claude API format (source wrapper) and MCP native format (data + mimeType).
 * This replaces ad-hoc inline types and `as unknown as` escape hatches.
 */
interface ToolResultContentItem {
  type: string
  text?: string
  /** Claude API format: { type: 'base64', media_type, data } */
  source?: { type?: string; media_type?: string; data?: string }
  /** MCP native format — raw base64 image data */
  data?: string
  /** MCP native format — MIME type (e.g. 'image/png') */
  mimeType?: string
  /** Document title */
  title?: string
}

/**
 * Extract text from tool_result content which can be a string,
 * an array of ToolResultContentItem, or undefined.
 * Images and documents are intentionally skipped here — they are extracted as
 * standalone blocks by normalizeContentBlocks so they render with dedicated UI.
 */
export function normalizeToolResultContent(
  content: string | ToolResultContentItem[] | undefined
): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((c) => {
      if (c.type === 'text') return c.text ?? ''
      // Images / documents are extracted as standalone blocks — omit placeholder text
      return ''
    })
    .filter(Boolean)
    .join('')
}

/**
 * Extract any embedded media blocks (image / document) from tool_result content items.
 *
 * When `toolUseId` is provided, extracted ImageBlocks carry it as provenance —
 * enabling context-aware rendering (e.g. BrowserScreenshotCard) without the
 * consumer needing to inspect neighbouring blocks.
 *
 * @param content  Raw tool_result.content (string or array of items)
 * @param toolUseId  The originating tool_use ID for provenance stamping
 * @returns Array of ContentBlock (may be empty)
 */
function extractMediaFromToolResult(
  content: string | ToolResultContentItem[] | undefined,
  toolUseId?: string,
): ContentBlock[] {
  if (!Array.isArray(content)) return []
  const blocks: ContentBlock[] = []
  for (const c of content) {
    if (c.type === 'image') {
      // Path 1: Claude API format — { source: { type: 'base64', media_type, data } }
      if (c.source?.type === 'base64' && c.source.media_type && c.source.data) {
        blocks.push({
          type: 'image',
          mediaType: c.source.media_type as ImageMediaType,
          data: c.source.data,
          sizeBytes: Math.ceil((c.source.data.length * 3) / 4),
          ...(toolUseId ? { toolUseId } : {}),
        })
        continue
      }
      // Path 2: MCP native CallToolResult format — { data, mimeType }
      // Used by browser_screenshot and other native capabilities that return
      // images directly in MCP format without the Claude API `source` wrapper.
      if (typeof c.data === 'string' && typeof c.mimeType === 'string') {
        blocks.push({
          type: 'image',
          mediaType: c.mimeType as ImageMediaType,
          data: c.data,
          sizeBytes: Math.ceil((c.data.length * 3) / 4),
          ...(toolUseId ? { toolUseId } : {}),
        })
      }
    } else if (c.type === 'document') {
      if (c.source && c.source.data) {
        const isText = c.source.type === 'text' || c.source.media_type === 'text/plain'
        blocks.push({
          type: 'document',
          mediaType: (c.source.media_type ?? (isText ? 'text/plain' : 'application/pdf')) as DocumentMediaType,
          data: c.source.data,
          sizeBytes: isText ? new TextEncoder().encode(c.source.data).length : Math.ceil((c.source.data.length * 3) / 4),
          title: c.title ?? 'document',
        })
      }
    }
  }
  return blocks
}

/**
 * Lossless transformation from SDK content blocks to our ContentBlock union.
 * Unknown block types are dropped (logged in dev).
 *
 * For tool_result blocks that contain image/document content (e.g. browser_screenshot),
 * the media blocks are extracted as standalone ImageBlock/DocumentBlock appended right
 * after the ToolResultBlock so they render with the normal dedicated UI.
 */
export function normalizeContentBlocks(sdkBlocks: SDKContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = []

  for (const b of sdkBlocks) {
    switch (b.type) {
      case 'text':
        if (b.text) result.push({ type: 'text', text: b.text })
        break
      case 'tool_use':
        if (b.id && b.name)
          result.push({
            type: 'tool_use',
            id: b.id,
            name: b.name,
            input: b.input ?? {},
            ...(typeof b.progress === 'string' ? { progress: b.progress } : {}),
          })
        break
      case 'tool_result':
        if (b.tool_use_id) {
          result.push({
            type: 'tool_result',
            toolUseId: b.tool_use_id,
            content: normalizeToolResultContent(b.content),
            isError: b.is_error,
          })
          // Append any media blocks embedded in the tool result (e.g. browser_screenshot PNG).
          // Passes toolUseId so extracted ImageBlocks carry provenance for context-aware rendering.
          result.push(...extractMediaFromToolResult(b.content, b.tool_use_id))
        }
        break
      case 'image':
        if (b.source?.type === 'base64' && b.source.media_type && b.source.data) {
          result.push({
            type: 'image',
            mediaType: b.source.media_type as ImageMediaType,
            data: b.source.data,
            sizeBytes: Math.ceil((b.source.data.length * 3) / 4),
          })
        }
        break
      case 'document': {
        const src = b.source
        if (src && src.data) {
          const isText = src.type === 'text' || src.media_type === 'text/plain'
          result.push({
            type: 'document',
            mediaType: (src.media_type ?? (isText ? 'text/plain' : 'application/pdf')) as DocumentMediaType,
            data: src.data,
            sizeBytes: isText ? Buffer.byteLength(src.data, 'utf8') : Math.ceil((src.data.length * 3) / 4),
            title: b.title ?? 'document',
          })
        }
        break
      }
      case 'thinking':
        if (b.thinking) result.push({ type: 'thinking', thinking: b.thinking })
        break
    }
  }

  return result
}

/**
 * Reorder blocks so that all `thinking` blocks come before non-thinking blocks
 * while preserving the relative order within each group.
 *
 * Intended for use by engine adapters whose SDK may emit thinking blocks after
 * text blocks during streaming (e.g. Claude SDK with extended thinking).
 * This is NOT called inside normalizeContentBlocks — adapters opt-in explicitly.
 */
export function ensureThinkingBlocksFirst(blocks: ContentBlock[]): ContentBlock[] {
  // Fast path: if the first non-thinking block appears after all thinking blocks,
  // the order is already correct — avoid allocating a new array.
  let lastThinkingIndex = -1
  let firstNonThinkingIndex = -1
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === 'thinking') {
      lastThinkingIndex = i
    } else if (firstNonThinkingIndex === -1) {
      firstNonThinkingIndex = i
    }
  }
  // No thinking blocks, or all thinking blocks already precede non-thinking ones.
  if (lastThinkingIndex === -1 || firstNonThinkingIndex === -1 || lastThinkingIndex < firstNonThinkingIndex) {
    return blocks
  }

  const thinking: ContentBlock[] = []
  const rest: ContentBlock[] = []
  for (const b of blocks) {
    if (b.type === 'thinking') {
      thinking.push(b)
    } else {
      rest.push(b)
    }
  }
  return [...thinking, ...rest]
}
