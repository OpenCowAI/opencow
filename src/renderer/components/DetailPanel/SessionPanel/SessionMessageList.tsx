// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useCallback, useMemo, useState, startTransition, memo, forwardRef, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso, type VirtuosoHandle, type ListRange } from 'react-virtuoso'
import { ArrowDown, GitCompare } from 'lucide-react'
import { UserMessage, ChatBubbleUserMessage } from './MessageRenderers'
import { AssistantMessage } from './AssistantMessage'
import { INCREASE_VIEWPORT_BY, FooterNodeContext, VIRTUOSO_COMPONENTS } from './VirtuosoShell'
import type { VirtuosoContext, MessageListVariant } from './VirtuosoShell'
import { SystemEventView } from './SystemEventView'
import { TaskEventsProvider, buildTaskLifecycleMap, resolveTaskFinalStates, isConsumedTaskEvent } from './TaskWidgets'
import { ToolLifecycleProvider } from './ToolLifecycleContext'
import type { ToolLifecycle, ToolLifecycleMap } from './ToolLifecycleContext'
import { ToolBatchCollapsible, isBatchableToolMessage, MIN_BATCH_SIZE } from './ToolBatchCollapsible'
import type { MessageGroup } from './ToolBatchCollapsible'
import { SessionScrollNav } from './SessionScrollNav'
import type { NavAnchor } from './SessionScrollNav'
import type { SessionDraftFooterConfig } from './sessionDraftFooterTypes'
import {
  AskUserQuestionProvider
} from './AskUserQuestionWidgets'
import type { AskUserQuestionActions } from './AskUserQuestionWidgets'
import { DiffChangesDialog } from './DiffChangesDialog'
import { useAutoFollow } from '@/hooks/useAutoFollow'
import { useTurnDiffs } from '@/hooks/useTurnDiffs'
import { useIncrementalMemo } from '@/hooks/useIncrementalMemo'
import { cn } from '@/lib/utils'
import { perfEnabled, perfLog } from '@/lib/perfLogger'
import { useCommandStore, selectSessionMessages } from '@/stores/commandStore'
import { useSessionInlineDraftCard } from '@/hooks/useSessionInlineDraftCard'
import type { ManagedSessionMessage, ManagedSessionState, SessionStopReason, UserMessageContent, ContentBlock } from '@shared/types'
import { truncate as unicodeTruncate } from '@shared/unicode'
import { extractUserText, getUserMessageDisplayInfo } from './messageDisplayUtils'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

// Re-export from VirtuosoShell (canonical definition) for backward compatibility.
export type { MessageListVariant } from './VirtuosoShell'

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
  /**
   * Optional session draft footer configuration. When provided, the list parses
   * the latest issue/schedule draft once from current messages and renders the
   * unified SessionDraftFooter inline after messages.
   */
  sessionDraftFooterConfig?: SessionDraftFooterConfig
  /** Issue ID — forwarded to DiffChangesDialog for the review chat feature */
  issueId?: string
}

// ---------------------------------------------------------------------------
// Helpers — reference stabilization
// ---------------------------------------------------------------------------

/** Stable empty Set for consumedTaskIds initial state. */
const EMPTY_CONSUMED_IDS: ReadonlySet<string> = new Set()

/** Check if every element of `a` is in `b`. O(|a|). */
function setIsSubset(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Incremental processors — stable module-level functions for useIncrementalMemo.
// Must NOT capture component scope (no closures) to maintain reference stability.
// ---------------------------------------------------------------------------

/** Incremental processor: scan new messages for tool_use blocks → ToolLifecycleMap. */
function scanToolLifecycle(
  newMsgs: readonly ManagedSessionMessage[],
  prev: ToolLifecycleMap,
  _allMsgs: readonly ManagedSessionMessage[],
): ToolLifecycleMap {
  let next: Map<string, ToolLifecycle> | null = null
  for (const msg of newMsgs) {
    if (msg.role === 'system') continue
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        if (!next) next = new Map(prev) // copy-on-write
        next.set(block.id, { name: block.name })
      }
    }
  }
  return next ?? prev
}

