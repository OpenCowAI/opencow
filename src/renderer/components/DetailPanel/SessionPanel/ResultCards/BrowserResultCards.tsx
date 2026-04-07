// SPDX-License-Identifier: Apache-2.0

/**
 * BrowserResultCards — rich card renderers for browser native-capability tool results.
 *
 * ## Card types
 *
 * | Card                     | Tools                                  | Visual                                   |
 * |--------------------------|----------------------------------------|------------------------------------------|
 * | BrowserNavigateCard      | browser_navigate                       | ✓ hostname + title — minimal text        |
 * | BrowserActionStatusCard  | click / type / scroll / wait           | ✓ single-line status — inline text       |
 * | BrowserExtractCard       | browser_extract                        | CardShell + char count + collapsible     |
 * | BrowserSnapshotCard      | snapshot / ref_click / ref_type        | ✓ N elements scanned — compact summary   |
 * | BrowserScreenshotResultCard | browser_screenshot (fallback)       | Browser chrome + image preview           |
 *
 * All cards receive `{ data: T }` props via `createResultCardRenderer` in
 * ToolResultBlockView's RESULT_CARD_REGISTRY.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, FileText, ScanSearch, Upload } from 'lucide-react'
import { CardShell } from './CardShell'
import { BrowserScreenshotCard } from '../PreviewCards/BrowserScreenshotCard'
import type {
  BrowserNavigateResult,
  BrowserActionResult,
  BrowserExtractResult,
  BrowserUploadResult,
  BrowserSnapshotResult,
  BrowserScreenshotResult,
} from './parseBrowserResult'

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract hostname from a full URL for compact display. */
function hostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** Format a character count for human display. */
function formatCharCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M chars`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K chars`
  return `${n} chars`
}

// ─── Navigate ───────────────────────────────────────────────────────────────

interface BrowserNavigateCardProps {
  data: BrowserNavigateResult
}

/**
 * Compact navigate result — emerald checkmark + hostname + page title.
 *
 * ```
 * ✓ example.com
 *   Example Page Title
 * ```
 */
