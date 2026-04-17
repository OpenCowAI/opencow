// SPDX-License-Identifier: Apache-2.0

/**
 * BrowserSheetChat — Agent chat panel inside the browser overlay.
 *
 * Adapts the BrowserAgentChat logic to read from appStore's browserOverlay
 * instead of the standalone browserStore.
 *
 * Two modes based on BrowserSource:
 * - linked-session: routes messages to existing session
 * - standalone: creates new browser-agent session on first message
 *
 * ## Session Data Architecture
 *
 * Agent session data (state, activity, error, messages) is canonical in `commandStore`.
 * This component reads from `commandStore.sessionById[agentSessionId]`, falling back
 * to overlay's `agentState` only during the brief optimistic "creating" window.
 *
 * Messages use the `useSessionMessages` hook which handles lazy-loading + subscription.
 * Queue support uses the `useMessageQueue` hook for follow-up messages during streaming.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Link, Trash2, RotateCcw } from 'lucide-react'
import { useCommandStore } from '@/stores/commandStore'
import { useBrowserOverlayStore } from '@/stores/browserOverlayStore'
import { SessionMessageList } from '../DetailPanel/SessionPanel/SessionMessageList'
import { SessionInputBar } from '../DetailPanel/SessionPanel/SessionInputBar'
import { StreamingFooter } from '../DetailPanel/SessionPanel/StreamingFooter'
import { QueuedMessageList } from '../DetailPanel/SessionPanel/QueuedMessageList'
import { ContentViewerProvider } from '../DetailPanel/SessionPanel/ContentViewerContext'
import { ConnectedContentViewer } from '../DetailPanel/SessionPanel/ConnectedContentViewer'
import { SessionStateIndicator } from '../DetailPanel/SessionStatusCard'
import { useSessionMessages } from '@/hooks/useSessionMessages'
import { useMessageQueue } from '@/hooks/useMessageQueue'
import type { BrowserSource, BrowserPageInfoPayload, ManagedSessionState, UserMessageContent } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ─── System Prompt (standalone mode only) ────────────────────────────────

const BROWSER_AGENT_SYSTEM_PROMPT = `You are a browser automation assistant embedded in OpenCow.
Your job is to help users navigate and interact with web pages using the available browser tools.

Guidelines:
- Be concise in your responses — no need for lengthy explanations
- When performing actions, use the browser tools and report what happened
- If a CSS selector fails, try alternative selectors (by ID, class, attribute, or text content)
- Use browser_extract to understand page content before taking complex actions
- After navigation or actions, briefly confirm the result
- For multi-step tasks, execute them sequentially and report progress
- When the user asks to find something, use browser_extract first, then act on the results`

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Resolve chat mode from BrowserSource */
function resolveChatMode(source: BrowserSource):
  | { mode: 'linked'; sessionId: string }
  | { mode: 'standalone' }
{
  switch (source.type) {
    case 'issue-session':
      return { mode: 'linked', sessionId: source.sessionId }
    case 'chat-session':
      return { mode: 'linked', sessionId: source.sessionId }
    case 'issue-standalone':
    case 'standalone':
      return { mode: 'standalone' }
  }
}

/** Prepend current page context to a new session's initial prompt. */
function withPageContext(
  message: UserMessageContent,
  pageInfo: BrowserPageInfoPayload | null
): UserMessageContent {
  if (!pageInfo) return message
  const ctx = `[Current page: ${pageInfo.url} — "${pageInfo.title}"]\n\n`
  if (typeof message === 'string') return ctx + message
  return [{ type: 'text', text: ctx }, ...message]
}

/**
 * Read canonical session data from commandStore, with overlay's optimistic
 * `agentState` as fallback for the brief window before the session is registered.
 */