/** Factory for empty ToolLifecycleMap — stable reference for useIncrementalMemo init. */
const INIT_TOOL_MAP = (): ToolLifecycleMap => new Map()

/** Accumulator for incremental navAnchors — carries scanning state across calls. */
interface NavAnchorAccumulator {
  anchors: NavAnchor[]
  inAssistantTurn: boolean
}

const NAV_PREVIEW_MAX = 80

/** Incremental processor: scan new messages for user/assistant turn boundaries. */
function scanNavAnchors(
  newMsgs: readonly ManagedSessionMessage[],
  prev: NavAnchorAccumulator,
  _allMsgs: readonly ManagedSessionMessage[],
): NavAnchorAccumulator {
  let next = prev
  let { inAssistantTurn } = prev

  for (const msg of newMsgs) {
    if (msg.role === 'user') {
      inAssistantTurn = false
      const info = getUserMessageDisplayInfo(msg.content)
      if (info.isEmpty) continue
      if (next === prev) next = { ...prev, anchors: [...prev.anchors] } // copy-on-write
      next.anchors.push({
        msgId: msg.id,
        role: 'user',
        preview: unicodeTruncate(info.displayText ?? '', { max: NAV_PREVIEW_MAX }),
      })
    } else if (msg.role === 'assistant' && !inAssistantTurn) {
      inAssistantTurn = true
      const textBlock = msg.content.find((b) => b.type === 'text')
      const text = textBlock?.type === 'text' ? textBlock.text.trim() : ''
      if (next === prev) next = { ...prev, anchors: [...prev.anchors] }
      next.anchors.push({
        msgId: msg.id,
        role: 'assistant',
        preview: unicodeTruncate(text || '(working\u2026)', { max: NAV_PREVIEW_MAX }),
      })
    }
  }

  // Update scanning state even if no new anchors were added
  if (inAssistantTurn !== prev.inAssistantTurn) {
    if (next === prev) next = { ...prev }
    next.inAssistantTurn = inAssistantTurn
  }
  return next
}

/** Factory for empty NavAnchorAccumulator. */
const INIT_NAV_ANCHORS_ACC = (): NavAnchorAccumulator => ({ anchors: [], inAssistantTurn: false })

