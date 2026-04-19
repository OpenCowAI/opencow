// SPDX-License-Identifier: Apache-2.0

/**
 * AssistantMessage — Self-subscribing streaming component for assistant messages.
 *
 * Extracted from SessionMessageList.tsx for single-responsibility.
 * This component owns:
 * - Streaming overlay self-subscription (O(1) re-render during streaming)
 * - Block reference stabilization (preserves old refs for unchanged blocks)
 * - In-message tool collapsing (splits long tool sequences into collapsible segments)
 */

import { useRef, useMemo, memo } from 'react'
import { ContentBlockRenderer } from './ContentBlockRenderer'
import { ToolBatchCollapsible } from './ToolBatchCollapsible'
import { useCommandStore, selectStreamingMessage } from '@/stores/commandStore'
import { cn } from '@/lib/utils'
import { NativeCapabilityTools } from '@shared/nativeCapabilityToolNames'
import { isEvoseToolName } from '@shared/evoseNames'
import type { ManagedSessionMessage, ContentBlock } from '@shared/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Narrowed assistant variant of ManagedSessionMessage. */
type AssistantSessionMessage = Extract<ManagedSessionMessage, { role: 'assistant' }>

interface IndexedContentBlock {
  block: ContentBlock
  index: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IN_MESSAGE_TOOL_COLLAPSE_THRESHOLD = 2
const NON_BATCHABLE_TOOL_NAMES = new Set<string>([
  NativeCapabilityTools.ISSUE_CREATE,
  NativeCapabilityTools.ISSUE_UPDATE,
  NativeCapabilityTools.SCHEDULE_PROPOSE_OPERATION,
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countToolUseBlocks(blocks: ContentBlock[]): number {
  let total = 0
  for (const block of blocks) {
    if (block.type === 'tool_use') total += 1
  }
  return total
}

function hasNonBatchableToolUse(blocks: ContentBlock[]): boolean {
  for (const block of blocks) {
    if (block.type !== 'tool_use') continue
    if (NON_BATCHABLE_TOOL_NAMES.has(block.name)) return true
    if (isEvoseToolName(block.name)) return true
  }
  return false
}

function splitToolAndNonToolSegments(
  blocks: ContentBlock[],
): Array<{ kind: 'tool' | 'other'; blocks: IndexedContentBlock[] }> {
  const segments: Array<{ kind: 'tool' | 'other'; blocks: IndexedContentBlock[] }> = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const kind: 'tool' | 'other' = block.type === 'tool_use' || block.type === 'tool_result' ? 'tool' : 'other'
    const prev = segments[segments.length - 1]
    if (prev && prev.kind === kind) {
      prev.blocks.push({ block, index: i })
    } else {
      segments.push({ kind, blocks: [{ block, index: i }] })
    }
  }
  return segments
}

function extractLastTextBlockIndex(blocks: ContentBlock[]): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'text') return i
  }
  return -1
}

/**
 * Compact assistant messages are made entirely of lightweight console rows
 * (tool pills/results and collapsed thinking toggles) with no prose/image/
 * document content. Their vertical rhythm should come from the stack
 * container rather than per-message padding.
 */
