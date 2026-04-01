// SPDX-License-Identifier: Apache-2.0

import { memo, useMemo, useState, useCallback } from 'react'
import {
  Loader2,
  ChevronRight,
  GitCompare,
  Maximize2,
} from 'lucide-react'
import type { ToolUseBlock } from '@shared/types'
import { detectLanguage } from '@shared/fileUtils'
import { NativeCapabilityTools } from '@shared/nativeCapabilityToolNames'

import { truncateWithMeta } from '@shared/unicode'
import { getToolMeta } from './toolMeta'
import { useContentViewerContext } from './ContentViewerContext'
import { MarkdownFileCard } from './PreviewCards/MarkdownFileCard'


// ─── Types ───────────────────────────────────────────────────────────────────

interface DisplayField {
  label: string
  value: string
  format: 'text' | 'code' | 'path'
  truncateAt?: number
  /** When set, a "View" button opens a full Monaco viewer dialog with syntax highlighting. */
  viewerFilePath?: string
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Safely format any unknown value to a human-readable string.
 */
function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    // Short primitive arrays → comma-separated
    if (value.length <= 5 && value.every((v) => typeof v === 'string' || typeof v === 'number')) {
      return value.join(', ')
    }
    return JSON.stringify(value, null, 2)
  }
  return JSON.stringify(value, null, 2)
}

/**
 * Produce the ordered list of display fields for a given tool + input.
 * Every known tool gets purpose-built formatting; unknown tools get a clean generic fallback.
 */
