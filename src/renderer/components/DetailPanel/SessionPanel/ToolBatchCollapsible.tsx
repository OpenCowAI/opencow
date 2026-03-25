// SPDX-License-Identifier: Apache-2.0

import { memo, useState, useMemo } from 'react'
import { ChevronRight, AlertTriangle } from 'lucide-react'
import { ContentBlockRenderer } from './ContentBlockRenderer'
import { MarkdownFileCard } from './PreviewCards/MarkdownFileCard'
import { getToolDisplayName } from './toolMeta'
import { detectLanguage } from '@shared/fileUtils'
import { isEvoseToolName } from '@shared/evoseNames'
import { NativeCapabilityTools } from '@shared/nativeCapabilityToolNames'
import { WIDGET_TOOL_NAMES } from './WidgetToolRegistry'
import { useContentViewerContext } from './ContentViewerContext'
import type { ManagedSessionMessage, ContentBlock } from '@shared/types'

// ─── Helpers ────────────────────────────────────────────────────────────────

interface ToolSummary {
  name: string
  count: number
}

/** Info about a markdown file written or edited in the batch. */
interface MdFileInfo {
  /** Unique key for React rendering */
  key: string
  filePath: string
  content: string
  /** True when content must be loaded from disk on click. */
  needsLoad?: boolean
}

/** Extract a compact summary of tools used across a batch of messages. */
function summariseTools(messages: ManagedSessionMessage[]): {
  toolSummaries: ToolSummary[]
  totalTools: number
  hasError: boolean
} {
  const counts = new Map<string, number>()
  let hasError = false

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        counts.set(block.name, (counts.get(block.name) ?? 0) + 1)
      }
      if (block.type === 'tool_result' && block.isError) {
        hasError = true
      }
    }
  }

  const toolSummaries: ToolSummary[] = []
  let totalTools = 0
  for (const [name, count] of counts) {
    toolSummaries.push({ name, count })
    totalTools += count
  }

  return { toolSummaries, totalTools, hasError }
}

const MD_RE = /\.md$/i

/**
 * Extract markdown file info from Write and Edit tool_use blocks in the batch.
 * - Write .md → uses `content` field
 * - Edit .md  → uses `new_string` field (the new content after edit)
 */
export function extractMdFiles(messages: ManagedSessionMessage[]): MdFileInfo[] {
  const files: MdFileInfo[] = []
  const lazyPreviewPlaceholder = '_Preview unavailable — click to load from file._'

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue
      const filePath = block.input.file_path
      if (typeof filePath !== 'string' || !MD_RE.test(filePath)) continue

      if (block.name === 'Write' && typeof block.input.content === 'string') {
        files.push({ key: `md-${block.id}`, filePath, content: block.input.content })
      } else if (block.name === 'Write') {
        files.push({ key: `md-${block.id}`, filePath, content: lazyPreviewPlaceholder, needsLoad: true })
      } else if (block.name === 'Edit' && typeof block.input.new_string === 'string') {
        files.push({ key: `md-${block.id}`, filePath, content: block.input.new_string })
      } else if (block.name === 'Edit') {
        files.push({ key: `md-${block.id}`, filePath, content: lazyPreviewPlaceholder, needsLoad: true })
      }
    }
  }

  return files
}

// ─── Component ──────────────────────────────────────────────────────────────

interface ToolBatchCollapsibleProps {
  /** The batched assistant messages (tool-only, no visible text) */
  messages: ManagedSessionMessage[]
  /** Session context required for secure tool file preview resolution. */
  sessionId?: string
}

const MIN_COLLAPSIBLE_TOOL_CALLS = 2

