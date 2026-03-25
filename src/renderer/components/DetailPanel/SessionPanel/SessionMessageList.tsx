// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useCallback, useMemo, useState, useContext, createContext, startTransition, memo, forwardRef, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso, type VirtuosoHandle, type ListRange } from 'react-virtuoso'
import { ArrowDown, GitCompare } from 'lucide-react'
import { LinkifiedText } from '@/components/ui/LinkifiedText'
import { ContentBlockRenderer } from './ContentBlockRenderer'
import { SystemEventView } from './SystemEventView'
import { TaskEventsProvider, buildTaskLifecycleMap, resolveTaskFinalStates, isConsumedTaskEvent } from './TaskWidgets'
import { ToolLifecycleProvider, buildToolLifecycleMap } from './ToolLifecycleContext'
import { ToolBatchCollapsible, groupMessages } from './ToolBatchCollapsible'
import type { MessageGroup } from './ToolBatchCollapsible'
import { SessionScrollNav } from './SessionScrollNav'
import type { NavAnchor } from './SessionScrollNav'
import {
  AskUserQuestionProvider
} from './AskUserQuestionWidgets'
import type { AskUserQuestionActions } from './AskUserQuestionWidgets'
import { DiffChangesDialog } from './DiffChangesDialog'
import { hasFileChanges, countChangedFiles } from './extractFileChanges'
import { useDialogState } from '@/hooks/useModalAnimation'
import { useAutoFollow } from '@/hooks/useAutoFollow'
import { cn } from '@/lib/utils'
import { parseContextFiles } from '@/lib/contextFilesParsing'
import { ContextFileChips } from '@/components/ui/ContextFileChips'
import { useCommandStore, selectSessionMessages, selectStreamingMessage } from '@/stores/commandStore'
import type { ManagedSessionMessage, ManagedSessionState, SessionStopReason, UserMessageContent, ContentBlock, SlashCommandBlock } from '@shared/types'
import { getSlashDisplayLabel, joinSlashDisplays } from '@shared/slashDisplay'
import { truncate as unicodeTruncate } from '@shared/unicode'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Display variant for user messages */
export type MessageListVariant = 'cli' | 'chat'

/** Imperative handle exposed to parent via ref */
export interface SessionMessageListHandle {
  scrollToBottom: () => void
  /** Scroll a specific message into view by its ID, with a brief highlight flash */
  scrollToMessage: (msgId: string) => void
}

/** Structured payload emitted by onContextualQuestionChange */
export interface ContextualQuestionInfo {
  /** The full display text of the contextual user question, or null if none */
  text: string | null
  /** The message ID of the resolved user message, or null if none */
  msgId: string | null
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionMessageListProps {
  /** Unique session identifier — used to subscribe to commandStore for messages
   *  and to persist / restore scroll position. */
  sessionId: string
  /**
   * Optional external messages source.  When provided, these messages are used
   * directly instead of subscribing to commandStore.
   *
   * Use this for consumers that manage messages outside of commandStore
   * (e.g. BrowserSheetChat → browserOverlayStore, ReviewChatPanel → useReviewSession).
   *
   * When omitted, the component subscribes to `commandStore.sessionMessages[sessionId]`
   * for real-time streaming messages.
   */
  messages?: ManagedSessionMessage[]
  /** Session state — used to determine if AskUserQuestion cards are interactive */
  sessionState?: ManagedSessionState
  /** Stop reason — used to differentiate natural completion vs interruption for sub-agent tasks */
  stopReason?: SessionStopReason | null
  /** Send callback — used by interactive AskUserQuestion cards to submit answers */
  onSendAnswer?: (message: UserMessageContent) => Promise<boolean>
  /** Display variant: 'cli' (default, "> " prefix + monospace) or 'chat' (right-aligned bubble) */
  variant?: MessageListVariant
  /**
   * Called whenever the contextual user question changes — i.e. the user message
   * that best describes what the currently-visible agent response is answering.
   */
  onContextualQuestionChange?: (info: ContextualQuestionInfo) => void
  /**
   * Optional node rendered inline after all messages, scrolling with the list.
   */
  footerNode?: React.ReactNode
  /** Issue ID — forwarded to DiffChangesDialog for the review chat feature */
  issueId?: string
}

// ---------------------------------------------------------------------------
// Helpers — pure text extraction
// ---------------------------------------------------------------------------

function extractUserText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
}

// ---------------------------------------------------------------------------
// Context-files rendering (parsing & chips extracted to shared modules)
// ---------------------------------------------------------------------------

function UserTextWithContext({ text, className }: { text: string; className?: string }): React.JSX.Element {
  const { files, rest } = parseContextFiles(text)
  return (
    <>
      {files.length > 0 && (
        <div className="mb-1">
          <ContextFileChips files={files} />
        </div>
      )}
      {rest.trim() && <LinkifiedText text={rest} className={className} />}
    </>
  )
}