function getToolDisplayFields(name: string, input: Record<string, unknown>): DisplayField[] {
  switch (name) {
    // ── File tools ──────────────────────────────────────────────────────────

    case 'Read':
      return [
        input.file_path != null && { label: 'file_path', value: String(input.file_path), format: 'path' as const },
        input.offset != null && { label: 'offset', value: String(input.offset), format: 'text' as const },
        input.limit != null && { label: 'limit', value: String(input.limit), format: 'text' as const },
        input.pages != null && { label: 'pages', value: String(input.pages), format: 'text' as const }
      ].filter(Boolean) as DisplayField[]

    case 'Write': {
      const writePath = input.file_path != null ? String(input.file_path) : undefined
      return [
        writePath != null && { label: 'file_path', value: writePath, format: 'path' as const },
        input.content != null && {
          label: 'content',
          value: String(input.content),
          format: 'code' as const,
          truncateAt: 300
          // No viewerFilePath here — Write gets a row-level View button instead
        },
        input.changes != null && {
          label: 'changes',
          value: formatValue(input.changes),
          format: 'code' as const,
          truncateAt: 300
        },
      ].filter(Boolean) as DisplayField[]
    }

    case 'Edit': {
      const editPath = input.file_path != null ? String(input.file_path) : undefined
      return [
        editPath != null && { label: 'file_path', value: editPath, format: 'path' as const },
        input.old_string != null && {
          label: 'old_string',
          value: String(input.old_string) || '(empty)',
          format: 'code' as const,
          truncateAt: 300,
          viewerFilePath: editPath
        },
        input.new_string != null && {
          label: 'new_string',
          value: String(input.new_string) || '(empty — deletion)',
          format: 'code' as const,
          truncateAt: 300,
          viewerFilePath: editPath
        },
        input.replace_all != null && { label: 'replace_all', value: String(input.replace_all), format: 'text' as const },
        input.changes != null && {
          label: 'changes',
          value: formatValue(input.changes),
          format: 'code' as const,
          truncateAt: 300
        },
      ].filter(Boolean) as DisplayField[]
    }

    // ── Shell & search tools ────────────────────────────────────────────────

    case 'Bash':
      return [
        input.command != null && {
          label: 'command',
          value: String(input.command),
          format: 'code' as const,
          truncateAt: 300
        },
        input.description != null && { label: 'description', value: String(input.description), format: 'text' as const },
        input.timeout != null && { label: 'timeout', value: `${input.timeout}ms`, format: 'text' as const }
      ].filter(Boolean) as DisplayField[]

    case 'Glob':
      return [
        input.pattern != null && { label: 'pattern', value: String(input.pattern), format: 'code' as const },
        input.path != null && { label: 'path', value: String(input.path), format: 'path' as const }
      ].filter(Boolean) as DisplayField[]

    case 'Grep':
      return [
        input.pattern != null && { label: 'pattern', value: String(input.pattern), format: 'code' as const },
        input.path != null && { label: 'path', value: String(input.path), format: 'path' as const },
        input.glob != null && { label: 'glob', value: String(input.glob), format: 'text' as const },
        input.type != null && { label: 'type', value: String(input.type), format: 'text' as const },
        input.output_mode != null && { label: 'output_mode', value: String(input.output_mode), format: 'text' as const },
        input['-i'] != null && { label: '-i', value: String(input['-i']), format: 'text' as const },
        input.context != null && { label: 'context', value: String(input.context), format: 'text' as const }
      ].filter(Boolean) as DisplayField[]

    // ── Agent & orchestration tools ─────────────────────────────────────────

    // Note: Task tool_use blocks are routed to TaskExecutionView by ContentBlockRenderer
    // and never reach ToolUseBlockView — no case needed here.

    case 'EnterPlanMode':
      return [] // No parameters — renders as static pill

    // ── UI & interaction tools ──────────────────────────────────────────────
    // TodoWrite + AskUserQuestion + ExitPlanMode: routed via WidgetToolRegistry — never reach here.

    // ── Web tools ───────────────────────────────────────────────────────────

    case 'WebSearch':
      return [
        input.query != null && { label: 'query', value: String(input.query), format: 'text' as const },
        input.allowed_domains != null && {
          label: 'allowed_domains',
          value: formatValue(input.allowed_domains),
          format: 'text' as const
        },
        input.blocked_domains != null && {
          label: 'blocked_domains',
          value: formatValue(input.blocked_domains),
          format: 'text' as const
        }
      ].filter(Boolean) as DisplayField[]

    case 'WebFetch':
      return [
        input.url != null && { label: 'url', value: String(input.url), format: 'path' as const },
        input.prompt != null && {
          label: 'prompt',
          value: String(input.prompt),
          format: 'text' as const,
          truncateAt: 200
        }
      ].filter(Boolean) as DisplayField[]

    // ── Notebook tools ──────────────────────────────────────────────────────

    case 'NotebookEdit': {
      const nbPath = input.notebook_path != null ? String(input.notebook_path) : undefined
      return [
        nbPath != null && {
          label: 'notebook',
          value: nbPath,
          format: 'path' as const
        },
        input.edit_mode != null && { label: 'edit_mode', value: String(input.edit_mode), format: 'text' as const },
        input.cell_type != null && { label: 'cell_type', value: String(input.cell_type), format: 'text' as const },
        input.new_source != null && {
          label: 'source',
          value: String(input.new_source),
          format: 'code' as const,
          truncateAt: 300,
          viewerFilePath: nbPath
        }
      ].filter(Boolean) as DisplayField[]
    }

    // ── Misc tools ──────────────────────────────────────────────────────────

    case 'Skill':
      return [
        input.skill != null && { label: 'skill', value: String(input.skill), format: 'text' as const },
        input.args != null && { label: 'args', value: String(input.args), format: 'code' as const }
      ].filter(Boolean) as DisplayField[]

    case 'EnterWorktree':
      return [
        input.name != null && { label: 'name', value: String(input.name), format: 'text' as const }
      ].filter(Boolean) as DisplayField[]

    // ── Browser tools ───────────────────────────────────────────────────────

    case NativeCapabilityTools.BROWSER_NAVIGATE:
      return [
        input.url != null && { label: 'URL', value: String(input.url), format: 'path' as const }
      ].filter(Boolean) as DisplayField[]

    case NativeCapabilityTools.BROWSER_CLICK:
      return [
        input.selector != null && {
          label: 'selector',
          value: String(input.selector),
          format: 'code' as const
        }
      ].filter(Boolean) as DisplayField[]

    case NativeCapabilityTools.BROWSER_TYPE:
      return [
        input.selector != null && {
          label: 'selector',
          value: String(input.selector),
          format: 'code' as const
        },
        input.text != null && { label: 'text', value: String(input.text), format: 'text' as const }
      ].filter(Boolean) as DisplayField[]

    case NativeCapabilityTools.BROWSER_EXTRACT:
      return [
        input.selector != null
          ? { label: 'selector', value: String(input.selector), format: 'code' as const }
          : { label: 'scope', value: 'full page', format: 'text' as const }
      ]

    case NativeCapabilityTools.BROWSER_SCREENSHOT:
      return [] // No parameters — screenshot is taken of the current page as-is

    case NativeCapabilityTools.BROWSER_SCROLL:
      return [
        input.direction != null && {
          label: 'direction',
          value: String(input.direction),
          format: 'text' as const
        },
        input.amount != null && {
          label: 'amount',
          value: `${input.amount}px`,
          format: 'text' as const
        }
      ].filter(Boolean) as DisplayField[]

    case NativeCapabilityTools.BROWSER_WAIT:
      return [
        input.selector != null && {
          label: 'selector',
          value: String(input.selector),
          format: 'code' as const
        },
        input.timeout != null && {
          label: 'timeout',
          value: `${input.timeout}ms`,
          format: 'text' as const
        }
      ].filter(Boolean) as DisplayField[]

    case NativeCapabilityTools.BROWSER_SNAPSHOT:
      return [] // No parameters — captures page accessibility tree

    case NativeCapabilityTools.BROWSER_REF_CLICK:
      return [
        input.ref != null && { label: 'ref', value: String(input.ref), format: 'text' as const }
      ].filter(Boolean) as DisplayField[]

    case NativeCapabilityTools.BROWSER_REF_TYPE:
      return [
        input.ref != null && { label: 'ref', value: String(input.ref), format: 'text' as const },
        input.text != null && { label: 'text', value: String(input.text), format: 'text' as const }
      ].filter(Boolean) as DisplayField[]

    // ── Issue tools ─────────────────────────────────────────────────────
    // Rich cards rendered in ToolResultBlockView via RESULT_CARD_REGISTRY.
    // Here we structure the input fields for readable expand-on-click detail.

    case NativeCapabilityTools.ISSUE_LIST:
      return issueListFields(input)

    case NativeCapabilityTools.ISSUE_GET:
      return [
        input.id != null && { label: 'id', value: String(input.id), format: 'text' as const },
      ].filter(Boolean) as DisplayField[]

    case NativeCapabilityTools.ISSUE_CREATE:
      return issueCreateFields(input)

    case NativeCapabilityTools.ISSUE_UPDATE:
      return issueUpdateFields(input)

    // ── Project tools ────────────────────────────────────────────────────

    case NativeCapabilityTools.PROJECT_LIST:
      return [
        input.includeArchived != null && {
          label: 'includeArchived',
          value: String(input.includeArchived),
          format: 'text' as const,
        },
      ].filter(Boolean) as DisplayField[]

    case NativeCapabilityTools.PROJECT_GET:
      return [
        input.id != null && { label: 'id', value: String(input.id), format: 'text' as const },
      ].filter(Boolean) as DisplayField[]

    // ── Schedule tools ───────────────────────────────────────────────────

    case NativeCapabilityTools.SCHEDULE_LIST:
      return scheduleListFields(input)

    case NativeCapabilityTools.SCHEDULE_GET:
    case NativeCapabilityTools.SCHEDULE_PAUSE:
    case NativeCapabilityTools.SCHEDULE_RESUME:
      return [
        input.id != null && { label: 'id', value: String(input.id), format: 'text' as const },
      ].filter(Boolean) as DisplayField[]

    case NativeCapabilityTools.SCHEDULE_CREATE:
      return scheduleCreateFields(input)

    case NativeCapabilityTools.SCHEDULE_UPDATE:
      return scheduleUpdateFields(input)

    case NativeCapabilityTools.SCHEDULE_PREVIEW:
      return [
        input.id != null && { label: 'id', value: String(input.id), format: 'text' as const },
        input.count != null && { label: 'count', value: String(input.count), format: 'text' as const },
      ].filter(Boolean) as DisplayField[]

    // ── Evose gateway tools ───────────────────────────────────────────────

    case NativeCapabilityTools.EVOSE_RUN_AGENT:
      return [
        input.app_id != null && { label: 'app_id', value: String(input.app_id), format: 'text' as const },
        input.input != null && {
          label: 'input',
          value: String(input.input),
          format: 'code' as const,
          truncateAt: 300,
        },
        input.session_id != null && { label: 'session_id', value: String(input.session_id), format: 'text' as const },
      ].filter(Boolean) as DisplayField[]

    case NativeCapabilityTools.EVOSE_RUN_WORKFLOW:
      return [
        input.app_id != null && { label: 'app_id', value: String(input.app_id), format: 'text' as const },
        input.inputs != null && {
          label: 'inputs',
          value: formatValue(input.inputs),
          format: 'code' as const,
          truncateAt: 300,
        },
      ].filter(Boolean) as DisplayField[]

    case NativeCapabilityTools.EVOSE_LIST_APPS:
      return [
        input.type != null && { label: 'type', value: String(input.type), format: 'text' as const },
        input.include_disabled != null && {
          label: 'include_disabled',
          value: String(input.include_disabled),
          format: 'text' as const,
        },
      ].filter(Boolean) as DisplayField[]

    // ── Generic fallback ────────────────────────────────────────────────────

    default:
      return genericFields(input)
  }
}