export function BrowserNavigateCard({ data }: BrowserNavigateCardProps): React.JSX.Element {
  const host = hostname(data.url)

  return (
    <div className="ml-4 mt-0.5 flex items-start gap-1.5">
      <Check
        className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500"
        strokeWidth={2.5}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <span className="text-xs font-medium text-[hsl(var(--foreground))]">
          {host}
        </span>
        {data.title && (
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate leading-tight mt-px">
            {data.title}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Action Status (click / type / scroll / wait) ───────────────────────────

interface BrowserActionStatusCardProps {
  data: BrowserActionResult
}

/**
 * Ultra-compact action confirmation — single-line emerald checkmark.
 *
 * Click/type/scroll/wait all return "OK"; the action semantics are already
 * visible in the tool-use pill above, so we just show a minimal checkmark.
 *
 * ```
 * ✓ Done
 * ```
 */
export function BrowserActionStatusCard({ data: _data }: BrowserActionStatusCardProps): React.JSX.Element {
  return (
    <div className="ml-4 mt-0.5 flex items-center gap-1.5">
      <Check
        className="w-3.5 h-3.5 shrink-0 text-emerald-500"
        strokeWidth={2.5}
        aria-hidden="true"
      />
      <span className="text-xs text-[hsl(var(--muted-foreground))]">
        Done
      </span>
    </div>
  )
}

// ─── Upload ───────────────────────────────────────────────────────────────

interface BrowserUploadStatusCardProps {
  data: BrowserUploadResult
}

export function BrowserUploadStatusCard({ data }: BrowserUploadStatusCardProps): React.JSX.Element {
  const { t } = useTranslation('sessions')

  return (
    <div className="ml-4 mt-0.5 flex items-start gap-1.5">
      <Upload
        className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500"
        strokeWidth={2.2}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <span className="text-xs font-medium text-[hsl(var(--foreground))]">
          {t('sessionPanel.browserUploadStatus', { count: data.uploaded })}
        </span>
        <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate leading-tight mt-px">
          {data.target}
        </p>
      </div>
    </div>
  )
}

// ─── Extract ────────────────────────────────────────────────────────────────

interface BrowserExtractCardProps {
  data: BrowserExtractResult
}

const EXTRACT_PREVIEW_LINES = 3
const EXTRACT_PREVIEW_CHARS = 300

/**
 * Extract result card — metadata header + collapsible content preview.
 *
 * ```
 * ┌──────────────────────────────────────┐
 * │ 📄 1,234 chars · example.com         │
 * │ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │
 * │   Welcome to Example. This is the    │
 * │   main content of the page...        │
 * │   ▸ Show full content (42 lines)     │
 * └──────────────────────────────────────┘
 * ```
 */
export function BrowserExtractCard({ data }: BrowserExtractCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const host = data.url ? hostname(data.url) : ''
  const totalLines = data.fullText.split('\n').length
  const isLong = data.fullText.length > EXTRACT_PREVIEW_CHARS || totalLines > EXTRACT_PREVIEW_LINES

  const previewText = isLong && !expanded
    ? data.fullText.split('\n').slice(0, EXTRACT_PREVIEW_LINES).join('\n').slice(0, EXTRACT_PREVIEW_CHARS)
    : data.fullText

  return (
    <CardShell maxWidth="md">
      {/* ── Metadata header ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 py-2">
        <FileText
          className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground)/0.5)]"
          aria-hidden="true"
        />
        <span className="text-xs text-[hsl(var(--muted-foreground))]">
          {formatCharCount(data.charCount)}
        </span>
        {host && (
          <>
            <span className="text-[hsl(var(--muted-foreground)/0.3)]">·</span>
            <span className="text-xs text-[hsl(var(--muted-foreground)/0.6)] truncate">
              {host}
            </span>
          </>
        )}
        {data.title && (
          <>
            <span className="text-[hsl(var(--muted-foreground)/0.3)]">·</span>
            <span className="text-xs text-[hsl(var(--muted-foreground)/0.6)] truncate">
              {data.title}
            </span>
          </>
        )}
      </div>

      {/* ── Content preview ─────────────────────────────────────────── */}
      {data.fullText && (
        <div className="border-t border-[hsl(var(--border)/0.3)]">
          <pre className="px-3 py-2 text-[11px] text-[hsl(var(--muted-foreground))] font-mono leading-relaxed whitespace-pre-wrap break-words overflow-x-auto max-h-64 overflow-y-auto">
            {previewText}
          </pre>

          {isLong && (
            <div className="px-3 pb-2">
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-[11px] text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm"
              >
                {expanded
                  ? 'Show less'
                  : `Show full content (${totalLines} lines)`}
              </button>
            </div>
          )}
        </div>
      )}
    </CardShell>
  )
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

interface BrowserSnapshotCardProps {
  data: BrowserSnapshotResult
}

/**
 * Compact snapshot summary — ref count + optional action prefix.
 *
 * The full accessibility tree is for Claude, not for humans.
 * We just show a one-line summary:
 *
 * ```
 * 🔍 42 elements · example.com
 * ```
 *
 * Or with action prefix (ref-click / ref-type):
 *
 * ```
 * 🔍 Clicked [e3]. 42 elements · example.com
 * ```
 */
export function BrowserSnapshotCard({ data }: BrowserSnapshotCardProps): React.JSX.Element {
  const host = data.url ? hostname(data.url) : ''

  return (
    <div className="ml-4 mt-0.5 flex items-center gap-1.5">
      <ScanSearch
        className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground)/0.5)]"
        aria-hidden="true"
      />
      <span className="text-xs text-[hsl(var(--muted-foreground))]">
        {data.actionPrefix && (
          <span className="text-[hsl(var(--foreground))]">
            {data.actionPrefix}
            {' '}
          </span>
        )}
        {data.refCount > 0 && (
          <>
            {data.refCount} elements
          </>
        )}
        {host && (
          <>
            <span className="text-[hsl(var(--muted-foreground)/0.3)]"> · </span>
            <span className="text-[hsl(var(--muted-foreground)/0.6)]">
              {host}
            </span>
          </>
        )}
      </span>
    </div>
  )
}

// ─── Screenshot (RESULT_CARD_REGISTRY fallback) ─────────────────────────

interface BrowserScreenshotResultCardProps {
  data: BrowserScreenshotResult
}

/**
 * Fallback result card for browser_screenshot.
 *
 * Normally the image is extracted as a standalone ImageBlock by
 * `extractMediaFromToolResult` and rendered via ContentBlockRenderer's
 * context-aware detection. This card handles the edge case where the
 * image data remains serialised as JSON in `tool_result.content`.
 *
 * Delegates rendering entirely to BrowserScreenshotCard.
 */
export function BrowserScreenshotResultCard({ data }: BrowserScreenshotResultCardProps): React.JSX.Element {
  return <BrowserScreenshotCard imageData={data.imageData} mediaType={data.mediaType} />
}