export const ToolBatchCollapsible = memo(function ToolBatchCollapsible({
  messages,
  sessionId,
}: ToolBatchCollapsibleProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { showContentViewer, openToolFileViewer } = useContentViewerContext()

  const { toolSummaries, totalTools, hasError } = useMemo(
    () => summariseTools(messages),
    [messages]
  )

  // Format summary label: "Read ×3, Edit ×2, Navigate"
  const summaryLabel = useMemo(() => {
    return toolSummaries
      .map((t) => {
        const displayName = getToolDisplayName(t.name)
        return t.count > 1 ? `${displayName} ×${t.count}` : displayName
      })
      .join(', ')
  }, [toolSummaries])

  // Markdown file preview cards — shown below the collapsed pill so users can
  // see doc artifacts at a glance without expanding the full tool batch.
  const mdFiles = useMemo(() => extractMdFiles(messages), [messages])
  const canCollapse = totalTools >= MIN_COLLAPSIBLE_TOOL_CALLS
  const showExpandedContent = !canCollapse || expanded

  return (
    <div
      data-msg-id={messages[0]?.id}
      data-msg-role="assistant"
      className="py-0.5"
    >
      {canCollapse && (
        <>
          {/* ── Collapsed summary row ──────────────────────────────────────── */}
          <button
            onClick={() => setExpanded((prev) => !prev)}
            className="group inline-flex items-center gap-1.5 text-left font-mono text-xs min-w-0 bg-[hsl(var(--muted)/0.5)] hover:bg-[hsl(var(--muted))] rounded-full px-2 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${totalTools} tool calls` : `Expand ${totalTools} tool calls`}
          >
            <ChevronRight
              className={`w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />

            <span className="font-medium text-[hsl(var(--muted-foreground))]">
              {totalTools} tool call{totalTools !== 1 ? 's' : ''}
            </span>

            {hasError && (
              <AlertTriangle
                className="w-3 h-3 shrink-0 text-red-500"
                aria-label="Contains errors"
              />
            )}

            <span className="text-[hsl(var(--muted-foreground)/0.6)] truncate min-w-0">
              {summaryLabel}
            </span>
          </button>

          {/* ── Markdown file preview cards (visible even when collapsed) ── */}
          {!expanded && mdFiles.length > 0 && (
            <div className="mt-0.5">
              {mdFiles.map((md) => (
                <MarkdownFileCard
                  key={md.key}
                  content={md.content}
                  filePath={md.filePath}
                  onClick={() => {
                    const fileName = md.filePath.split('/').pop() ?? md.filePath
                    const language = detectLanguage(md.filePath)
                    if (!md.needsLoad) {
                      showContentViewer({
                        content: md.content,
                        fileName,
                        filePath: md.filePath,
                        language,
                      })
                      return
                    }

                    if (sessionId) {
                      void openToolFileViewer({ sessionId, filePath: md.filePath })
                      return
                    }
                    showContentViewer({
                      content: '// Session context unavailable for tool file preview',
                      fileName,
                      filePath: md.filePath,
                      language,
                    })
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Expanded content ───────────────────────────────────────────── */}
      {showExpandedContent && (
        <div className={canCollapse ? 'mt-0.5 border-l-2 border-[hsl(var(--border)/0.3)] pl-1.5 ml-1' : undefined}>
          {messages.map((msg) => {
            if (msg.role !== 'assistant') return null

            // Find the index of the last text block for streaming cursor
            let lastTextBlockIndex = -1
            for (let i = msg.content.length - 1; i >= 0; i--) {
              if (msg.content[i].type === 'text') {
                lastTextBlockIndex = i
                break
              }
            }

            return (
              <div
                key={msg.id}
                data-msg-id={msg.id}
                data-msg-role="assistant"
                className="py-0.5 break-words min-w-0"
              >
                {msg.content.map((block: ContentBlock, index: number) => (
                  <ContentBlockRenderer
                    key={`${block.type}-${index}`}
                    block={block}
                    sessionId={sessionId}
                    isLastTextBlock={index === lastTextBlockIndex}
                    isStreaming={msg.role === 'assistant' ? msg.isStreaming : undefined}
                    isMessageStreaming={msg.role === 'assistant' ? msg.isStreaming : undefined}
                    activeToolUseId={msg.role === 'assistant' ? msg.activeToolUseId : undefined}
                  />
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})

// ─── Grouping logic ─────────────────────────────────────────────────────────

/**
 * Tools that should NOT be included in collapsed tool batches.
 *
 * Combines Widget Tools (from registry — render card-only, no pill) with
 * non-widget tools whose result cards carry important visible information
 * that would be lost if collapsed.
 */
const NON_BATCHABLE_TOOLS = new Set([
  ...WIDGET_TOOL_NAMES,
  NativeCapabilityTools.ISSUE_CREATE,
  NativeCapabilityTools.ISSUE_UPDATE,
])

/**
 * Determines if an assistant message is a "tool-only" message eligible for
 * batch-collapsing.  A message is batchable if:
 *
 *  1. It is an assistant message
 *  2. It has NO non-empty text blocks
 *  3. It has NO "widget" tool_use blocks (Task, TodoWrite, AskUserQuestion)
 *  4. It has NO Evose tool_use blocks — Evose tools render a streaming progress
 *     card that must remain visible immediately; hiding them in a collapsed batch
 *     makes the agent call appear "stuck" during execution.
 *  5. It is NOT currently streaming
 */
export function isBatchableToolMessage(msg: ManagedSessionMessage): boolean {
  if (msg.role !== 'assistant') return false
  if (msg.isStreaming) return false

  const hasVisibleText = msg.content.some(
    (b) => b.type === 'text' && b.text.trim().length > 0
  )
  if (hasVisibleText) return false

  const hasSpecialTool = msg.content.some(
    (b) => b.type === 'tool_use' && (NON_BATCHABLE_TOOLS.has(b.name) || isEvoseToolName(b.name))
  )
  if (hasSpecialTool) return false

  // Must have at least one tool_use
  const hasToolUse = msg.content.some((b) => b.type === 'tool_use')
  return hasToolUse
}

// ─── Message group types ────────────────────────────────────────────────────

export type MessageGroup =
  | { type: 'single'; message: ManagedSessionMessage }
  | { type: 'tool_batch'; messages: ManagedSessionMessage[] }

/** Minimum number of batchable messages to form a collapsible group. */
const MIN_BATCH_SIZE = MIN_COLLAPSIBLE_TOOL_CALLS

/**
 * Groups a flat list of messages into renderable segments:
 *  - `single`: normal message rendered as-is
 *  - `tool_batch`: ≥ MIN_BATCH_SIZE consecutive tool-only messages → collapsible
 *
 * System events are always rendered as singles (consumed ones are filtered by
 * the caller).
 */
export function groupMessages(messages: ManagedSessionMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  let pendingBatch: ManagedSessionMessage[] = []

  const flushBatch = (): void => {
    if (pendingBatch.length >= MIN_BATCH_SIZE) {
      groups.push({ type: 'tool_batch', messages: [...pendingBatch] })
    } else {
      // Not enough for a batch — emit as singles
      for (const m of pendingBatch) {
        groups.push({ type: 'single', message: m })
      }
    }
    pendingBatch = []
  }

  for (const msg of messages) {
    if (isBatchableToolMessage(msg)) {
      pendingBatch.push(msg)
    } else {
      flushBatch()
      groups.push({ type: 'single', message: msg })
    }
  }

  // Flush any remaining batch
  flushBatch()

  return groups
}