/**
 * Generic fallback: enumerate all input keys as display fields.
 */
function genericFields(input: Record<string, unknown>): DisplayField[] {
  return Object.entries(input).map(([key, value]) => {
    const str = formatValue(value)
    const isLong = str.length > 80 || str.includes('\n')
    return {
      label: key,
      value: str,
      format: isLong ? ('code' as const) : ('text' as const),
      truncateAt: isLong ? 300 : undefined
    }
  })
}

// ─── Issue / Project / Schedule display field builders ────────────────────────

function issueListFields(input: Record<string, unknown>): DisplayField[] {
  return [
    input.search != null && { label: 'search', value: String(input.search), format: 'text' as const },
    input.statuses != null && { label: 'statuses', value: formatValue(input.statuses), format: 'text' as const },
    input.priorities != null && { label: 'priorities', value: formatValue(input.priorities), format: 'text' as const },
    input.labels != null && { label: 'labels', value: formatValue(input.labels), format: 'text' as const },
    input.projectId != null && { label: 'projectId', value: String(input.projectId), format: 'text' as const },
    input.sortBy != null && { label: 'sortBy', value: String(input.sortBy), format: 'text' as const },
    input.sortOrder != null && { label: 'sortOrder', value: String(input.sortOrder), format: 'text' as const },
    input.limit != null && { label: 'limit', value: String(input.limit), format: 'text' as const },
    input.offset != null && { label: 'offset', value: String(input.offset), format: 'text' as const },
  ].filter(Boolean) as DisplayField[]
}

