// SPDX-License-Identifier: Apache-2.0

/**
 * EvoseProgressCard — Evose Agent streaming output preview card.
 *
 * Directly renders EvoseProgressBlock[] structured data — zero parsing, zero regex.
 * End-to-end type safety: SSE -> AgentRunEvent -> EvoseRelayEvent -> progressBlocks[] -> this component.
 *
 * Streaming phase (isStreaming=true):
 *   - Real-time rendering of mixed content: Markdown text + tool call pills
 *   - Auto-scroll to bottom
 *   - Header shows appName + spinning loader
 *   - Max height 240px, content is scrollable
 *
 * Completed phase (isStreaming=false):
 *   - Collapsed by default (header + "expand full text" button, content truncated to ~4 lines)
 *   - When expanded, shows full content with no height limit
 *
 * Tool call display (rendered directly from structured EvoseToolCallBlock):
 *   - Pill style, mirrors Session Console ToolUseBlockView
 *   - Custom icon (iconUrl) + fallback
 *   - Expandable kwargs input parameters + result preview
 *   - Completed successfully -> green dot; error -> red pill + error summary
 *   - Running -> spinner
 */

import { useState, useCallback } from 'react'
import {
  Loader2,
  ChevronRight,
  Bot,
  Wrench,
  XCircle,
  CheckCircle2,
} from 'lucide-react'
import { MarkdownContent } from '../../ui/MarkdownContent'
import { cn } from '@/lib/utils'
import { truncate } from '@shared/unicode'
import type { EvoseProgressBlock, EvoseTextBlock, EvoseToolCallBlock } from '@shared/types'

// ─── Props ──────────────────────────────────────────────────────────────────

interface EvoseProgressCardProps {
  /** Structured progress blocks — directly from ToolUseBlock.progressBlocks */
  blocks: EvoseProgressBlock[]
  /** true = tool is executing (streaming); false = completed */
  isStreaming: boolean
  /** App name displayed in the card header, e.g. "Customer Support" */
  appName: string
  /** App avatar URL — from EvoseAppConfig.avatar */
  appAvatar?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert snake_case tool name to Title Case for display.
 * e.g. "search_tweets" → "Search Tweets"
 */
function toTitleCase(snake: string): string {
  return snake
    .split('_')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
    .join(' ')
    .trim()
}

/** Result collapse threshold in lines */
const RESULT_COLLAPSE_LINES = 10

// ─── Sub-components ─────────────────────────────────────────────────────────

/**
 * Remote tool icon with graceful fallback.
 * Loads lazily; on error, falls back to Wrench/XCircle icon.
 */
function ToolIcon({
  iconUrl,
  isError,
}: {
  iconUrl?: string
  isError: boolean
}): React.JSX.Element {
  const [imgFailed, setImgFailed] = useState(false)

  if (iconUrl && !imgFailed) {
    return (
      <img
        src={iconUrl}
        alt=""
        className="w-3.5 h-3.5 shrink-0 rounded-sm object-contain"
        loading="lazy"
        onError={() => setImgFailed(true)}
      />
    )
  }

  if (isError) {
    return <XCircle className="w-3 h-3 shrink-0 text-red-400" aria-hidden="true" />
  }

  return (
    <Wrench
      className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]"
      aria-hidden="true"
    />
  )
}

/**
 * Key-value display for tool kwargs — compact, mono-spaced layout.
 */