function useAgentSessionData(agentSessionId: string | null): {
  state: ManagedSessionState | null
  activity: string | null
  error: string | null
} {
  // Narrow selectors: extract only the 3 fields actually used, so unrelated
  // metadata changes (tokens, cost, duration) in the SessionSnapshot don't
  // trigger re-renders of the entire BrowserSheetChat tree.
  const sessionState = useCommandStore((s) =>
    agentSessionId ? (s.sessionById[agentSessionId]?.state ?? null) : null,
  )
  const sessionActivity = useCommandStore((s) =>
    agentSessionId ? (s.sessionById[agentSessionId]?.activity ?? null) : null,
  )
  const sessionError = useCommandStore((s) =>
    agentSessionId ? (s.sessionById[agentSessionId]?.error ?? null) : null,
  )
  // Optimistic fallback: overlay's agentState covers the gap between
  // command:start-session IPC and command:session:created DataBus event.
  const optimisticState = useBrowserOverlayStore(
    (s) => s.browserOverlay?.agentState ?? null,
  )

  return {
    state: sessionState ?? optimisticState,
    activity: sessionActivity,
    error: sessionError,
  }
}

// ─── Main Component ──────────────────────────────────────────────────────

interface BrowserSheetChatProps {
  source: BrowserSource
}