function issueCreateFields(input: Record<string, unknown>): DisplayField[] {
  return [
    input.title != null && { label: 'title', value: String(input.title), format: 'text' as const },
    input.status != null && { label: 'status', value: String(input.status), format: 'text' as const },
    input.priority != null && { label: 'priority', value: String(input.priority), format: 'text' as const },
    input.labels != null && { label: 'labels', value: formatValue(input.labels), format: 'text' as const },
    input.description != null && {
      label: 'description',
      value: String(input.description),
      format: 'text' as const,
      truncateAt: 200,
    },
    input.parentIssueId != null && { label: 'parentIssueId', value: String(input.parentIssueId), format: 'text' as const },
  ].filter(Boolean) as DisplayField[]
}

function issueUpdateFields(input: Record<string, unknown>): DisplayField[] {
  return [
    input.id != null && { label: 'id', value: String(input.id), format: 'text' as const },
    input.title != null && { label: 'title', value: String(input.title), format: 'text' as const },
    input.status != null && { label: 'status', value: String(input.status), format: 'text' as const },
    input.priority != null && { label: 'priority', value: String(input.priority), format: 'text' as const },
    input.labels != null && { label: 'labels', value: formatValue(input.labels), format: 'text' as const },
    input.description != null && {
      label: 'description',
      value: String(input.description),
      format: 'text' as const,
      truncateAt: 200,
    },
    input.parentIssueId != null && { label: 'parentIssueId', value: String(input.parentIssueId), format: 'text' as const },
    input.projectId != null && { label: 'projectId', value: String(input.projectId), format: 'text' as const },
  ].filter(Boolean) as DisplayField[]
}

function scheduleListFields(input: Record<string, unknown>): DisplayField[] {
  return [
    input.search != null && { label: 'search', value: String(input.search), format: 'text' as const },
    input.statuses != null && { label: 'statuses', value: formatValue(input.statuses), format: 'text' as const },
    input.projectId != null && { label: 'projectId', value: String(input.projectId), format: 'text' as const },
    input.limit != null && { label: 'limit', value: String(input.limit), format: 'text' as const },
    input.offset != null && { label: 'offset', value: String(input.offset), format: 'text' as const },
  ].filter(Boolean) as DisplayField[]
}

function scheduleCreateFields(input: Record<string, unknown>): DisplayField[] {
  return [
    input.name != null && { label: 'name', value: String(input.name), format: 'text' as const },
    input.description != null && {
      label: 'description',
      value: String(input.description),
      format: 'text' as const,
      truncateAt: 200,
    },
    input.priority != null && { label: 'priority', value: String(input.priority), format: 'text' as const },
    input.trigger != null && {
      label: 'trigger',
      value: formatValue(input.trigger),
      format: 'code' as const,
      truncateAt: 300,
    },
    input.action != null && {
      label: 'action',
      value: formatValue(input.action),
      format: 'code' as const,
      truncateAt: 300,
    },
  ].filter(Boolean) as DisplayField[]
}

function scheduleUpdateFields(input: Record<string, unknown>): DisplayField[] {
  return [
    input.id != null && { label: 'id', value: String(input.id), format: 'text' as const },
    input.name != null && { label: 'name', value: String(input.name), format: 'text' as const },
    input.description != null && {
      label: 'description',
      value: String(input.description),
      format: 'text' as const,
      truncateAt: 200,
    },
    input.priority != null && { label: 'priority', value: String(input.priority), format: 'text' as const },
    input.trigger != null && {
      label: 'trigger',
      value: formatValue(input.trigger),
      format: 'code' as const,
      truncateAt: 300,
    },
    input.action != null && {
      label: 'action',
      value: formatValue(input.action),
      format: 'code' as const,
      truncateAt: 300,
    },
    input.projectId != null && { label: 'projectId', value: String(input.projectId), format: 'text' as const },
  ].filter(Boolean) as DisplayField[]
}