function SlashCommandChip({ block }: { block: SlashCommandBlock }): React.JSX.Element {
  const label = getSlashDisplayLabel(block)
  return (
    <span className="slash-mention" role="img" aria-label={`Slash command: ${label}`}>
      /{label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Message components — no content-visibility, pure rendering
// ---------------------------------------------------------------------------

const UserMessage = memo(function UserMessage({ id, content }: { id: string; content: ContentBlock[] }) {
  const hasRichContent = content.some((b) => b.type === 'slash_command' || b.type === 'image' || b.type === 'document')
  const plainText = hasRichContent ? '' : extractUserText(content)

  return (
    <div data-msg-id={id} data-msg-role="user" className="relative flex gap-2 py-1 -ml-3 pl-3 before:absolute before:left-0 before:top-[6px] before:bottom-[6px] before:w-0.5 before:bg-[hsl(var(--primary)/0.2)]">
      <span className="text-[hsl(var(--muted-foreground))] font-mono text-sm shrink-0 select-none leading-5" aria-hidden="true">{'>'}</span>
      <div className="min-w-0">
        {hasRichContent ? (
          <div className="text-sm font-mono text-[hsl(var(--foreground))] break-words min-w-0 leading-5">
            {(() => {
              const elements: React.ReactNode[] = []
              let imageGroup: React.ReactNode[] = []

              const flushImages = () => {
                if (imageGroup.length > 0) {
                  elements.push(
                    <div key={`img-group-${elements.length}`} className="flex flex-wrap gap-1.5 py-0.5">
                      {imageGroup}
                    </div>
                  )
                  imageGroup = []
                }
              }

              content.forEach((block, i) => {
                if (block.type === 'image') {
                  imageGroup.push(<ContentBlockRenderer key={i} block={block} />)
                } else {
                  flushImages()
                  if (block.type === 'text') elements.push(<UserTextWithContext key={i} text={block.text} />)
                  else if (block.type === 'slash_command') elements.push(<SlashCommandChip key={i} block={block} />)
                  else if (block.type === 'document') elements.push(<div key={i} className="py-0.5"><ContentBlockRenderer block={block} /></div>)
                }
              })
              flushImages()

              return elements
            })()}
          </div>
        ) : (
          <>
            {plainText && (
              <div className="text-sm font-mono text-[hsl(var(--foreground))] break-words min-w-0 leading-5">
                <UserTextWithContext text={plainText} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})

const ChatBubbleUserMessage = memo(function ChatBubbleUserMessage({ id, content }: { id: string; content: ContentBlock[] }) {
  const hasRichContent = content.some((b) => b.type === 'slash_command' || b.type === 'image' || b.type === 'document')
  const plainText = hasRichContent ? '' : extractUserText(content)
  const linkClass = '[&_a]:text-[hsl(var(--primary))] [&_a]:underline [&_a]:decoration-[hsl(var(--primary)/0.4)]'

  return (
    <div data-msg-id={id} data-msg-role="user" className="flex justify-end py-1.5">
      <div className="max-w-[80%] px-4 py-2.5 rounded-2xl bg-[hsl(var(--foreground)/0.06)] dark:bg-white/10 text-[hsl(var(--foreground))]">
        {hasRichContent ? (
          <div className="text-sm break-words min-w-0 leading-relaxed">
            {(() => {
              const elements: React.ReactNode[] = []
              let imageGroup: React.ReactNode[] = []

              const flushImages = () => {
                if (imageGroup.length > 0) {
                  elements.push(
                    <div key={`img-group-${elements.length}`} className="flex flex-wrap gap-1.5 py-0.5">
                      {imageGroup}
                    </div>
                  )
                  imageGroup = []
                }
              }

              content.forEach((block, i) => {
                if (block.type === 'image') {
                  imageGroup.push(<ContentBlockRenderer key={i} block={block} />)
                } else {
                  flushImages()
                  if (block.type === 'text') elements.push(<UserTextWithContext key={i} text={block.text} className={linkClass} />)
                  else if (block.type === 'slash_command') elements.push(<SlashCommandChip key={i} block={block} />)
                  else if (block.type === 'document') elements.push(<div key={i} className="py-0.5"><ContentBlockRenderer block={block} /></div>)
                }
              })
              flushImages()

              return elements
            })()}
          </div>
        ) : (
          <>
            {plainText && (
              <div className="text-sm break-words min-w-0 leading-relaxed">
                <UserTextWithContext text={plainText} className={linkClass} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
})

/** Narrowed assistant variant of ManagedSessionMessage — used by AssistantMessage props. */
type AssistantSessionMessage = Extract<ManagedSessionMessage, { role: 'assistant' }>

const IN_MESSAGE_TOOL_COLLAPSE_THRESHOLD = 2

interface IndexedContentBlock {
  block: ContentBlock
  index: number
}

function countToolUseBlocks(blocks: ContentBlock[]): number {
  let total = 0
  for (const block of blocks) {
    if (block.type === 'tool_use') total += 1
  }
  return total
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

const AssistantMessage = memo(function AssistantMessage({
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
      // tool_use block: progressBlocks may change during Evose streaming.
      // A new progressBlocks reference means new streaming data arrived —
      // propagate the new block to trigger ContentBlockRenderer re-render.
      if (newBlock.type === 'tool_use' && oldBlock.type === 'tool_use') {
        return newBlock.progressBlocks !== oldBlock.progressBlocks ? newBlock : oldBlock
      }
      // Other block types (tool_result, image, document, slash_command):
      // content is immutable once emitted — safe to reuse old reference.
      return oldBlock
    })
    prevBlocksRef.current = stabilized
    return stabilized
  }, [content])

  const toolCallCount = countToolUseBlocks(stableContent)
  const shouldCollapseInMessageTools = toolCallCount >= IN_MESSAGE_TOOL_COLLAPSE_THRESHOLD
  const lastTextBlockIndex = extractLastTextBlockIndex(stableContent)
  const hasToolUseInMessage = toolCallCount > 0
  const textStreaming = isStreaming && !hasToolUseInMessage

  if (!shouldCollapseInMessageTools) {
    return (
      <div data-msg-id={id} data-msg-role="assistant" className="py-0.5 break-words min-w-0">
        {stableContent.map((block, index) => (
          <ContentBlockRenderer
            key={`${block.type}-${index}`}
            block={block}
            sessionId={sessionId}
            isLastTextBlock={index === lastTextBlockIndex}
            isStreaming={textStreaming}
            isMessageStreaming={isStreaming}
            activeToolUseId={activeToolUseId}
          />
        ))}
      </div>
    )
  }

  const segments = splitToolAndNonToolSegments(stableContent)

  return (
    <div data-msg-id={id} data-msg-role="assistant" className="py-0.5 break-words min-w-0">
      {segments.map((segment, segmentIndex) => {
        if (segment.kind === 'tool') {
          const segmentContent = segment.blocks.map(({ block }) => block)
          const segmentToolCallCount = countToolUseBlocks(segmentContent)
          if (segmentToolCallCount < IN_MESSAGE_TOOL_COLLAPSE_THRESHOLD) {
            return (
              <div key={`${id}-tool-segment-raw-${segmentIndex}-${segment.blocks[0]?.index ?? 0}`}>
                {segment.blocks.map(({ block, index }) => (
                  <ContentBlockRenderer
                    key={`${block.type}-${index}`}
                    block={block}
                    sessionId={sessionId}
                    isLastTextBlock={index === lastTextBlockIndex}
                    isStreaming={textStreaming}
                    isMessageStreaming={isStreaming}
                    activeToolUseId={activeToolUseId}
                  />
                ))}
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
            {segment.blocks.map(({ block, index }) => (
              <ContentBlockRenderer
                key={`${block.type}-${index}`}
                block={block}
                sessionId={sessionId}
                isLastTextBlock={index === lastTextBlockIndex}
                isStreaming={textStreaming}
                isMessageStreaming={isStreaming}
                activeToolUseId={activeToolUseId}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/**
 * Bottom padding (px) for the Virtuoso Footer spacer.
 *
 * Virtuoso measures Footer height via ResizeObserver and includes it in the
 * total scroll extent, making this the idiomatic way to add bottom breathing
 * room to a virtualised list.  We use inline styles (not Tailwind classes) to
 * guarantee the spacer is never purged or overridden.
 */
const FOOTER_BASE_PADDING = 24

/**
 * Over-scan buffer — tells Virtuoso to render items this far outside the
 * visible viewport.  Larger top values reduce blank-flash when scrolling up
 * through complex cards; smaller bottom values reduce wasted renders below.
 */
const INCREASE_VIEWPORT_BY = { top: 800, bottom: 200 } as const

/** Session states in which the AskUserQuestion card can accept user input. */
const SENDABLE_STATES: ReadonlySet<ManagedSessionState> = new Set<ManagedSessionState>([
  'idle', 'awaiting_input', 'awaiting_question', 'stopped', 'error',
])

// ---------------------------------------------------------------------------
// Virtuoso context — carries per-instance config to module-level sub-components.
//
// IMPORTANT: Only include props that are used by Scroller/List sub-components
// AND that are stable across session lifecycle changes.  Props that change
// frequently (like footerNode) must use a separate React Context to avoid
// triggering Virtuoso's full item re-render when context changes.
// ---------------------------------------------------------------------------

interface VirtuosoContext {
  variant: MessageListVariant
}

// ---------------------------------------------------------------------------
// Footer node context — dedicated channel for VirtuosoFooter.
//
// Separated from VirtuosoContext because footerNode changes on session
// lifecycle transitions (e.g. Stop Session → ArtifactsSummaryBlock appears)
// while variant is effectively constant after mount.  Bundling them in
// Virtuoso's context prop would cause Virtuoso to re-render ALL visible
// items on every footerNode change — a costly no-op since items don't use
// footerNode.  With a dedicated React Context, only VirtuosoFooter re-renders.
// ---------------------------------------------------------------------------

const FooterNodeContext = createContext<React.ReactNode>(undefined)

// ---------------------------------------------------------------------------
// Virtuoso sub-components — MUST be defined at module level.
//
// CRITICAL: Defining forwardRef components inline inside the render function
// (or inside the components={{...}} object literal) creates a NEW component
// type on every render.  React treats different types as different components:
//   old Scroller (type A) → unmount → new Scroller (type B) → mount
// When the Scroller DOM element is destroyed, scrollTop resets to 0 — the
// list snaps to the top.  This was the root cause of the scroll-to-top bug.
//
// By defining components at module level, the reference is stable across
// renders, so React reuses the existing DOM element and preserves scrollTop.
//
// The `context` prop is injected by Virtuoso from <Virtuoso context={...}>
// and carries instance-specific configuration without closures.
// ---------------------------------------------------------------------------

type VirtuosoSubComponentProps = React.ComponentPropsWithoutRef<'div'> & {
  context?: VirtuosoContext
}

const VirtuosoScroller = forwardRef<HTMLDivElement, VirtuosoSubComponentProps>(
  function VirtuosoScroller({ style, context, ...props }, ref) {
    return (
      <div
        ref={ref}
        style={style}
        {...props}
      />
    )
  }
)

const VirtuosoList = forwardRef<HTMLDivElement, VirtuosoSubComponentProps>(
  function VirtuosoList({ style, context, ...props }, ref) {
    const isChat = context?.variant === 'chat'
    return (
      <div
        ref={ref}
        style={isChat ? {
          ...style,
          maxWidth: 640,
          width: '100%',
          marginLeft: 'auto',
          marginRight: 'auto',
        } : style}
        className="py-2 space-y-0.5 px-3"
        role="list"
        aria-label="Session messages"
        {...props}
      />
    )
  }
)

// Footer — module-level for reference stability (same principle as Scroller/List).
// Uses a dedicated React Context (FooterNodeContext) instead of Virtuoso's context
// prop, so footerNode changes only trigger a Footer re-render — not a full item
// re-render of the entire visible list.
//
// IMPORTANT: Always renders a SINGLE stable <div> regardless of whether footerNode
// is present.  A single div with a stable `paddingBottom` minimises the DOM diff
// when the footer content transitions (e.g. spacer → ArtifactsSummaryBlock).
//
// The paddingBottom (FOOTER_BASE_PADDING) provides visual breathing room below the
// last content element.  The parent Virtuoso container's `bottom` tracks the
// overlay height — so the footer is never hidden behind the floating panel.
//
// NOTE: footerNode is gated by `mountSettled` in the Provider (see render section).
// On mount, the context value is `undefined` for ~3 frames while Virtuoso performs
// its initial measurement cycle.  This prevents the footer content (e.g.
// ArtifactsSummaryBlock) from rendering during layout settling, eliminating the
// visual jitter that would otherwise occur on issue switch.
function VirtuosoFooter() {
  const footerNode = useContext(FooterNodeContext)
  return (
    <div
      className={footerNode ? 'mt-3 px-3' : undefined}
      style={{ paddingBottom: FOOTER_BASE_PADDING }}
      aria-label={footerNode ? 'Session summary' : undefined}
      aria-hidden={footerNode ? undefined : true}
    >
      {footerNode}
    </div>
  )
}

// Stable components object — all references are module-level constants,
// so Virtuoso never sees a component identity change across renders.
const VIRTUOSO_COMPONENTS = {
  Scroller: VirtuosoScroller,
  List: VirtuosoList,
  Footer: VirtuosoFooter,
}

// ---------------------------------------------------------------------------
// SessionMessageList — Virtuoso-powered, zero content-visibility
// ---------------------------------------------------------------------------

/**
 * Renders the session message list using react-virtuoso for efficient
 * rendering of heterogeneous content (text, markdown cards, HTML iframes,
 * todo cards, etc.) without the flicker caused by content-visibility: auto.
 *
 * Scroll behaviour:
 * - **First visit / was at bottom**: auto-scroll to bottom via followOutput.
 * - **Return visit (user had scrolled up)**: restore previous position.
 * - **New messages while at bottom**: auto-scroll to follow (streaming).
 *
 * The parent must set `key={sessionId}` so the component remounts on session
 * switch — giving us a clean state.
 */
export const SessionMessageList = memo(forwardRef<SessionMessageListHandle, SessionMessageListProps>(
function SessionMessageList({ sessionId, messages: externalMessages, sessionState, stopReason, onSendAnswer, variant = 'cli', onContextualQuestionChange, footerNode, issueId }: SessionMessageListProps, ref): React.JSX.Element {
  const { t } = useTranslation('sessions')

  // Default: subscribe to commandStore for real-time streaming messages.
  // When `externalMessages` prop is provided (BrowserSheetChat, ReviewChatPanel),
  // use those instead — they come from non-commandStore sources.
  const storeMessages = useCommandStore((s) => selectSessionMessages(s, sessionId))
  const messages = externalMessages ?? storeMessages

  // NOTE: streaming content subscription is NOT here — it was moved to
  // AssistantMessage (self-subscribing pattern).  During text-only streaming,
  // sessionMessages[sid] stays STABLE, so messageGroups and virtuosoData
  // don't change → Virtuoso never re-iterates visible items → no cascade.
  // Only the single streaming AssistantMessage re-renders via its own
  // useCommandStore(selectStreamingMessage) subscription.
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)

  // State-backed scroller element — triggers useAutoFollow's useEffect when
  // Virtuoso mounts and provides its scroller DOM element.  The ref is kept
  // alongside for synchronous access in scrollToMessage / SessionScrollNav.
  const [scrollerEl, setScrollerEl] = useState<HTMLElement | null>(null)

  // Derive content-active signal from session state: true when the agent is
  // actively producing output (streaming text, creating subprocess, etc.).
  // This gates height-change corrective scrolls in useAutoFollow — see its
  // block comment for the full rationale.
  const isContentGrowing = sessionState === 'streaming' || sessionState === 'creating'

  // Centralized scroll state machine — replaces scattered refs/effects.
  // See useAutoFollow.ts for the state diagram and design rationale.
  const {
    handleFollowOutput,
    handleAtBottomChange,
    handleTotalHeightChanged,
    showScrollToBottom,
    engage: engageFollow,
    disengage: disengageFollow,
    reengageIfBrowsing,
  } = useAutoFollow(virtuosoRef, {
    isContentActive: isContentGrowing,
    scrollerEl,
  })

  // Stable ref for onContextualQuestionChange to avoid re-creating callbacks
  const onContextualQuestionChangeRef = useRef(onContextualQuestionChange)
  useEffect(() => { onContextualQuestionChangeRef.current = onContextualQuestionChange }, [onContextualQuestionChange])

  // ---------------------------------------------------------------------------
  // Task events pipeline — split into two stages with distinct dependencies.
  //
  // Stage 1 (buildTaskLifecycleMap): Scans messages for task_started / task_notification
  //   events and infers completion from message ordering.  Depends ONLY on
  //   `messages` — the `consumedTaskIds` output is fully determined by message
  //   content and is stable across session lifecycle state changes.
  //
  // Stage 2 (resolveTaskFinalStates): Infers terminal states for unresolved
  //   tasks based on session lifecycle.  Depends on the scan result +
  //   `sessionState` + `stopReason`.  Returns the original map reference when
  //   no modifications are needed (referential identity preservation).
  //
  // This two-stage split prevents a reference identity cascade where a
  // sessionState change (e.g. Stop Session) would needlessly recompute
  // consumedTaskIds → messageGroups → Virtuoso re-renders all visible items.
  // ---------------------------------------------------------------------------

  const { map: scannedTaskMap, consumedTaskIds } = useMemo(
    () => buildTaskLifecycleMap(messages),
    [messages],
  )

  const taskEventsMap = useMemo(
    () => resolveTaskFinalStates(scannedTaskMap, sessionState, stopReason),
    [scannedTaskMap, sessionState, stopReason],
  )

  // Build tool lifecycle map: toolUseId → { name, result? }
  // Used by ToolResultBlockView (rich cards) and Widget Tools (result access).
  const toolLifecycleMap = useMemo(() => buildToolLifecycleMap(messages), [messages])

  // Group consecutive tool-only assistant messages into collapsible batches.
  // Depends on `messages` and `consumedTaskIds` — both are stable across
  // sessionState changes, so Stop Session never triggers a recompute here.
  const messageGroups = useMemo(() => {
    const filtered = messages.filter((msg) => {
      if (msg.role === 'system' && isConsumedTaskEvent(msg.event, consumedTaskIds)) return false
      return true
    })
    return groupMessages(filtered)
  }, [messages, consumedTaskIds])

  // ---------------------------------------------------------------------------
  // Virtuoso data — directly uses messageGroups (no streaming fusion).
  //
  // Before Fix 20, this useMemo fused messageGroups with streamingMsg on
  // every frame — causing a new data array → Virtuoso re-iterated all
  // visible items → full cascade.  Now AssistantMessage self-subscribes
  // to the streaming overlay, so messageGroups IS the Virtuoso data.
  //
  // During text-only streaming, sessionMessages[sid] is stable → messages
  // unchanged → messageGroups unchanged → Virtuoso data unchanged →
  // zero iteration, zero cascade.  Only structural changes (new message,
  // new tool_use block) cause messageGroups to change.
  // ---------------------------------------------------------------------------
  const virtuosoData = messageGroups

  // ---------------------------------------------------------------------------
  // Turn-level diff: compute which message ID marks the end of each turn that
  // has file changes.
  //
  // A turn's "View Changes" button should only appear once the turn is fully
  // complete — not while the agent is still executing tool calls within the
  // same turn.
  //
  // Historical turns (followed by a new user message) are always complete.
  // The current (last) turn is complete only when sessionState settles into a
  // non-processing state.
  // ---------------------------------------------------------------------------

  /** Session has finished the current turn and is no longer producing changes. */
  const isTurnSettled = !sessionState
    || sessionState === 'idle'
    || sessionState === 'awaiting_input'
    || sessionState === 'stopped'
    || sessionState === 'error'

  const turnDiffMap = useMemo(() => {
    const map = new Map<string, { turnMessages: ManagedSessionMessage[]; firstMessageId: string; fileCount: number }>()
    let turnMsgs: ManagedSessionMessage[] = []
    let lastAssistantId: string | null = null

    const isVisibleUser = (msg: ManagedSessionMessage): boolean =>
      msg.role === 'user' && msg.content.some(
        (b) =>
          (b.type === 'text' && b.text.trim().length > 0) ||
          b.type === 'image' ||
          b.type === 'document' ||
          b.type === 'slash_command',
      )

    /**
     * Flush accumulated turn messages into the map if the turn has file changes.
     * @param isCurrentTurn - true for the last (potentially in-progress) turn
     */
    const flushTurn = (isCurrentTurn: boolean): void => {
      if (lastAssistantId && turnMsgs.length > 0) {
        const isStreaming = turnMsgs.some((m) => m.role === 'assistant' && m.isStreaming)
        // Historical turns: isStreaming check is sufficient (defensive).
        // Current turn: also require session to have settled — the agent may
        // still execute more tool calls even when no message is streaming.
        const isTurnComplete = isCurrentTurn
          ? !isStreaming && isTurnSettled
          : !isStreaming
        if (isTurnComplete && hasFileChanges(turnMsgs)) {
          map.set(lastAssistantId, {
            turnMessages: turnMsgs,
            firstMessageId: turnMsgs[0].id,
            fileCount: countChangedFiles(turnMsgs),
          })
        }
      }
      turnMsgs = []
      lastAssistantId = null
    }

    for (const msg of messages) {
      if (isVisibleUser(msg)) {
        flushTurn(false) // historical turn — always complete
      } else {
        turnMsgs.push(msg)
        if (msg.role === 'assistant' || msg.role === 'system') {
          lastAssistantId = msg.id
        }
      }
    }
    flushTurn(true) // current (last) turn — depends on session state

    return map
  }, [messages, isTurnSettled])

  // Hold turnDiffMap in a ref so that renderItem's useCallback does not depend
  // on it.  During streaming, `messages` changes ~10×/sec which recomputes
  // turnDiffMap (new Map reference).  If turnDiffMap were a direct useCallback
  // dependency, Virtuoso would re-invoke itemContent for every visible item on
  // every streaming tick.  Reading from a ref instead keeps renderItem stable
  // while still picking up the latest diffs on the next natural re-render.
  const turnDiffMapRef = useRef(turnDiffMap)
  turnDiffMapRef.current = turnDiffMap

  const turnDiffDialog = useDialogState<{ messages: ManagedSessionMessage[]; turnAnchorMessageId: string }>()

  // Extract stable callback — useDialogState returns a new object literal every
  // render, but .show is a useCallback([], []) with stable identity.  Using the
  // extracted reference in renderItem's deps keeps the useCallback effective.
  const showTurnDiffDialog = turnDiffDialog.show

  // Compute interactive AskUserQuestion state
  const askActions = useMemo<AskUserQuestionActions | null>(() => {
    if (!sessionState || !onSendAnswer) return null
    const canAccept = SENDABLE_STATES.has(sessionState)
    return {
      sendAnswer: (text: string) => onSendAnswer(text),
      canAcceptInput: canAccept
    }
  }, [sessionState, onSendAnswer])

  // ---------------------------------------------------------------------------
  // Scroll navigation anchors — grouped by conversation turn
  // ---------------------------------------------------------------------------
  const navAnchors = useMemo<NavAnchor[]>(() => {
    const MAX_PREVIEW = 80
    const truncateText = (s: string): string => unicodeTruncate(s, { max: MAX_PREVIEW })

    const anchors: NavAnchor[] = []
    let inAssistantTurn = false

    for (const msg of messages) {
      if (msg.role === 'user') {
        inAssistantTurn = false
        const text = extractUserText(msg.content).trim()
        const slashNames = joinSlashDisplays(
          msg.content.filter((b): b is SlashCommandBlock => b.type === 'slash_command'),
        )
        const hasMedia = msg.content.some((b) => b.type === 'image' || b.type === 'document')
        const hasSlashCmd = slashNames.length > 0
        if (!text && !hasMedia && !hasSlashCmd) continue
        anchors.push({
          msgId: msg.id,
          role: 'user',
          preview: truncateText(hasSlashCmd ? `${slashNames} ${text}`.trim() : text || '(attachment)'),
        })
      } else if (msg.role === 'assistant' && !inAssistantTurn) {
        inAssistantTurn = true
        const textBlock = msg.content.find((b) => b.type === 'text')
        const text = textBlock?.type === 'text' ? textBlock.text.trim() : ''
        anchors.push({
          msgId: msg.id,
          role: 'assistant',
          preview: truncateText(text || '(working\u2026)'),
        })
      }
    }
    return anchors
  }, [messages])

  // ---------------------------------------------------------------------------
  // Active anchor tracking — uses Virtuoso's rangeChanged instead of
  // IntersectionObserver.  Native to virtualization, zero DOM observation.
  // ---------------------------------------------------------------------------
  const [activeNavId, setActiveNavId] = useState<string | null>(null)

  // Build a lookup: msgId → navAnchor (for fast matching in rangeChanged)
  const navAnchorSet = useMemo(
    () => new Set(navAnchors.map((a) => a.msgId)),
    [navAnchors],
  )

  /** Extract the first message ID from a MessageGroup */
  const getGroupMsgId = useCallback((group: MessageGroup): string =>
    group.type === 'tool_batch' ? group.messages[0]?.id : group.message.id,
    []
  )

  const handleRangeChanged = useCallback(({ startIndex, endIndex }: ListRange) => {
    // Walk from startIndex to find the first group whose msgId is a nav anchor.
    // This represents the topmost visible conversation turn — the most intuitive
    // "you are here" indicator when scrolling.
    for (let i = startIndex; i <= endIndex && i < messageGroups.length; i++) {
      const msgId = getGroupMsgId(messageGroups[i])
      if (navAnchorSet.has(msgId)) {
        // Low-priority update — this fires on every scroll frame but is purely
        // cosmetic (nav highlight + banner text).  startTransition tells React
        // to defer the re-render so it never blocks the scroll animation.
        startTransition(() => { setActiveNavId(msgId) })
        return
      }
    }
  }, [messageGroups, navAnchorSet, getGroupMsgId])

  // ---------------------------------------------------------------------------
  // Contextual question — derived from the active nav anchor
  // ---------------------------------------------------------------------------
  const contextualUserInfo = useMemo<{ text: string | null; msgId: string | null }>(() => {
    if (!activeNavId || navAnchors.length === 0) return { text: null, msgId: null }

    const activeIdx = navAnchors.findIndex((a) => a.msgId === activeNavId)
    if (activeIdx === -1) return { text: null, msgId: null }

    let userAnchorIdx = activeIdx
    if (navAnchors[activeIdx].role === 'assistant') {
      for (let i = activeIdx - 1; i >= 0; i--) {
        if (navAnchors[i].role === 'user') {
          userAnchorIdx = i
          break
        }
      }
      if (navAnchors[userAnchorIdx].role !== 'user') return { text: null, msgId: null }
    }

    const userMsgId = navAnchors[userAnchorIdx].msgId
    const msg = messages.find((m) => m.id === userMsgId)
    if (!msg || msg.role !== 'user') return { text: null, msgId: null }

    const text = extractUserText(msg.content).trim()
    const slashNames = joinSlashDisplays(
      msg.content.filter((b): b is SlashCommandBlock => b.type === 'slash_command'),
    )
    const hasMedia = msg.content.some((b) => b.type === 'image' || b.type === 'document')

    let displayText: string | null = null
    if (text) displayText = slashNames ? `${slashNames} ${text}`.trim() : text
    else if (slashNames) displayText = slashNames
    else if (hasMedia) displayText = '(attachment)'

    return { text: displayText, msgId: userMsgId }
  }, [activeNavId, navAnchors, messages])

  // Notify parent whenever the contextual question changes
  useEffect(() => {
    onContextualQuestionChangeRef.current?.({
      text: contextualUserInfo.text,
      msgId: contextualUserInfo.msgId,
    })
  }, [contextualUserInfo.text, contextualUserInfo.msgId])

  // ---------------------------------------------------------------------------
  // Scroll triggers — domain-specific events that drive the state machine.
  // All timing and state management is handled by useAutoFollow.
  // ---------------------------------------------------------------------------

  // Mount: instant scroll to bottom so the user sees the latest content.
  const hasMountScrolledRef = useRef(false)
  useEffect(() => {
    if (hasMountScrolledRef.current || messageGroups.length === 0) return
    hasMountScrolledRef.current = true
    engageFollow('instant')
  }, [messageGroups.length, engageFollow])

  // Mount settling gate — delays footer content (ArtifactsSummaryBlock) while
  // Virtuoso performs its initial item measurement cycle (ResizeObserver →
  // re-measure → internal scroll adjustment).  Without this delay, the footer
  // would render during Virtuoso's settling phase, and layout shifts during
  // measurement would cause the block to visually jitter.
  //
  // Timing: engage('instant') uses double-rAF.  We wait one extra rAF
  // (triple-rAF total) so Virtuoso's measurements have fully propagated
  // before footer content appears.
  const [mountSettled, setMountSettled] = useState(false)
  useEffect(() => {
    let cancelled = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setMountSettled(true)
        })
      })
    })
    return () => { cancelled = true }
  }, [])

  // New user message: re-engage follow if the user had scrolled up (browsing).
  //
  // If already in 'following' state, this is a no-op — Virtuoso's `followOutput`
  // has already returned 'auto' for this data change and initiated an instant
  // scroll.  Calling `engageFollow('smooth')` here would issue a SECOND scroll
  // (via scrollToAbsoluteBottom, double-rAF delayed) that competes and
  // suppresses `handleTotalHeightChanged` corrective scrolls via
  // `ENGAGE_FLIGHT_MS`.  Skipping it lets both mechanisms cooperate.
  //
  // If in 'browsing' state (user had scrolled up), `followOutput` returned
  // `false` so no Virtuoso scroll was initiated.  We need `engage()` to
  // transition to 'following' and issue the scroll manually.
  const userMsgCountRef = useRef(messages.filter((m) => m.role === 'user').length)
  useEffect(() => {
    const count = messages.filter((m) => m.role === 'user').length
    if (count > userMsgCountRef.current) {
      reengageIfBrowsing('smooth')
    }
    userMsgCountRef.current = count
  }, [messages, reengageIfBrowsing])

  // ---------------------------------------------------------------------------
  // Imperative scroll API
  // ---------------------------------------------------------------------------
  const scrollToBottom = useCallback(() => engageFollow('smooth'), [engageFollow])

  const scrollToTop = useCallback(() => {
    // Disengage follow mode BEFORE scrolling, otherwise handleTotalHeightChanged
    // and handleFollowOutput will fight the scroll back to bottom.
    disengageFollow()
    virtuosoRef.current?.scrollToIndex({ index: 0, behavior: 'smooth', align: 'start' })
  }, [disengageFollow, virtuosoRef])

  const scrollToMessage = useCallback((msgId: string) => {
    // Find the group index containing this message
    const groupIndex = messageGroups.findIndex((group) => {
      if (group.type === 'tool_batch') {
        return group.messages.some((m) => m.id === msgId)
      }
      return group.message.id === msgId
    })

    if (groupIndex >= 0) {
      // Disengage follow mode before scrolling — otherwise handleTotalHeightChanged
      // stays in 'following' and fights the anchor scroll back to bottom.
      disengageFollow()
      // Use 'auto' (instant) instead of 'smooth' — Virtuoso's smooth scroll
      // commits to a target position based on **estimated** item heights.
      // For off-screen items with variable content, the estimate can drift,
      // causing the target message to land off-screen or mid-viewport instead
      // of at the top.  Instant scroll lets Virtuoso render the target area
      // first and measure real heights before positioning, so alignment is
      // pixel-perfect.  The scroll-flash highlight provides visual feedback.
      virtuosoRef.current?.scrollToIndex({ index: groupIndex, behavior: 'auto', align: 'start' })
    }

    // After scrolling, apply highlight flash on the target element.
    // Instant scroll needs only a single rAF for Virtuoso to render the
    // target area before we query the DOM for the highlight target.
    const SCROLL_SETTLE_MS = 50
    setTimeout(() => {
      const scroller = scrollerRef.current
      if (!scroller) return
      const target = scroller.querySelector<HTMLElement>(`[data-msg-id="${msgId}"]`)
      if (!target) return

      target.classList.remove('scroll-flash')
      void target.offsetWidth
      target.classList.add('scroll-flash')
      const cleanup = () => { target.classList.remove('scroll-flash') }
      target.addEventListener('animationend', cleanup, { once: true })
      setTimeout(cleanup, 1500)
    }, SCROLL_SETTLE_MS)
  }, [messageGroups, disengageFollow])

  useImperativeHandle(ref, () => ({ scrollToBottom, scrollToMessage }), [scrollToBottom, scrollToMessage])

  // ---------------------------------------------------------------------------
  // Virtuoso item renderer
  // ---------------------------------------------------------------------------
  const renderItem = useCallback((index: number, group: MessageGroup) => {
    let tailMsgId: string | undefined
    let element: React.ReactNode

    if (group.type === 'tool_batch') {
      tailMsgId = group.messages[group.messages.length - 1].id
      element = (
        <ToolBatchCollapsible
          key={`batch-${group.messages[0].id}`}
          messages={group.messages}
          sessionId={sessionId}
        />
      )
    } else {
      const msg = group.message
      tailMsgId = msg.id
      switch (msg.role) {
        case 'user': {
          const uText = extractUserText(msg.content).trim()
          const hasMedia = msg.content.some((b) => b.type === 'image' || b.type === 'document')
          const hasSlashCmd = msg.content.some((b) => b.type === 'slash_command')
          if (!uText && !hasMedia && !hasSlashCmd) {
            element = null
            tailMsgId = undefined
          } else {
            element = variant === 'chat'
              ? <ChatBubbleUserMessage key={msg.id} id={msg.id} content={msg.content} />
              : <UserMessage key={msg.id} id={msg.id} content={msg.content} />
          }
          break
        }
        case 'assistant':
          element = (
            <AssistantMessage
              key={msg.id}
              message={msg}
              sessionId={sessionId}
            />
          )
          break
        case 'system':
          element = <SystemEventView key={msg.id} event={msg.event} />
          break
      }
    }

    // Check if this group's tail message marks the end of a turn with changes.
    // Read from ref to avoid turnDiffMap being a useCallback dependency — see
    // the turnDiffMapRef comment above for rationale.
    const currentTurnDiffMap = turnDiffMapRef.current
    const turnDiff = tailMsgId ? currentTurnDiffMap.get(tailMsgId) : undefined

    if (!turnDiff) return element

    return (
      <div key={`turn-diff-wrap-${tailMsgId}`}>
        {element}
        <div className="py-1 pl-0.5">
          <button
            onClick={() => showTurnDiffDialog({ messages: turnDiff.turnMessages, turnAnchorMessageId: turnDiff.firstMessageId })}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] bg-[hsl(var(--muted)/0.5)] hover:bg-[hsl(var(--muted))] rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
            aria-label={`View ${turnDiff.fileCount} changed file${turnDiff.fileCount !== 1 ? 's' : ''} in this turn`}
          >
            <GitCompare className="w-3 h-3" aria-hidden="true" />
            <span>View Changes</span>
            <span className="text-[hsl(var(--muted-foreground)/0.5)] font-mono">
              {turnDiff.fileCount} file{turnDiff.fileCount !== 1 ? 's' : ''}
            </span>
          </button>
        </div>
      </div>
    )
  }, [variant, sessionId, showTurnDiffDialog])

  // Initial scroll position — always start at the last item so the first
  // paint shows content near the bottom, minimising visual flash before the
  // mount-time safeguard scrolls to the absolute bottom.
  const initialTopMostItemIndex = useMemo(
    () => messageGroups.length > 0 ? messageGroups.length - 1 : 0,
    [], // eslint-disable-line react-hooks/exhaustive-deps -- only on mount
  )

  // Stable Virtuoso context — passes instance-specific config to module-level
  // sub-components (Scroller, List) without closures.
  //
  // footerNode is intentionally NOT included here — it uses FooterNodeContext
  // instead.  This keeps virtuosoContext stable across session lifecycle
  // changes, preventing Virtuoso from re-rendering all visible items when
  // only the footer content changes (e.g. Stop Session).
  const virtuosoContext = useMemo<VirtuosoContext>(
    () => ({ variant }),
    [variant],
  )

  // Stable item key — lets Virtuoso track items by identity across data changes
  // instead of relying on array index (which shifts when items are filtered/added).
  const computeItemKey = useCallback((_index: number, group: MessageGroup) => {
    return group.type === 'tool_batch'
      ? `batch-${group.messages[0].id}`
      : `${group.message.role}-${group.message.id}`
  }, [])

  // Stable scrollerRef callback — updates both the ref (for synchronous access)
  // and the state (to trigger useAutoFollow's event-listener setup).
  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    const htmlEl = (el as HTMLElement) ?? null
    scrollerRef.current = htmlEl
    setScrollerEl(htmlEl)
  }, [])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <FooterNodeContext.Provider value={mountSettled ? footerNode : undefined}>
    <ToolLifecycleProvider value={toolLifecycleMap}>
    <TaskEventsProvider value={taskEventsMap}>
      <AskUserQuestionProvider value={askActions}>
        {/* Outer div fills the absolute-inset-0 wrapper set by SessionPanel.
            Uses h-full (not flex-1) because its parent is absolutely positioned
            and already occupies the full scroll area. */}
        <div className="relative h-full">
          <Virtuoso
            ref={virtuosoRef}
            data={virtuosoData}
            context={virtuosoContext}
            computeItemKey={computeItemKey}
            itemContent={renderItem}
            followOutput={handleFollowOutput}
            atBottomStateChange={handleAtBottomChange}
            totalListHeightChanged={handleTotalHeightChanged}
            atBottomThreshold={40}
            rangeChanged={handleRangeChanged}
            initialTopMostItemIndex={initialTopMostItemIndex}
            increaseViewportBy={INCREASE_VIEWPORT_BY}
            scrollerRef={handleScrollerRef}
            style={{ height: '100%' }}
            components={VIRTUOSO_COMPONENTS}
          />

          {/* Scroll navigation anchor bar */}
          <SessionScrollNav
            anchors={navAnchors}
            activeId={activeNavId}
            onScrollToMessage={scrollToMessage}
            onScrollToTop={scrollToTop}
            onScrollToBottom={scrollToBottom}
          />

          {/* Scroll-to-bottom button — always mounted, visibility via CSS opacity.
              Avoids DOM mount/unmount during scroll which causes micro-jank.
              Hidden when nav bar is visible (it has its own ⬇ affordance).
              Position accounts for overlay inset so the button stays above the floating panel. */}
          <button
            onClick={scrollToBottom}
            className={cn(
              'absolute right-3 w-7 h-7 rounded-full bg-[hsl(var(--muted))] border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))] shadow-sm flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              'transition-opacity duration-150',
              showScrollToBottom && navAnchors.length <= 2
                ? 'opacity-100'
                : 'opacity-0 pointer-events-none',
            )}
            style={{ bottom: 12 }}
            aria-label="Scroll to bottom"
            aria-hidden={!showScrollToBottom || navAnchors.length > 2}
            tabIndex={showScrollToBottom && navAnchors.length <= 2 ? 0 : -1}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          {/* Per-turn diff dialog */}
          {turnDiffDialog.data && (
            <DiffChangesDialog
              open={turnDiffDialog.open}
              onClose={turnDiffDialog.close}
              messages={turnDiffDialog.data.messages}
              title={t('diffChanges.turnChanges')}
              reviewContext={
                issueId
                  ? {
                      issueId,
                      sessionId,
                      scope: { type: 'turn', turnAnchorMessageId: turnDiffDialog.data.turnAnchorMessageId },
                    }
                  : undefined
              }
            />
          )}
        </div>
      </AskUserQuestionProvider>
    </TaskEventsProvider>
    </ToolLifecycleProvider>
    </FooterNodeContext.Provider>
  )
}))