export function BrowserSheetChat({ source }: BrowserSheetChatProps): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const agentSessionId = useBrowserOverlayStore((s) => s.browserOverlay?.agentSessionId ?? null)
  const pageInfo       = useBrowserOverlayStore((s) => s.browserOverlay?.pageInfo ?? null)

  // ── Session data: canonical source is commandStore, with optimistic fallback ──
  const { state: agentState, activity: agentActivity, error: agentError } =
    useAgentSessionData(agentSessionId)

  // ── Messages: read from canonical commandStore (survives overlay lifecycle) ──
  const agentMessages = useSessionMessages(agentSessionId)

  // ── Message Queue: allows queuing follow-up messages while agent is busy ──
  const messageQueue = useMessageQueue({ sessionId: agentSessionId ?? '' })

  const chatMode = resolveChatMode(source)
  const isLinkedSession = chatMode.mode === 'linked'
  const linkedSessionId = chatMode.mode === 'linked' ? chatMode.sessionId : null

  // ── Linked-session init ──────────────────────────────────────────────
  // When overlay opens in linked mode, set agentSessionId so components
  // know which session to read from commandStore.
  useEffect(() => {
    if (!linkedSessionId) return
    useBrowserOverlayStore.getState().setBrowserOverlayAgentSessionId(linkedSessionId)
  }, [linkedSessionId])

  const isAgentBusy = agentState === 'creating' || agentState === 'streaming'
  const canClear = !isLinkedSession && (agentMessages.length > 0 || !!agentSessionId)

  // Track when the current agent session started (for StreamingFooter elapsed time)
  const agentStartedAtRef = useRef<number>(Date.now())
  const prevSessionIdRef = useRef<string | null>(null)
  if (agentSessionId !== prevSessionIdRef.current) {
    agentStartedAtRef.current = Date.now()
    prevSessionIdRef.current = agentSessionId
  }

  const handleSend = useCallback(async (message: UserMessageContent): Promise<boolean> => {
    const store = useBrowserOverlayStore.getState()
    const overlay = store.browserOverlay
    if (!overlay) return false

    // Read canonical session state from commandStore (NOT overlay's stale optimistic state).
    // The overlay's agentState is only an optimistic hint for the brief creating window —
    // it is never updated by DataBus events, so reading it here would produce stale results.
    const sessionId = overlay.agentSessionId
    const canonicalState = sessionId
      ? useCommandStore.getState().sessionById[sessionId]?.state ?? null
      : null

    try {
      // ── Linked-session mode ──
      if (chatMode.mode === 'linked') {
        if (canonicalState === 'streaming' || canonicalState === 'creating' || canonicalState === 'stopping') {
          return false
        }
        if (canonicalState === 'idle' || canonicalState === 'stopped' || canonicalState === 'error') {
          return await getAppAPI()['command:resume-session'](chatMode.sessionId, message)
        }
        return await getAppAPI()['command:send-message'](chatMode.sessionId, message)
      }

      // ── Standalone mode: follow-up ──
      if (sessionId && (canonicalState === 'awaiting_input' || canonicalState === 'awaiting_question' || canonicalState === 'idle')) {
        return await getAppAPI()['command:send-message'](sessionId, message)
      }

      // ── Standalone mode: first message ──
      const newSessionId = await getAppAPI()['command:start-session']({
        prompt: withPageContext(message, overlay.pageInfo),
        origin: { source: 'browser-agent' },
        systemPrompt: BROWSER_AGENT_SYSTEM_PROMPT,
        maxTurns: 25,
      })

      store.setBrowserOverlayAgentSessionId(newSessionId)
      // Optimistic hint — commandStore won't have this session for a few frames
      store.setBrowserOverlayAgentState('creating')

      return true
    } catch {
      return false
    }
  }, [chatMode])

  /** Send or queue: when agent is busy, enqueue instead of dropping. */
  const handleSendOrQueue = useCallback(async (message: UserMessageContent): Promise<boolean> => {
    if (isAgentBusy && agentSessionId) {
      messageQueue.enqueue(message)
      return true
    }
    return handleSend(message)
  }, [isAgentBusy, agentSessionId, messageQueue.enqueue, handleSend])

  const handleStop = useCallback(async () => {
    const sessionId = useBrowserOverlayStore.getState().browserOverlay?.agentSessionId
    if (sessionId) {
      await getAppAPI()['command:stop-session'](sessionId).catch(() => {})
    }
  }, [])

  const handleClear = useCallback(async () => {
    const bs = useBrowserOverlayStore.getState()
    const sessionId = bs.browserOverlay?.agentSessionId
    if (sessionId) {
      await getAppAPI()['command:stop-session'](sessionId).catch(() => {})
      // Remove from _sourceSessionMap so stale session isn't restored on reopen
      bs.removeSourceSession(sessionId)
    }
    messageQueue.clearQueue()
    bs.resetBrowserOverlayAgentSession()
  }, [messageQueue.clearQueue])

  return (
    <ContentViewerProvider>
      <div className="flex flex-col h-full bg-[hsl(var(--background))]">
        {/* Header */}
        <AgentChatHeader
          isLinkedSession={isLinkedSession}
          state={agentState}
          activity={agentActivity}
          canClear={canClear}
          onClear={handleClear}
        />

        {/* Message area */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {!agentSessionId ? (
            <AgentEmptyState hasPage={!!pageInfo} isLinkedSession={isLinkedSession} />
          ) : (
            <SessionMessageList
              key={agentSessionId}
              sessionId={agentSessionId}
              sessionState={agentState ?? undefined}
              onSendAnswer={handleSendOrQueue}
              variant="chat"
            />
          )}
        </div>

        {/* Status bar — between messages and input, mirrors Session Console */}
        {agentSessionId && (
          <BrowserAgentStatusBar
            state={agentState}
            activity={agentActivity}
            error={agentError}
            isLinkedSession={isLinkedSession}
            startedAt={agentStartedAtRef.current}
            onClear={canClear ? handleClear : undefined}
          />
        )}

        {/* Queued messages — shown between status bar and input bar */}
        {agentSessionId && messageQueue.queue.length > 0 && (
          <QueuedMessageList
            queue={messageQueue.queue}
            dispatch={messageQueue.dispatch}
            onEdit={messageQueue.updateQueued}
            onCancel={messageQueue.dequeue}
            onReorder={messageQueue.reorder}
          />
        )}

        {/* Input — stop action is integrated into the send button during processing */}
        <SessionInputBar
          onSend={handleSendOrQueue}
          disabled={false}
          placeholder={
            isLinkedSession
              ? t('browser.agent.continueSession')
              : isAgentBusy
                ? t('browser.agent.queueMessage', 'Type to queue a follow-up…')
                : t('browser.agent.tellAgent')
          }
          cacheKey={
            isLinkedSession && chatMode.mode === 'linked'
              ? `linked-session-${chatMode.sessionId}`
              : 'browser-agent-overlay'
          }
          sessionControl={{ isProcessing: isAgentBusy, onStop: handleStop }}
        />
      </div>

      {/* Content/Diff Viewer Dialog — rendered outside the scrollable area
          so it persists across virtualisation and streaming-state changes. */}
      <ConnectedContentViewer />
    </ContentViewerProvider>
  )
}