/**
 * Determine if a tool has a single primary piece of viewable content
 * that warrants a row-level "View" button (opens in Monaco dialog).
 * Returns null for tools where viewing is handled per-field in the detail area.
 */
function getPrimaryViewerContent(
  name: string,
  input: Record<string, unknown>
): { content: string; filePath: string } | null {
  if (name === 'Write' && input.content != null && input.file_path != null) {
    return { content: String(input.content), filePath: String(input.file_path) }
  }
  return null
}

/**
 * Fallback file viewer target when a file tool has no inline content payload.
 * This is common on Codex `file_change` projections where only `file_path` is available.
 */
function getFallbackViewerPath(
  name: string,
  input: Record<string, unknown>
): string | null {
  const filePath = typeof input.file_path === 'string' ? input.file_path : null
  if (!filePath || filePath.length === 0) return null

  if (name === 'Write' && input.content == null) {
    return filePath
  }

  if (name === 'Edit' && (input.old_string == null || input.new_string == null)) {
    return filePath
  }

  return null
}

function truncateValue(value: string, maxLength: number): { text: string; isTruncated: boolean } {
  const result = truncateWithMeta(value, { max: maxLength, ellipsis: '' })
  return { text: result.text, isTruncated: result.truncated }
}

// ─── Internal sub-components ─────────────────────────────────────────────────

/**
 * Renders a code-style value with optional truncation, expand/collapse,
 * and an optional "View" button that opens a full Monaco viewer dialog.
 */
function CodeValueBlock({
  value,
  truncateAt,
  viewerFilePath,
}: {
  value: string
  truncateAt?: number
  /** When set, renders a "View" button that opens a syntax-highlighted Monaco dialog. */
  viewerFilePath?: string
}): React.JSX.Element {
  const [showFull, setShowFull] = useState(false)
  const { showContentViewer } = useContentViewerContext()
  const canTruncate = truncateAt != null && value.length > truncateAt
  const { text, isTruncated } =
    canTruncate && !showFull ? truncateValue(value, truncateAt) : { text: value, isTruncated: false }

  const fileName = viewerFilePath ? viewerFilePath.split('/').pop() ?? viewerFilePath : ''
  const language = viewerFilePath ? detectLanguage(viewerFilePath) : 'plaintext'

  return (
    <div>
      <pre className="font-mono text-[hsl(var(--muted-foreground))] bg-[hsl(var(--background))] rounded-md px-2 py-1 whitespace-pre-wrap break-words text-xs leading-normal max-h-40 overflow-y-auto">
        {text}
        {isTruncated && '\u2026'}
      </pre>
      {/* Action buttons row */}
      {(isTruncated || (showFull && canTruncate) || viewerFilePath) && (
        <div className="flex items-center gap-2 mt-1">
          {isTruncated && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowFull(true)
              }}
              className="text-xs text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-0.5"
              aria-label={`Show full content (${value.length.toLocaleString()} chars)`}
            >
              {`Show full (${value.length.toLocaleString()} chars)`}
            </button>
          )}
          {showFull && canTruncate && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowFull(false)
              }}
              className="text-xs text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-0.5"
              aria-label="Collapse content"
            >
              Show less
            </button>
          )}
          {viewerFilePath && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                showContentViewer({ content: value, fileName, filePath: viewerFilePath, language })
              }}
              className="inline-flex items-center gap-0.5 text-xs text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-0.5"
              aria-label={`Open ${fileName} in viewer`}
            >
              <Maximize2 className="w-3 h-3" aria-hidden="true" />
              View
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Diff helpers & components ────────────────────────────────────────────────
// Diff computation lives in extractFileChanges.ts (shared with DiffChangesDialog).

import { computeInlineDiff } from './extractFileChanges'
import type { DiffLine } from './extractFileChanges'

const DIFF_LINE_CLASSES: Record<DiffLine['type'], string> = {
  removed: 'bg-red-500/15 text-red-400',
  added: 'bg-green-500/15 text-green-400',
  context: 'text-[hsl(var(--muted-foreground))]'
}

const DIFF_PREFIX: Record<DiffLine['type'], string> = {
  removed: '−',
  added: '+',
  context: ' '
}

/**
 * Inline diff view for Edit tool — shows old_string → new_string as a colored diff.
 * Red lines = removed, green lines = added, gray = context.
 */