function EvoseKwargsDisplay({
  kwargs,
}: {
  kwargs: Record<string, unknown>
}): React.JSX.Element {
  const entries = Object.entries(kwargs)
  if (entries.length === 0) return <></>

  return (
    <div className="mt-1.5 space-y-0.5">
      <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.5)] font-medium">
        Input
      </div>
      {entries.map(([key, value]) => {
        const str = typeof value === 'string' ? value : JSON.stringify(value)
        const truncated = truncate(str, { max: 200 })
        return (
          <div key={key} className="flex gap-2 text-[11px] min-w-0">
            <span
              className="shrink-0 text-[hsl(var(--muted-foreground)/0.6)] font-mono select-none text-right"
              style={{ minWidth: '4.5rem' }}
            >
              {key}
            </span>
            <span className="text-[hsl(var(--muted-foreground))] font-mono break-all min-w-0" title={str}>
              {truncated}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Result preview — collapsible text with fold threshold.
 * Error results get a left red border accent.
 */
function EvoseResultPreview({
  result,
  isError,
}: {
  result: unknown
  isError: boolean
}): React.JSX.Element {
  const text = typeof result === 'string' ? result : result == null ? '' : JSON.stringify(result)
  const lines = text.split('\n')
  const isLong = lines.length > RESULT_COLLAPSE_LINES
  const [expanded, setExpanded] = useState(false)
  const displayContent = expanded ? text : lines.slice(0, RESULT_COLLAPSE_LINES).join('\n')

  if (!text) return <></>

  return (
    <div className="mt-1.5">
      <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.5)] font-medium mb-0.5">
        {isError ? 'Error' : 'Result'}
      </div>
      <div
        className={cn(
          'rounded text-[11px]',
          isError && 'border-l-2 border-red-500 pl-2',
        )}
      >
        <pre className="whitespace-pre-wrap break-words font-mono text-[hsl(var(--muted-foreground))] leading-normal max-h-40 overflow-y-auto">
          {displayContent}
        </pre>
        {isLong && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="mt-0.5 text-[11px] text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-0.5"
          >
            {`Show more (${lines.length} lines)`}
          </button>
        )}
        {isLong && expanded && (
          <button
            onClick={() => setExpanded(false)}
            className="mt-0.5 text-[11px] text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded-sm px-0.5"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Pill-style tool call badge — mirrors Session Console ToolUseBlockView.
 *
 * Layout: [icon] DisplayName  title  [status indicator]
 *
 * With details (kwargs/result): clickable with ChevronRight expand toggle.
 * Without details: static pill.
 */
function EvoseToolCallPill({
  block,
}: {
  block: EvoseToolCallBlock
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const isError = block.status === 'error'
  const isRunning = block.status === 'running'
  const isCompleted = block.status === 'completed'

  const displayName = toTitleCase(block.toolName)
  const target = block.title
  const hasDetails = !!(block.kwargs && Object.keys(block.kwargs).length > 0) || !!block.result
  const errorMessage = isError ? block.result : undefined

  const handleToggle = useCallback(() => {
    if (hasDetails) setExpanded((p) => !p)
  }, [hasDetails])

  return (
    <div>
      <div className="inline-flex items-center gap-1 font-mono text-xs min-w-0">
        {hasDetails ? (
          <button
            onClick={handleToggle}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 max-w-full min-w-0 transition-colors',
              isError
                ? 'bg-red-500/10 hover:bg-red-500/15'
                : 'bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted-foreground)/0.15)]',
            )}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse tool details' : 'Expand tool details'}
          >
            <ChevronRight
              className={cn(
                'w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform duration-150 motion-reduce:transition-none',
                expanded && 'rotate-90',
              )}
              aria-hidden="true"
            />
            <ToolIcon iconUrl={block.iconUrl} isError={isError} />
            <span
              className={cn(
                'font-medium',
                isError ? 'text-red-400' : 'text-[hsl(var(--foreground))]',
              )}
              title={block.toolName}
            >
              {displayName}
            </span>
            <span
              className="text-[hsl(var(--muted-foreground))] truncate min-w-0"
              title={target}
            >
              {target}
            </span>
          </button>
        ) : (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 max-w-full min-w-0',
              isError ? 'bg-red-500/10' : 'bg-[hsl(var(--muted))]',
            )}
          >
            <ToolIcon iconUrl={block.iconUrl} isError={isError} />
            <span
              className={cn(
                'font-medium',
                isError ? 'text-red-400' : 'text-[hsl(var(--foreground))]',
              )}
              title={block.toolName}
            >
              {displayName}
            </span>
            <span
              className="text-[hsl(var(--muted-foreground))] truncate min-w-0"
              title={target}
            >
              {target}
            </span>
          </span>
        )}
        {/* Status indicators */}
        {isError && errorMessage && (
          <span
            className="text-red-400/70 truncate max-w-[200px] text-[10px]"
            title={errorMessage}
          >
            {truncate(errorMessage, { max: 60 })}
          </span>
        )}
        {isCompleted && (
          <CheckCircle2
            className="w-3 h-3 shrink-0 text-emerald-500/70"
            aria-label="Completed"
          />
        )}
        {isRunning && (
          <Loader2
            className="w-3 h-3 shrink-0 motion-safe:animate-spin text-[hsl(var(--muted-foreground))]"
            aria-label="Tool executing"
          />
        )}
      </div>
      {/* Expanded details */}
      {expanded && hasDetails && (
        <div className="ml-5 mt-0.5 pl-2 border-l border-[hsl(var(--border)/0.5)]">
          {block.kwargs && Object.keys(block.kwargs).length > 0 && (
            <EvoseKwargsDisplay kwargs={block.kwargs} />
          )}
          {block.result && (
            <EvoseResultPreview result={block.result} isError={isError} />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Block Renderer ─────────────────────────────────────────────────────────

/**
 * Renders EvoseProgressBlock[] — text blocks as Markdown, tool calls as pills.
 * Consecutive tool_call blocks are grouped into a vertical flex container.
 */
function BlocksRenderer({
  blocks,
  isStreaming,
}: {
  blocks: EvoseProgressBlock[]
  isStreaming: boolean
}): React.JSX.Element {
  // Group consecutive tool_call blocks for compact rendering
  type RenderGroup =
    | { type: 'text'; block: EvoseTextBlock }
    | { type: 'tool_group'; calls: EvoseToolCallBlock[] }

  const groups: RenderGroup[] = []
  for (const block of blocks) {
    if (block.type === 'tool_call') {
      const last = groups[groups.length - 1]
      if (last && last.type === 'tool_group') {
        last.calls.push(block)
      } else {
        groups.push({ type: 'tool_group', calls: [block] })
      }
    } else {
      groups.push({ type: 'text', block })
    }
  }

  return (
    <>
      {groups.map((group, i) => {
        if (group.type === 'text') {
          return (
            <MarkdownContent
              key={i}
              content={group.block.text}
              isStreaming={isStreaming && i === groups.length - 1}
              className="text-xs"
            />
          )
        }
        // tool_group — vertical list of pills
        return (
          <div key={i} className="flex flex-col gap-1 py-1">
            {group.calls.map((call) => (
              <EvoseToolCallPill key={call.toolCallId} block={call} />
            ))}
          </div>
        )
      })}
    </>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

export function EvoseProgressCard({ blocks, isStreaming, appName, appAvatar }: EvoseProgressCardProps) {
  const hasContent = blocks.length > 0

  // Hide only when there's truly nothing to show (not streaming, no content).
  if (!hasContent && !isStreaming) return null

  return (
    <div className="mt-1.5 rounded-md bg-[hsl(var(--muted)/0.4)]">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        {appAvatar ? (
          <img src={appAvatar} alt="" className="w-4 h-4 shrink-0 rounded-full object-cover" />
        ) : (
          <Bot className="w-3.5 h-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
        )}
        <span className="text-xs font-medium text-[hsl(var(--foreground))] truncate flex-1">
          {appName}
        </span>
        {isStreaming && (
          <Loader2
            className="w-3 h-3 shrink-0 text-emerald-600 motion-safe:animate-spin"
            aria-label="Agent generating"
          />
        )}
      </div>

      {/* Content — always fully expanded, no height cap */}
      <div className="px-2.5 pb-2">
        {hasContent && <BlocksRenderer blocks={blocks} isStreaming={isStreaming} />}
      </div>
    </div>
  )
}
