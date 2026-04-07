// SPDX-License-Identifier: Apache-2.0

/**
 * parseBrowserResult — Type-safe parsers for browser tool JSON results.
 *
 * Each parser takes the raw `tool_result.content` string and returns a typed
 * data object.  Throws on parse failure so `createResultCardRenderer` can
 * fall through to the raw-text path.
 */

// ─── Navigate ───────────────────────────────────────────────────────────────

export interface BrowserNavigateResult {
  url: string
  title: string
  status: string
}

export function parseBrowserNavigate(raw: string): BrowserNavigateResult {
  const data = JSON.parse(raw)
  if (typeof data.url !== 'string' || typeof data.status !== 'string') {
    throw new Error('Invalid navigate result')
  }
  return { url: data.url, title: data.title ?? '', status: data.status }
}

// ─── Action status (click, type, scroll, wait) ─────────────────────────────

export interface BrowserActionResult {
  /** 'OK' for void actions, or a descriptive string */
  status: 'ok'
}

/**
 * Click/type/scroll/wait all return `"OK"` for success.
 * This parser normalises that to a typed object.
 */
export function parseBrowserAction(raw: string): BrowserActionResult {
  const trimmed = raw.trim()
  if (trimmed === 'OK' || trimmed === '"OK"') {
    return { status: 'ok' }
  }
  // Some actions may return JSON — try parsing
  try {
    const data = JSON.parse(trimmed)
    if (data && typeof data === 'object') return { status: 'ok' }
  } catch { /* fall through */ }
  // Accept any non-error content as success
  return { status: 'ok' }
}

// ─── Upload ────────────────────────────────────────────────────────────────

export interface BrowserUploadResult {
  uploaded: number
  target: string
  files: string[]
  mode: string
}

export function parseBrowserUpload(raw: string): BrowserUploadResult {
  const data = JSON.parse(raw)
  if (!data || typeof data !== 'object') throw new Error('Invalid upload result')

  const uploaded = (data as { uploaded?: unknown }).uploaded
  const target = (data as { target?: unknown }).target
  const files = (data as { files?: unknown }).files
  const mode = (data as { mode?: unknown }).mode

  if (
    typeof uploaded !== 'number' ||
    typeof target !== 'string' ||
    !Array.isArray(files) ||
    !files.every((f) => typeof f === 'string')
  ) {
    throw new Error('Invalid upload result')
  }

  return {
    uploaded,
    target,
    files,
    mode: typeof mode === 'string' ? mode : 'setFileInputFiles',
  }
}

// ─── Extract ────────────────────────────────────────────────────────────────

export interface BrowserExtractResult {
  /** Page title (extract-page only) */
  title: string
  /** Page URL (extract-page only) */
  url: string
  /** Total character count of extracted text */
  charCount: number
  /** Full extracted text content */
  fullText: string
}

/**
 * Extract results come in two flavours:
 * 1. extract-page: JSON object `{ title, url, text, links }`
 * 2. extract-text: JSON-stringified string `"the text content"` or raw text
 */
export function parseBrowserExtract(raw: string): BrowserExtractResult {
  const trimmed = raw.trim()

  // Try JSON object (extract-page)
  try {
    const data = JSON.parse(trimmed)
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const text = typeof data.text === 'string' ? data.text : ''
      return {
        title: typeof data.title === 'string' ? data.title : '',
        url: typeof data.url === 'string' ? data.url : '',
        charCount: text.length,
        fullText: text,
      }
    }
    // JSON-stringified string (extract-text with selector)
    if (typeof data === 'string') {
      return { title: '', url: '', charCount: data.length, fullText: data }
    }
  } catch { /* not valid JSON — treat as raw text */ }

  // Fallback: treat the whole content as raw text
  return { title: '', url: '', charCount: trimmed.length, fullText: trimmed }
}

// ─── Snapshot / Ref-Click / Ref-Type ────────────────────────────────────────

export interface BrowserSnapshotResult {
  title: string
  url: string
  refCount: number
  /** Optional action prefix like "Clicked [e3]." or "Typed into [e5]." */
  actionPrefix: string
}

/**
 * Snapshot results are plain text with a structured header:
 *
 * ```
 * [Clicked [e3]. Updated snapshot:]
 *
 * Page: Example Page
 * URL: https://example.com
 * Refs: 42 elements
 *
 * [accessibility tree...]
 * ```
 *
 * We extract the header metadata and discard the tree (not for human display).
 */
export function parseBrowserSnapshot(raw: string): BrowserSnapshotResult {
  const lines = raw.split('\n')
  let title = ''
  let url = ''
  let refCount = 0
  let actionPrefix = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('Page: ')) {
      title = trimmed.slice(6)
    } else if (trimmed.startsWith('URL: ')) {
      url = trimmed.slice(5)
    } else if (trimmed.startsWith('Refs: ')) {
      const match = trimmed.match(/Refs:\s*(\d+)/)
      if (match) refCount = parseInt(match[1], 10)
    } else if (trimmed.startsWith('Clicked [') || trimmed.startsWith('Typed into [')) {
      actionPrefix = trimmed.replace(/\s*Updated snapshot:?\s*$/, '')
    }
  }

  if (refCount === 0 && title === '' && url === '') {
    throw new Error('Not a snapshot result')
  }

  return { title, url, refCount, actionPrefix }
}

// ─── Screenshot (fallback for when image stays in tool_result content) ────

export interface BrowserScreenshotResult {
  /** Base64-encoded image data */
  imageData: string
  /** MIME type (e.g. 'image/png') */
  mediaType: string
}

/**
 * Fallback parser for browser_screenshot results.
 *
 * Normally `extractMediaFromToolResult` extracts the image as a standalone
 * ImageBlock, and ContentBlockRenderer renders it via BrowserScreenshotCard.
 *
 * This parser handles the edge case where the image data remains serialised
 * as JSON in `tool_result.content` — e.g. when the MCP format wasn't
 * recognised by the media extractor.
 *
 * Supports two shapes:
 *   - Single object: `{ type: 'image', data: '...', mimeType: '...' }`
 *   - Array: `[{ type: 'image', data: '...', mimeType: '...' }]`
 */
export function parseBrowserScreenshot(raw: string): BrowserScreenshotResult {
  if (!raw.trim()) throw new Error('Empty screenshot result')

  try {
    const data = JSON.parse(raw.trim())

    // Single object: { type: 'image', data: '...', mimeType: '...' }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (data.type === 'image' && typeof data.data === 'string') {
        return {
          imageData: data.data,
          mediaType: typeof data.mimeType === 'string' ? data.mimeType : 'image/png',
        }
      }
    }

    // Array: [{ type: 'image', ... }]
    if (Array.isArray(data)) {
      const img = data.find(
        (item: Record<string, unknown>) => item.type === 'image' && typeof item.data === 'string'
      )
      if (img) {
        return {
          imageData: img.data as string,
          mediaType: typeof img.mimeType === 'string' ? img.mimeType : 'image/png',
        }
      }
    }
  } catch { /* not valid JSON */ }

  throw new Error('Not a screenshot result')
}