// ─── Header ──────────────────────────────────────────────────────────────

interface AgentChatHeaderProps {
  isLinkedSession: boolean
  state:    ManagedSessionState | null
  activity: string | null
  canClear: boolean
  onClear:  () => void
}

function AgentChatHeader({
  isLinkedSession, state, activity, canClear, onClear,
}: AgentChatHeaderProps): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const isActive = state && state !== 'idle' && state !== 'error' && state !== 'stopped'

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] shrink-0">
      <div className="flex items-center gap-1.5 min-w-0">
        {isLinkedSession ? (
          <Link className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" />
        )}
        <span className="text-xs font-medium text-[hsl(var(--foreground))]">
          {isLinkedSession ? t('browser.agent.session') : t('browser.agent.title')}
        </span>
        {isActive && (
          <span className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))] truncate">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
            <span className="truncate">{activity ?? state}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        {/* Stop is now integrated into the input bar's send button during processing */}
        {canClear && (
          <button
            type="button"
            onClick={onClear}
            title={t('browser.agent.clearChat')}
            className="p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors rounded"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────

function AgentEmptyState({ hasPage, isLinkedSession }: {
  hasPage: boolean
  isLinkedSession: boolean
}): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const Icon = isLinkedSession ? Link : Bot

  const prompt = isLinkedSession
    ? t('browser.agent.linkedSessionHint')
    : hasPage
      ? t('browser.agent.withPageHint')
      : t('browser.agent.noPageHint')

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-8 gap-3">
      <div className="h-10 w-10 rounded-full bg-[hsl(var(--accent))] flex items-center justify-center">
        <Icon className="h-5 w-5 text-[hsl(var(--accent-foreground))]" />
      </div>
      <div>
        <p className="text-xs font-medium text-[hsl(var(--foreground))]">
          {isLinkedSession ? t('browser.agent.linkedSession') : t('browser.agent.title')}
        </p>
        <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1 leading-relaxed">
          {prompt}
        </p>
      </div>
      {!isLinkedSession && (
        <div className="text-[11px] text-[hsl(var(--muted-foreground))] space-y-1">
          <p className="font-mono">&quot;{t('browser.agent.examples.navigate')}&quot;</p>
          <p className="font-mono">&quot;{t('browser.agent.examples.extract')}&quot;</p>
          <p className="font-mono">&quot;{t('browser.agent.examples.click')}&quot;</p>
          <p className="font-mono">&quot;{t('browser.agent.examples.screenshot')}&quot;</p>
        </div>
      )}
    </div>
  )
}

// ─── Browser Agent Status Bar ─────────────────────────────────────────────
// Mirrors the Session Console's StreamingFooter + SessionStatusBar pattern.
// Renders between the message list and the input bar.

interface BrowserAgentStatusBarProps {
  state:           ManagedSessionState | null
  activity:        string | null
  error:           string | null
  isLinkedSession: boolean
  startedAt:       number
  onClear?:        () => void
}

function BrowserAgentStatusBar({
  state, activity, error, isLinkedSession, startedAt, onClear,
}: BrowserAgentStatusBarProps): React.JSX.Element | null {
  const { t } = useTranslation('navigation')
  const isActive = state === 'creating' || state === 'streaming'
  const isTerminal = state === 'idle' || state === 'stopped' || state === 'error'

  // ── Streaming: reuse StreamingFooter (sparkle spinner + elapsed + activity).
  // Stop action is integrated into the input bar's send button.
  if (isActive) {
    return (
      <div className="shrink-0">
        <StreamingFooter
          activeDurationMs={0}
          activeStartedAt={startedAt}
          inputTokens={0}
          outputTokens={0}
          activity={activity}
          todos={null}
        />
      </div>
    )
  }

  // ── Terminal: compact bar with state indicator + error/clear
  if (isTerminal) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))] shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {state && <SessionStateIndicator state={state} />}
          {error && (
            <span className="text-[11px] text-red-500 truncate" title={error}>
              {error}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isLinkedSession && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              {t('browser.agent.clearChat')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return null
}