// ---------------------------------------------------------------------------
// Message components — extracted to MessageRenderers.tsx and AssistantMessage.tsx
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Session states in which the AskUserQuestion card can accept user input. */
const SENDABLE_STATES: ReadonlySet<ManagedSessionState> = new Set<ManagedSessionState>([
  'idle', 'awaiting_input', 'awaiting_question', 'stopped', 'error',
])

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
function SessionMessageList({
  sessionId,
  messages: externalMessages,
  sessionState,
  stopReason,
  onSendAnswer,
  variant = 'cli',
  onContextualQuestionChange,
  footerNode,
  sessionDraftFooterConfig,
  issueId
}: SessionMessageListProps, ref): React.JSX.Element {
  // ── Perf: measure full render cycle of this component ──────────────
  const _renderT0 = perfEnabled() ? performance.now() : 0

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

  const inlineDraftCard = useSessionInlineDraftCard(
    messages,
    sessionId,
    sessionDraftFooterConfig
  )

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

  // ── consumedTaskIds reference stabilization ──────────────────────
  // buildTaskLifecycleMap creates a NEW Set every call, even when its
  // content hasn't changed. This causes messageGroups' useMemo to see
  // a dependency change → filter + groupMessages full rebuild (~2-5ms)
  // on EVERY structural message change, even when no new task events
  // arrived.
  //
  // Fix: compare the new Set's content with the previous one. If equal,
  // reuse the old reference → messageGroups useMemo skips entirely.
  // consumedTaskIds is append-only (task IDs only get added), so a
  // size check + subset check is sufficient for equality.
  const prevConsumedIdsRef = useRef<ReadonlySet<string>>(EMPTY_CONSUMED_IDS)

  const { map: scannedTaskMap, consumedTaskIds: rawConsumedIds } = useMemo(
    () => buildTaskLifecycleMap(messages),
    [messages],
  )

  // Reference stabilization: reuse previous Set when content unchanged.
  // Keeps both useMemos side-effect-free; ref update is render-time sync.
  const consumedTaskIds = useMemo(() => {
    const prev = prevConsumedIdsRef.current
    if (
      rawConsumedIds.size === prev.size &&
      (prev.size === 0 || setIsSubset(prev, rawConsumedIds))
    ) {
      return prev
    }
    return rawConsumedIds
  }, [rawConsumedIds])
  prevConsumedIdsRef.current = consumedTaskIds

  const taskEventsMap = useMemo(
    () => resolveTaskFinalStates(scannedTaskMap, sessionState, stopReason),
    [scannedTaskMap, sessionState, stopReason],
  )

  // Build tool lifecycle map: toolUseId → { name }
  // Incremental: O(delta) via useIncrementalMemo — only scans new messages.
  const toolLifecycleMap = useIncrementalMemo<ManagedSessionMessage, ToolLifecycleMap>(
    messages,
    sessionId,
    scanToolLifecycle,
    INIT_TOOL_MAP,
  )

  // ---------------------------------------------------------------------------
  // RC3: Incremental messageGroups — O(delta) per append instead of O(N).
  //
  // The old useMemo ran groupMessages(filter(messages)) on every messages
  // change — O(N) full scan producing a new array → Virtuoso re-iterates all
  // visible items.  Now we use useIncrementalMemo: only newly appended
  // messages are processed, and the "pending tail" (batchable messages at the
  // end that might merge with future appends) is tracked across renders.
  //
  // consumedTaskIds changes (rare — only on task_started/task_notification)
  // trigger a full rebuild via resetKey rotation.
  // ---------------------------------------------------------------------------

  // Track consumedTaskIds identity changes → bump version for resetKey.
  const consumedIdsVersionRef = useRef(0)
  const prevConsumedIdsForGroupRef = useRef(consumedTaskIds)
  if (prevConsumedIdsForGroupRef.current !== consumedTaskIds) {
    consumedIdsVersionRef.current++
    prevConsumedIdsForGroupRef.current = consumedTaskIds
  }
  // Stable ref so the processor callback can read latest value without
  // changing its own reference identity (keeps useIncrementalMemo stable).
  const consumedIdsRef = useRef(consumedTaskIds)
  consumedIdsRef.current = consumedTaskIds

  const groupResetKey = `${sessionId}:${consumedIdsVersionRef.current}`

  /**
   * Incremental result shape:
   * - `groups`: complete MessageGroup[] ready for Virtuoso (includes flushed tail)
   * - `pendingTailGroupCount`: how many groups at the end of `groups` came from
   *   a force-flushed pending batch.  On next append these are "reopened" and
   *   re-evaluated together with the new delta.
   */
  type IncrementalGroupResult = {
    groups: MessageGroup[]
    pendingTailGroupCount: number
  }

  const incrementalGroupProcessor = useCallback(
    (newMsgs: readonly ManagedSessionMessage[], prev: IncrementalGroupResult): IncrementalGroupResult => {
      const _gT0 = perfEnabled() ? performance.now() : 0

      // Filter consumed task events from the delta
      const filtered = newMsgs.filter((msg) => {
        if (msg.role === 'system' && isConsumedTaskEvent(msg.event, consumedIdsRef.current)) return false
        return true
      })
      if (filtered.length === 0) return prev // copy-on-write: no change

      // --- Reopen the pending tail from previous result ---
      const reopenedPending: ManagedSessionMessage[] = []
      let baseGroups: MessageGroup[]

      if (prev.pendingTailGroupCount > 0) {
        baseGroups = prev.groups.slice(0, -prev.pendingTailGroupCount)
        for (let i = prev.groups.length - prev.pendingTailGroupCount; i < prev.groups.length; i++) {
          const g = prev.groups[i]
          if (g.type === 'single') reopenedPending.push(g.message)
          else if (g.type === 'tool_batch') reopenedPending.push(...g.messages)
        }
      } else {
        baseGroups = prev.groups
      }

      // --- Process: reopened pending + new filtered messages ---
      const toProcess = reopenedPending.length > 0 ? [...reopenedPending, ...filtered] : filtered
      const committedGroups: MessageGroup[] = []
      let pendingBatch: ManagedSessionMessage[] = []

      const flushBatch = (): void => {
        if (pendingBatch.length >= MIN_BATCH_SIZE) {
          committedGroups.push({ type: 'tool_batch', messages: [...pendingBatch] })
        } else {
          for (const m of pendingBatch) {
            committedGroups.push({ type: 'single', message: m })
          }
        }
        pendingBatch = []
      }

      for (const msg of toProcess) {
        if (isBatchableToolMessage(msg)) {
          pendingBatch.push(msg)
        } else {
          flushBatch()
          committedGroups.push({ type: 'single', message: msg })
        }
      }

      // --- Flush trailing pending batch into tail groups ---
      // These will be "reopened" on the next append.
      const tailStart = committedGroups.length
      flushBatch()
      const pendingTailGroupCount = committedGroups.length - tailStart

      const result = {
        groups: [...baseGroups, ...committedGroups],
        pendingTailGroupCount,
      }
      if (_gT0) perfLog('groupMessages:incremental', performance.now() - _gT0, {
        delta: newMsgs.length,
        filtered: filtered.length,
        reopened: reopenedPending.length,
        baseGroups: baseGroups.length,
        newGroups: committedGroups.length,
        totalGroups: result.groups.length,
      })
      return result
    },
    [], // stable — uses consumedIdsRef internally
  )

  const incrementalGroupInit = useCallback(
    (): IncrementalGroupResult => ({ groups: [], pendingTailGroupCount: 0 }),
    [],
  )

  const { groups: messageGroups } = useIncrementalMemo<ManagedSessionMessage, IncrementalGroupResult>(
    messages,
    groupResetKey,
    incrementalGroupProcessor,
    incrementalGroupInit,
  )

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
  // Turn-level diff — extracted to useTurnDiffs hook.
  // Computes which turns have file changes and manages the diff dialog state.
  // ---------------------------------------------------------------------------
  const { turnDiffMapRef, turnDiffDialog, showTurnDiffDialog } = useTurnDiffs(messages, sessionState)

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
  // Incremental: O(delta) via useIncrementalMemo.
  // ---------------------------------------------------------------------------
  const navAnchorsResult = useIncrementalMemo<ManagedSessionMessage, NavAnchorAccumulator>(
    messages,
    sessionId,
    scanNavAnchors,
    INIT_NAV_ANCHORS_ACC,
  )
  const navAnchors = navAnchorsResult.anchors

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

    const { displayText } = getUserMessageDisplayInfo(msg.content)
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
          if (getUserMessageDisplayInfo(msg.content).isEmpty) {
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
          if (inlineDraftCard && inlineDraftCard.messageId === msg.id) {
            element = (
              <>
                {element}
                {inlineDraftCard.node}
              </>
            )
          }
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
  }, [
    variant,
    sessionId,
    showTurnDiffDialog,
    inlineDraftCard,
  ])

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

  // ── Perf: log total render (hooks + JSX creation) ────────────────
  if (_renderT0) {
    const dt = performance.now() - _renderT0
    perfLog('render:SessionMessageList', dt, {
      messages: messages.length,
      groups: messageGroups.length,
      virtuosoItems: virtuosoData.length,
    })
  }

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