export function isCompactAssistantContent(blocks: readonly ContentBlock[]): boolean {
  if (blocks.length === 0) return false
  return blocks.every((block) =>
    block.type === 'tool_use' ||
    block.type === 'tool_result' ||
    block.type === 'thinking',
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AssistantMessage = memo(function AssistantMessage({
  message: structuralMessage,
  sessionId,
}: {
  /** The structural message from sessionMessages (stable during streaming). */
  message: AssistantSessionMessage
  sessionId: string
}) {
  // ── Self-subscribing streaming overlay ──────────────────────────────
  // During streaming, the store fast-path writes ALL updates (text growth
  // AND structural changes like new tool_use blocks) to
  // `streamingMessageBySession` — NOT `sessionMessages`.  This keeps
  // sessionMessages stable → messageGroups unchanged → Virtuoso data
  // unchanged → zero cascade to other visible items.
  //
  // This component self-subscribes to the streaming overlay and resolves
  // the **effective message**: overlay when streaming, structural when not.
  // The overlay IS the complete ManagedSessionMessage, so this is a
  // wholesale replacement — no per-field extraction needed.  New fields
  // added to ManagedSessionMessage are automatically available from the
  // overlay without any changes to this component.
  //
  //   - React.memo prevents parent-triggered re-renders (structural ref stable)
  //   - The internal useCommandStore subscription drives re-renders
  //     ONLY for this one component when streaming content changes
  //   - No other AssistantMessage in the Virtuoso list is affected
  //
  // The subscription is NOT gated by `isStreaming`.  During finalization,
  // the store clears the overlay and updates sessionMessages in a single
  // set() call, but the child subscription fires before the parent's new
  // props propagate through Virtuoso — creating a one-frame gap where the
  // structural prop is stale but the overlay is already null.  Unconditional
  // subscription eliminates this race.  The ID+role check inside the
  // selector ensures only the actual streaming message for THIS component
  // returns non-null, so non-streaming AssistantMessages have zero
  // re-render overhead (selector returns same `null` → Object.is skips).
  const overlay = useCommandStore((s) => {
    const msg = selectStreamingMessage(s, sessionId)
    return (msg && msg.id === structuralMessage.id && msg.role === 'assistant') ? msg : null
  })

  // Effective message: overlay replaces the ENTIRE structural message when
  // present.  All fields (content, activeToolUseId, isStreaming, etc.) come
  // from the overlay wholesale — no field-by-field extraction.
  const msg = overlay ?? structuralMessage
  const { id, content, isStreaming, activeToolUseId } = msg

  // ── Block reference stabilization ──────────────────────────────────
  // During streaming, `content` is a new array every frame.  Preserve
  // old block references for unchanged blocks so ContentBlockRenderer's
  // React.memo skips re-rendering them — avoiding expensive markdown
  // re-parse and syntax highlighting for blocks that haven't changed.
  //
  // Handles both same-length updates (text growth) AND length changes
  // (new tool_use / thinking block appended).  For the common prefix
  // (indices that exist in both old and new), per-type comparison
  // decides whether to reuse the old reference.  New blocks beyond the
  // previous length always use the new reference.
  const prevBlocksRef = useRef<ContentBlock[]>(content)
  const stableContent = useMemo(() => {
    const prev = prevBlocksRef.current
    if (prev === content) return content
    const stabilized = content.map((newBlock, i) => {
      const oldBlock = prev[i]
      // New block appended beyond previous length — no old reference to reuse.
      if (!oldBlock) return newBlock
      if (oldBlock === newBlock) return oldBlock
      if (oldBlock.type !== newBlock.type) return newBlock
      // Text block: reuse old reference only if text is identical
      if (newBlock.type === 'text' && oldBlock.type === 'text') {
        return oldBlock.text === newBlock.text ? oldBlock : newBlock
      }
      // Thinking block: also has growing text content during streaming
      if (newBlock.type === 'thinking' && oldBlock.type === 'thinking') {
        return oldBlock.thinking === newBlock.thinking ? oldBlock : newBlock
      }
      // tool_use block: propagate new reference when observable content changes.
      //   - progressBlocks: Evose relay streaming data (structured blocks)
      //   - progress: plain-text tool output (Claude engine tool execution)
      //   - id: block identity (shouldn't change, but guard defensively)
      // When none of these changed, reuse old reference → ContentBlockRenderer
      // memo skips → zero DOM mutation → zero style recalc / paint.
      if (newBlock.type === 'tool_use' && oldBlock.type === 'tool_use') {
        if (newBlock.progressBlocks !== oldBlock.progressBlocks) return newBlock
        if (newBlock.progress !== oldBlock.progress) return newBlock
        if (newBlock.id !== oldBlock.id) return newBlock
        return oldBlock
      }
      // Other block types (tool_result, image, document, slash_command):
      // content is immutable once emitted — safe to reuse old reference.
      return oldBlock
    })
    prevBlocksRef.current = stabilized
    return stabilized
  }, [content])

  // Filter out filler text blocks (e.g. "...") emitted by Claude between tool calls.
  // Only suppress when the block is sandwiched between tool_use blocks on BOTH sides.
  // Regex matches exactly "..." (not "." or "..") to avoid false positives.
  const filteredContent = stableContent.filter((block, i) => {
    if (block.type !== 'text') return true
    if (!/^\s*\.\.\.\s*$/.test(block.text)) return true
    const prev = stableContent[i - 1]
    const next = stableContent[i + 1]
    return !(prev?.type === 'tool_use' && next?.type === 'tool_use')
  })

  const toolCallCount = countToolUseBlocks(filteredContent)
  const shouldCollapseInMessageTools = toolCallCount >= IN_MESSAGE_TOOL_COLLAPSE_THRESHOLD
  const lastTextBlockIndex = extractLastTextBlockIndex(filteredContent)
  const hasToolUseInMessage = toolCallCount > 0
  const textStreaming = isStreaming && !hasToolUseInMessage
  const isCompactOnly = isCompactAssistantContent(filteredContent)
  const rootClassName = cn(
    isCompactOnly ? 'py-px' : 'py-0.5',
    'break-words min-w-0',
  )
  const compactStackClassName = isCompactOnly && filteredContent.length > 1 ? 'space-y-1' : undefined

  const renderBlock = (block: ContentBlock, index: number) => (
    <ContentBlockRenderer
      key={`${block.type}-${index}`}
      block={block}
      sessionId={sessionId}
      isLastTextBlock={index === lastTextBlockIndex}
      isStreaming={textStreaming}
      isMessageStreaming={isStreaming}
      activeToolUseId={activeToolUseId}
    />
  )

  if (!shouldCollapseInMessageTools) {
    const renderedBlocks = filteredContent.map(renderBlock)
    return (
      <div data-msg-id={id} data-msg-role="assistant" className={rootClassName}>
        {compactStackClassName ? (
          <div className={compactStackClassName}>
            {renderedBlocks}
          </div>
        ) : renderedBlocks}
      </div>
    )
  }

  const segments = splitToolAndNonToolSegments(filteredContent)
  const renderSegment = (
    segment: { kind: 'tool' | 'other'; blocks: IndexedContentBlock[] },
    segmentIndex: number,
  ) => {
    if (segment.kind === 'tool') {
      const segmentContent = segment.blocks.map(({ block }) => block)
      const segmentToolCallCount = countToolUseBlocks(segmentContent)
      const shouldKeepExpanded =
        segmentToolCallCount < IN_MESSAGE_TOOL_COLLAPSE_THRESHOLD ||
        hasNonBatchableToolUse(segmentContent)
      if (shouldKeepExpanded) {
        return (
          <div key={`${id}-tool-segment-raw-${segmentIndex}-${segment.blocks[0]?.index ?? 0}`}>
            {segment.blocks.map(({ block, index }) => renderBlock(block, index))}
          </div>
        )
      }

      const segmentMessage: ManagedSessionMessage = {
        id: `${id}-tool-segment-${segmentIndex}`,
        role: 'assistant',
        content: segmentContent,
        timestamp: msg.timestamp,
        isStreaming,
        activeToolUseId,
      }
      return (
        <ToolBatchCollapsible
          key={`${id}-tool-segment-${segmentIndex}-${segment.blocks[0]?.index ?? 0}`}
          messages={[segmentMessage]}
          sessionId={sessionId}
        />
      )
    }
    return (
      <div key={`${id}-other-segment-${segmentIndex}-${segment.blocks[0]?.index ?? 0}`}>
        {segment.blocks.map(({ block, index }) => renderBlock(block, index))}
      </div>
    )
  }

  return (
    <div data-msg-id={id} data-msg-role="assistant" className={rootClassName}>
      {compactStackClassName ? (
        <div className={compactStackClassName}>
          {segments.map(renderSegment)}
        </div>
      ) : segments.map(renderSegment)}
    </div>
  )
})