function EditDiffInline({
  oldString,
  newString,
  filePath,
  replaceAll
}: {
  oldString: string
  newString: string
  filePath?: string
  replaceAll?: boolean
}): React.JSX.Element {
  const lines = computeInlineDiff(oldString, newString)
  const removedCount = lines.filter((l) => l.type === 'removed').length
  const addedCount = lines.filter((l) => l.type === 'added').length

  return (
    <div className="mt-1 ml-4">
      {/* File path + stats header */}
      <div className="flex items-center gap-2 text-xs mb-1">
        {filePath && (
          <span className="font-mono text-[hsl(var(--muted-foreground))] break-all select-all">{filePath}</span>
        )}
        <span className="shrink-0 flex items-center gap-1.5 text-[hsl(var(--muted-foreground)/0.7)]">
          {removedCount > 0 && <span className="text-red-400">−{removedCount}</span>}
          {addedCount > 0 && <span className="text-green-400">+{addedCount}</span>}
          {replaceAll && (
            <span className="text-amber-400 text-[10px] font-medium uppercase tracking-wide">all</span>
          )}
        </span>
      </div>
      {/* Diff lines */}
      <pre
        className="font-mono text-xs leading-normal rounded-md bg-[hsl(var(--background))] border border-[hsl(var(--border)/0.5)] overflow-x-auto max-h-48 overflow-y-auto"
        role="img"
        aria-label="Code diff showing changes"
      >
        {(() => {
          let oldLine = 1
          let newLine = 1
          return lines.map((line, i) => {
            const ol = line.type === 'added' ? '' : oldLine
            const nl = line.type === 'removed' ? '' : newLine
            if (line.type !== 'added') oldLine++
            if (line.type !== 'removed') newLine++
            // Gutter width adapts to max line number digits
            const gutterW = 'w-5'
            return (
              <div
                key={i}
                className={`flex ${DIFF_LINE_CLASSES[line.type]}`}
              >
                {/* Old line number */}
                <span className={`${gutterW} shrink-0 text-right select-none opacity-40 pr-0.5`}>{ol}</span>
                {/* New line number */}
                <span className={`${gutterW} shrink-0 text-right select-none opacity-40 pr-1`}>{nl}</span>
                {/* ±prefix */}
                <span className="select-none opacity-60 inline-block w-3 text-center shrink-0">{DIFF_PREFIX[line.type]}</span>
                {/* Content */}
                <span className="pl-0.5">{line.content || '\u00A0'}</span>
              </div>
            )
          })
        })()}
        {lines.length === 0 && (
          <div className="px-2 py-1 text-[hsl(var(--muted-foreground)/0.5)] italic">(no changes)</div>
        )}
      </pre>
    </div>
  )
}

/**
 * Renders a text-style value with optional truncation and expand/collapse.
 * Unlike CodeValueBlock, this uses inline text (no background box).
 */
function TextValueBlock({
  value,
  truncateAt
}: {
  value: string
  truncateAt: number
}): React.JSX.Element {
  const [showFull, setShowFull] = useState(false)
  const canTruncate = value.length > truncateAt
  const { text, isTruncated } =
    canTruncate && !showFull ? truncateValue(value, truncateAt) : { text: value, isTruncated: false }

  return (
    <span className="text-[hsl(var(--muted-foreground))] break-words">
      {text}
      {isTruncated && '\u2026'}
      {isTruncated && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowFull(true)
          }}
          className="ml-1 text-xs text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-0.5"
          aria-label={`Show full text (${value.length.toLocaleString()} chars)`}
        >
          Show full
        </button>
      )}
      {showFull && canTruncate && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowFull(false)
          }}
          className="ml-1 text-xs text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-0.5"
          aria-label="Collapse text"
        >
          Show less
        </button>
      )}
    </span>
  )
}

/**
 * Renders all the input fields for a tool call in a structured key–value layout.
 * Edit tool gets a special diff rendering path instead of generic field layout.
 */
function ToolInputDetails({
  name,
  input,
}: {
  name: string
  input: Record<string, unknown>
}): React.JSX.Element {
  // ── Edit tool: dedicated diff view ──────────────────────────────────────
  if (name === 'Edit') {
    const hasOld = input.old_string != null
    const hasNew = input.new_string != null
    if (hasOld || hasNew) {
      const oldString = hasOld ? String(input.old_string) : ''
      const newString = hasNew ? String(input.new_string) : ''
      const filePath = input.file_path != null ? String(input.file_path) : undefined
      const replaceAll = input.replace_all === true

      return (
        <EditDiffInline
          oldString={oldString}
          newString={newString}
          filePath={filePath}
          replaceAll={replaceAll}
        />
      )
    }
  }

  // ── Generic field layout ────────────────────────────────────────────────
  const fields = getToolDisplayFields(name, input)

  if (fields.length === 0) {
    return (
      <p className="mt-1 ml-4 text-xs text-[hsl(var(--muted-foreground)/0.6)] italic">
        (no parameters)
      </p>
    )
  }

  return (
    <div className="mt-1 ml-4 space-y-0.5">
      {fields.map((field) => (
        <div key={field.label} className="flex gap-2 text-xs min-w-0">
          <span
            className="shrink-0 text-[hsl(var(--muted-foreground)/0.6)] font-mono select-none"
            style={{ minWidth: '5.5rem', textAlign: 'right' }}
          >
            {field.label}
          </span>
          <div className="min-w-0 flex-1">
            {field.format === 'code' ? (
              <CodeValueBlock value={field.value} truncateAt={field.truncateAt} viewerFilePath={field.viewerFilePath} />
            ) : field.format === 'path' ? (
              <span className="font-mono text-[hsl(var(--muted-foreground))] break-all select-all">
                {field.value}
              </span>
            ) : field.truncateAt ? (
              <TextValueBlock value={field.value} truncateAt={field.truncateAt} />
            ) : (
              <span className="text-[hsl(var(--muted-foreground))] break-words">{field.value}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Tool progress text ─────────────────────────────────────────────────────
//
// Isolated memo component for tool execution output (block.progress).
// CSS `contain: layout style paint` confines style recalculation and paint
// to this <pre> element — preventing layout/paint cascade to the parent
// message container and VirtuosoItem.
//
// Long progress strings (>8000 chars) are tail-truncated to bound DOM
// text-node size.  The full string remains in the data model for
// post-hoc inspection (e.g. content viewer).

const PROGRESS_TAIL_CHARS = 8000

const ToolProgressText = memo(function ToolProgressText({ progress }: { progress: string }) {
  const display = progress.length > PROGRESS_TAIL_CHARS
    ? '\u2026' + progress.slice(-PROGRESS_TAIL_CHARS)
    : progress
  return (
    <pre
      className="pl-2 text-xs font-mono text-[hsl(var(--muted-foreground))] whitespace-pre-wrap break-words max-h-40 overflow-y-auto leading-normal"
      style={{ contain: 'layout style paint' }}
    >
      {display}
    </pre>
  )
})

// ─── Main component ──────────────────────────────────────────────────────────

interface ToolUseBlockViewProps {
  block: ToolUseBlock
  isExecuting?: boolean
  sessionId?: string
}

export const ToolUseBlockView = memo(function ToolUseBlockView({
  block,
  isExecuting,
  sessionId,
}: ToolUseBlockViewProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { showContentViewer, showDiffViewer, openToolFileViewer } = useContentViewerContext()

  // Memoize tool metadata and viewer content — block.name and block.input
  // are reference-stable for completed tool_use blocks, so these only
  // recompute when a genuinely different tool is rendered.  Avoids redundant
  // string parsing, Object.keys traversal, and conditional routing during
  // Virtuoso cascade re-renders (~0.1ms × 10-20 visible pills = 1-2ms saved).
  const { icon: Icon, displayName, target } = useMemo(
    () => getToolMeta(block.name, block.input),
    [block.name, block.input],
  )
  const hasInput = useMemo(
    () => Object.keys(block.input).length > 0,
    [block.input],
  )
  const primaryViewer = useMemo(
    () => getPrimaryViewerContent(block.name, block.input),
    [block.name, block.input],
  )
  const fallbackViewerPath = useMemo(
    () => getFallbackViewerPath(block.name, block.input),
    [block.name, block.input],
  )

  const openFileViewerFromPath = useCallback(async (filePath: string) => {
    if (!sessionId) {
      const fileName = filePath.split('/').pop() ?? 'file'
      showContentViewer({
        content: '// Session context unavailable for tool file preview',
        fileName,
        filePath,
        language: detectLanguage(filePath),
      })
      return
    }
    await openToolFileViewer({ sessionId, filePath })
  }, [openToolFileViewer, sessionId, showContentViewer])

  // Read tool: async file viewer via IPC (content fetched on-demand when user clicks "View")
  const readFilePath = block.name === 'Read' && typeof block.input.file_path === 'string'
    ? block.input.file_path
    : null

  const handleReadView = useCallback(async () => {
    if (!readFilePath) return
    await openFileViewerFromPath(readFilePath)
  }, [readFilePath, openFileViewerFromPath])
  const isEdit = block.name === 'Edit' && block.input.old_string != null && block.input.new_string != null
  const isMarkdownWrite = block.name === 'Write'
    && typeof block.input.file_path === 'string'
    && /\.md$/i.test(block.input.file_path)
    && block.input.content != null
  const rowClasses =
    'flex items-center gap-1.5 font-mono text-xs min-w-0 max-w-full'

  // Shared icon + name + target elements
  const toolLabel = (
    <>
      <Icon
        className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]"
        aria-hidden="true"
      />
      <span className="font-medium text-[hsl(var(--foreground))]" title={block.name}>{displayName}</span>
      {target && (
        <span className="text-[hsl(var(--muted-foreground))] truncate min-w-0 flex-1">{target}</span>
      )}
    </>
  )

  return (
    <div className={isExecuting ? 'tool-pill-enter' : undefined}>
      {hasInput ? (
        // Interactive row: expand-toggle pill (left) + icon-only action buttons + spinner (right)
        // Using a <div> container with separate <button> elements to avoid nested buttons.
        <div className={rowClasses}>
          <button
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1.5 min-w-0 max-w-full flex-1 text-left bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted-foreground)/0.15)] rounded-full px-2 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse tool details' : 'Expand tool details'}
          >
            <ChevronRight
              className={`w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            {toolLabel}
          </button>
          {/* Row-level Diff button — Edit tool, icon-only */}
          {isEdit && (
            <button
              onClick={() => showDiffViewer({
                oldString: String(block.input.old_string),
                newString: String(block.input.new_string),
                filePath: String(block.input.file_path ?? 'file'),
                ...(sessionId ? { sessionId } : {}),
              })}
              className="inline-flex items-center justify-center shrink-0 w-5 h-5 rounded-md text-[hsl(var(--muted-foreground))] opacity-40 hover:opacity-100 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
              aria-label={`Open diff for ${(block.input.file_path as string | undefined)?.split('/').pop() ?? 'file'}`}
            >
              <GitCompare className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
          {/* Row-level View button — Write tool, icon-only */}
          {primaryViewer && (
            <button
              onClick={() => showContentViewer({
                content: primaryViewer.content,
                fileName: primaryViewer.filePath.split('/').pop() ?? 'file',
                filePath: primaryViewer.filePath,
                language: detectLanguage(primaryViewer.filePath),
              })}
              className="inline-flex items-center justify-center shrink-0 w-5 h-5 rounded-md text-[hsl(var(--muted-foreground))] opacity-40 hover:opacity-100 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
              aria-label={`View ${primaryViewer.filePath.split('/').pop() ?? 'file'}`}
            >
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
          {/* Row-level View button — Read tool, icon-only */}
          {readFilePath && !primaryViewer && (
            <button
              onClick={handleReadView}
              className="inline-flex items-center justify-center shrink-0 w-5 h-5 rounded-md text-[hsl(var(--muted-foreground))] opacity-40 hover:opacity-100 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
              aria-label={`View ${readFilePath.split('/').pop() ?? 'file'}`}
            >
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
          {/* Row-level View button — fallback for file tools without inline content */}
          {!readFilePath && !primaryViewer && fallbackViewerPath && (
            <button
              onClick={() => { void openFileViewerFromPath(fallbackViewerPath) }}
              className="inline-flex items-center justify-center shrink-0 w-5 h-5 rounded-md text-[hsl(var(--muted-foreground))] opacity-40 hover:opacity-100 hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
              aria-label={`View ${fallbackViewerPath.split('/').pop() ?? 'file'}`}
            >
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
          {isExecuting && (
            <Loader2
              className="w-3.5 h-3.5 shrink-0 motion-safe:animate-spin text-[hsl(var(--muted-foreground))]"
              aria-label="Tool executing"
            />
          )}
        </div>
      ) : (
        // Static row (no input, not interactive) — pill style
        <div className={rowClasses}>
          <span className="inline-flex items-center gap-1.5 bg-[hsl(var(--muted))] rounded-full px-2 py-0.5 min-w-0 max-w-full flex-1">
            {toolLabel}
          </span>
          {isExecuting && (
            <Loader2
              className="w-3.5 h-3.5 shrink-0 motion-safe:animate-spin text-[hsl(var(--muted-foreground))]"
              aria-label="Tool executing"
            />
          )}
        </div>
      )}
      {expanded && hasInput && <ToolInputDetails name={block.name} input={block.input} />}
      {/* Markdown file preview card — always visible for Write .md */}
      {isMarkdownWrite && (
        <MarkdownFileCard
          content={String(block.input.content)}
          filePath={String(block.input.file_path)}
          onClick={() => showContentViewer({
            content: String(block.input.content),
            fileName: String(block.input.file_path).split('/').pop() ?? 'file',
            filePath: String(block.input.file_path),
            language: detectLanguage(String(block.input.file_path)),
          })}
        />
      )}
      {block.progress && (
        <ToolProgressText progress={block.progress} />
      )}
    </div>
  )
})
