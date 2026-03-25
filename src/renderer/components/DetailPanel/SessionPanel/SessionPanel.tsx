// SPDX-License-Identifier: Apache-2.0

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, PenLine, Loader2, Paperclip } from 'lucide-react'
import { SessionStatusBar } from './SessionStatusBar'
import { SessionMessageList } from './SessionMessageList'
import type { SessionMessageListHandle, ContextualQuestionInfo } from './SessionMessageList'
import { SessionInputBar } from './SessionInputBar'
import type { SessionInputBarHandle } from './SessionInputBar'
import { resolveMediaType } from '@/lib/attachmentUtils'
import { QueuedMessageList } from './QueuedMessageList'
import { SessionPanelTabBar } from './SessionPanelTabBar'
import { ArtifactsView, ArtifactViewerDialog } from './ArtifactsView'
import { ArtifactsSummaryBlock } from './ArtifactsSummaryBlock'
import { ArtifactViewerProvider, useArtifactViewerContext } from './ArtifactViewerContext'
import { ContentViewerProvider } from './ContentViewerContext'
import { ConnectedContentViewer } from './ConnectedContentViewer'
import { StickyQuestionBanner } from './StickyQuestionBanner'
import { NotesView } from './NotesView/NotesView'
import { SessionNotesProvider } from './NotesView/SessionNotesContext'
import type { SessionNotesContextValue } from './NotesView/SessionNotesContext'
import { useNoteContentResolver } from '@/hooks/useNoteContentResolver'
import type { SessionHistoryContext } from './sessionHistoryTypes'
import type { SessionPanelTab } from './artifactUtils'
import { DiffChangesDialog } from './DiffChangesDialog'
import { SessionDiffButton } from './SessionDiffButton'
import { StreamingOverlayContent } from './StreamingOverlayContent'
import { useDialogState } from '@/hooks/useModalAnimation'
import { useElementInset } from '@/hooks/useElementInset'
import { useMessageQueue } from '../../../hooks/useMessageQueue'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useCommandStore, selectIsProcessing } from '@/stores/commandStore'
import { useNoteStore } from '@/stores/noteStore'
import { useSessionByBinding, type SessionBinding } from '@/hooks/useSessionForIssue'
import { cn } from '@/lib/utils'
import { SessionStarProvider } from './FileStarButton'
import type {
  ManagedSessionMessage,
  UserMessageContent,
  NoteContent,
} from '@shared/types'

// Stable empty-array constant for narrow selector defaults.
const EMPTY_NOTES: never[] = []

/**
 * Context-connected artifact viewer dialog — rendered at SessionPanel level
 * so it persists across tab switches and isProcessing state changes.
 */
function ConnectedArtifactViewer(): React.JSX.Element | null {
  const { viewerOpen, viewingArtifact, closeViewer, starMap, toggleStar } =
    useArtifactViewerContext()
  if (!viewingArtifact) return null
  return (
    <ArtifactViewerDialog
      artifact={viewingArtifact}
      open={viewerOpen}
      starred={starMap.get(viewingArtifact.contentHash)?.starred ?? false}
      onToggleStar={toggleStar}
      onClose={closeViewer}
    />
  )
}

/**
 * Thin wrapper: renders ArtifactsSummaryBlock only when artifacts exist.
 * Consumes artifacts from ArtifactViewerContext — avoids passing artifacts
 * through SessionPanel, which would force it to subscribe to messages.
 */
function ArtifactSummaryFooter({ onViewAll }: { onViewAll: () => void }): React.JSX.Element | null {
  const { artifacts } = useArtifactViewerContext()
  if (artifacts.length === 0) return null
  return <ArtifactsSummaryBlock artifacts={artifacts} onViewAll={onViewAll} />
}

/**
 * Guard: when the Artifacts tab is active but has 0 artifacts, switch back
 * to Console.  Lives inside ArtifactViewerProvider so it can read context.
 */
function ArtifactTabGuard({
  activeTab,
  onResetTab,
}: {
  activeTab: SessionPanelTab
  onResetTab: () => void
}): null {
  const { artifactCount } = useArtifactViewerContext()
  useEffect(() => {
    if (activeTab === 'artifacts' && artifactCount === 0) {
      onResetTab()
    }
  }, [activeTab, artifactCount, onResetTab])
  return null
}

/**
 * Context-aware tab bar: reads artifactCount from ArtifactViewerContext
 * so SessionPanel doesn't need to pass it.
 */
function ConnectedTabBar({
  activeTab,
  onTabChange,
  noteCount,
}: {
  activeTab: SessionPanelTab
  onTabChange: (tab: SessionPanelTab) => void
  noteCount: number
}): React.JSX.Element {
  const { artifactCount } = useArtifactViewerContext()
  return (
    <SessionPanelTabBar
      activeTab={activeTab}
      onTabChange={onTabChange}
      artifactCount={artifactCount}
      noteCount={noteCount}
    />
  )
}

/**
 * Context-aware artifacts view: reads artifacts from ArtifactViewerContext.
 */
function ConnectedArtifactsView(): React.JSX.Element {
  const { artifacts } = useArtifactViewerContext()
  return <ArtifactsView artifacts={artifacts} />
}

export interface SessionPanelCapabilities {
  /** Start a new session when no session is currently bound. */
  create?: () => void
  /** Retry the current session when in retryable terminal states. */
  retry?: () => void
  /** Stop the current session when stoppable. */
  stop?: () => void
  /** Archive current and start a new session from issue context. */
  newSession?: () => void
  /** Archive current and start a blank session from issue context. */
  newBlankSession?: () => void
  /** Optional entry-point to compose mode from empty state. */
  compose?: () => void
  /** Message send path for active sessions. */
  send: (message: UserMessageContent) => Promise<boolean>
  /** Message resume path for paused/error sessions. */
  resume: (message: UserMessageContent) => Promise<boolean>
}

// Re-exported so existing consumers can import from SessionPanel.
export type { SessionHistoryContext } from './sessionHistoryTypes'

interface SessionPanelProps {
  /** Session source context (issue-bound or explicit session). */
  binding: SessionBinding
  /** Lifecycle mode controls read-only behavior at the panel level. */
  lifecycle: 'active' | 'readonly'
  isStarting: boolean
  capabilities: SessionPanelCapabilities
  /** Session history viewing / restore context. */
  history?: SessionHistoryContext
  /** Whether the console is in expanded (maximized) mode */
  isExpanded?: boolean
  /** Toggle console expand/collapse */
  onToggleExpand?: () => void
}

export const SessionPanel = React.memo(function SessionPanel({
  binding,
  lifecycle,
  isStarting,
  capabilities,
  history,
  isExpanded,
  onToggleExpand
}: SessionPanelProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const isReadOnly = lifecycle === 'readonly'

  // Session subscription lives HERE (not in IssueDetailView) so that
  // per-message streaming updates only re-render SessionPanel, not the
  // entire IssueDetailView tree above it.
  const session = useSessionByBinding(binding)
  const issueId = binding.kind === 'issue' ? binding.issueId : undefined

  // ---------------------------------------------------------------------------
  // ALL hooks must be declared before any early return to satisfy Rules of Hooks.
  // Hooks that depend on `session` use optional chaining with safe fallbacks.
  // ---------------------------------------------------------------------------

  const sessionId = session?.id ?? ''
  const state = session?.state

  // ─── Lazy-load persisted messages ──────────────────────────────────────────
  // When viewing an idle/completed session (e.g. from Issue detail panel),
  // messages may not yet be in commandStore.sessionMessages. Trigger an
  // on-demand fetch the first time SessionPanel mounts for this session.
  useEffect(() => {
    if (!sessionId) return
    useCommandStore.getState().ensureSessionMessages(sessionId)
  }, [sessionId])

  // ─── isProcessing ─────────────────────────────────────────────────────────
  // Derived from commandStore selector: O(1) for most states, only scans
  // messages when awaiting_input / awaiting_question.  Replaces the old
  // pattern of subscribing to the entire messages array + useMemo scan.
  const isProcessing = useCommandStore((s) => selectIsProcessing(s, sessionId || null))

  // ─── No messages subscription ───────────────────────────────────────────
  // SessionPanel no longer subscribes to `sessionMessages`.  All
  // messages-dependent derivations have been pushed into self-subscribing
  // child components:
  //   - SessionMessageList      → direct subscription (7 useMemo scans)
  //   - StickyQuestionBanner    → latestUserInfo
  //   - ArtifactViewerProvider  → artifacts
  //   - StreamingOverlayContent → latestTodos
  //   - SessionDiffButton       → sessionHasChanges
  // This means SessionPanel re-renders ONLY when session metadata (state,
  // cost, etc.) or non-message props change — NOT on every streaming chunk.

  // --- Sticky question banner ---
  const messageListRef = useRef<SessionMessageListHandle>(null)

  // Contextual question state — kept here because it's driven by
  // SessionMessageList's scroll detection (not messages), and forwarded
  // to StickyQuestionBanner as props.
  const [contextualQuestion, setContextualQuestion] = useState<string | null>(null)
  const [contextualQuestionMsgId, setContextualQuestionMsgId] = useState<string | null>(null)
  const handleContextualQuestionChange = useCallback((info: ContextualQuestionInfo) => {
    setContextualQuestion(info.text)
    setContextualQuestionMsgId(info.msgId)
  }, [])

  // --- Message Queue ---
  const isResumeState = state === 'idle' || state === 'stopped' || state === 'error'

  const messageQueue = useMessageQueue({ sessionId })

  const handleSendOrQueue = useCallback(
    async (message: UserMessageContent): Promise<boolean> => {
      if (isProcessing) {
        messageQueue.enqueue(message)
        return true
      }
      const handler = isResumeState ? capabilities.resume : capabilities.send
      return handler(message)
    },
    [isProcessing, messageQueue, isResumeState, capabilities]
  )

  // ─── Artifacts Tab ───────────────────────────────────────────────────────
  // Artifacts are now computed inside ArtifactViewerProvider (self-subscribing).
  // The tab-switch-back guard is handled by ArtifactTabGuard below.
  const [activeTab, setActiveTab] = useState<SessionPanelTab>('console')

  // ─── Notes ─────────────────────────────────────────────────────────────
  // NARROW selector: only re-renders when THIS issue's notes change,
  // not when any other issue's notes change.
  const currentIssueId = issueId ?? ''
  const notes = useNoteStore(
    useCallback((s) => s.notesByIssue[currentIssueId] ?? EMPTY_NOTES, [currentIssueId]),
  )
  const loadNotes = useNoteStore((s) => s.loadNotes)
  const createNote = useNoteStore((s) => s.createNote)
  const storeUpdateNote = useNoteStore((s) => s.updateNote)
  const storeDeleteNote = useNoteStore((s) => s.deleteNote)

  useEffect(() => {
    if (currentIssueId) {
      loadNotes(currentIssueId)
    }
  }, [currentIssueId, loadNotes])

  const handleAddNote = useCallback(
    async (content: NoteContent, sourceFilePath?: string) => {
      if (!currentIssueId) return
      await createNote({ issueId: currentIssueId, content, sourceFilePath })
    },
    [currentIssueId, createNote]
  )

  const handleUpdateNote = useCallback(
    async (id: string, content: NoteContent) => {
      await storeUpdateNote(id, currentIssueId, content)
    },
    [currentIssueId, storeUpdateNote]
  )

  const handleDeleteNote = useCallback(
    async (id: string) => {
      await storeDeleteNote(id, currentIssueId)
    },
    [currentIssueId, storeDeleteNote]
  )

  const handleSendToChat = useCallback(
    (content: UserMessageContent) => {
      void handleSendOrQueue(content)
    },
    [handleSendOrQueue]
  )

  const resolveNoteContent = useNoteContentResolver()

  const handleSendAndDeleteNote = useCallback(
    async (id: string) => {
      const note = notes.find((n) => n.id === id)
      if (!note) return
      const content = await resolveNoteContent(note)
      await handleSendOrQueue(content)
      await storeDeleteNote(id, currentIssueId)
    },
    [notes, resolveNoteContent, handleSendOrQueue, storeDeleteNote, currentIssueId]
  )

  const notesCtxValue = useMemo<SessionNotesContextValue | null>(
    () =>
      currentIssueId
        ? {
            issueId: currentIssueId,
            notes,
            addNote: handleAddNote,
            updateNote: handleUpdateNote,
            deleteNote: handleDeleteNote,
            sendAndDeleteNote: handleSendAndDeleteNote,
            sendToChat: handleSendToChat,
          }
        : null,
    [currentIssueId, notes, handleAddNote, handleUpdateNote, handleDeleteNote, handleSendAndDeleteNote, handleSendToChat]
  )

  const switchToConsole = useCallback(() => setActiveTab('console'), [])

  const selectedProjectId = useAppStore(selectProjectId)
  const starCtxValue = useMemo(
    () => ({ sessionId, issueId: issueId ?? null, projectId: selectedProjectId }),
    [sessionId, issueId, selectedProjectId]
  )

  // ─── Session-level diff ─────────────────────────────────────────────────
  const sessionDiffDialog = useDialogState<ManagedSessionMessage[]>()

  // Agent is actively processing: show fixed footer.
  // We include a message-level streaming signal as a safety net for
  // out-of-order state updates during event projection.

  // Session is no longer active — todos should show "paused" styling instead
  // of the misleading "in progress" indicator.
  const isSessionPaused = state === 'idle' || state === 'stopped' || state === 'error'

  // Determine InputBar visibility — hidden for finished issues, teardown, or read-only archived view.
  // Visible during creating/streaming to support message queuing.
  const inputHidden = isReadOnly || state === 'stopping' || !!history?.isViewingArchived

  // ---------------------------------------------------------------------------
  // Overlay inset — tracks the floating bottom panel height so Virtuoso can
  // add equivalent bottom padding, preventing content from hiding behind it.
  // Dependencies correspond to structural changes in the overlay content:
  //   isProcessing → StreamingOverlayContent layout switch
  //   inputHidden  → SessionInputBar mount/unmount
  //   queue.length → QueuedMessageList row count changes
  // Note: latestTodos changes are detected by ResizeObserver since
  // StreamingOverlayContent manages its own mount/unmount internally.
  // ---------------------------------------------------------------------------
  const [overlayRef, bottomInset] = useElementInset([
    isProcessing,
    inputHidden,
    messageQueue.queue.length,
  ])

  // ---------------------------------------------------------------------------
  // Console-wide file drop zone — allows users to drop native files (images,
  // PDFs, text) anywhere on the session console, not just the narrow input bar.
  // Dropped files are forwarded to the SessionInputBar's composer via ref.
  // Project-file drags (application/x-opencow-file from sidebar) are handled
  // separately by ContextFileDragZone in IssueDetailView — not intercepted here.
  // ---------------------------------------------------------------------------
  const inputBarRef = useRef<SessionInputBarHandle>(null)
  const [isConsoleDragOver, setIsConsoleDragOver] = useState(false)
  const consoleDragCounterRef = useRef(0)

  const handleConsoleDragEnter = useCallback((e: React.DragEvent) => {
    if (inputHidden) return
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    consoleDragCounterRef.current += 1
    if (consoleDragCounterRef.current === 1) setIsConsoleDragOver(true)
  }, [inputHidden])

  const handleConsoleDragOver = useCallback((e: React.DragEvent) => {
    if (inputHidden) return
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [inputHidden])

  const handleConsoleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    consoleDragCounterRef.current -= 1
    if (consoleDragCounterRef.current <= 0) {
      consoleDragCounterRef.current = 0
      setIsConsoleDragOver(false)
    }
  }, [])

  const handleConsoleDrop = useCallback((e: React.DragEvent) => {
    consoleDragCounterRef.current = 0
    setIsConsoleDragOver(false)
    // If the drop landed directly on the SessionInputBar, its own handler
    // will process the files — skip here to avoid duplicate attachments.
    const target = e.target as HTMLElement
    if (target.closest('[data-session-input]')) return
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter((f) => resolveMediaType(f) !== null)
    if (files.length > 0) {
      inputBarRef.current?.addAttachments(files)
    }
  }, [])

  // Memoized sessionControl prop for SessionInputBar — prevents re-render on
  // every streaming chunk (the inline `{ isProcessing, onStop }` object was
  // previously recreated every render, defeating SessionInputBar's memo).
  const handleStop = useCallback(() => capabilities.stop?.(), [capabilities.stop])
  const sessionControlProps = useMemo(
    () => ({ isProcessing, onStop: handleStop }),
    [isProcessing, handleStop],
  )

  // ---------------------------------------------------------------------------
  // Early returns — safe now that all hooks have been called above.
  // ---------------------------------------------------------------------------

  // Empty state: no session
  if (!session && !isStarting) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-[hsl(var(--muted-foreground))]">
        <p className="text-sm">{t('sessionPanel.noSessionYet')}</p>
        {!isReadOnly && (
          <div className="flex items-center gap-2">
            {capabilities.create && (
              <button
                onClick={capabilities.create}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                aria-label={t('sessionPanel.startSessionAria')}
              >
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                {t('sessionPanel.startSession')}
              </button>
            )}
            {capabilities.compose && (
              <button
                onClick={capabilities.compose}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                aria-label={t('sessionPanel.composeAndStartAria')}
              >
                <PenLine className="w-3.5 h-3.5" aria-hidden="true" />
                {t('sessionPanel.composeAndStart')}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // Starting state (before DataBus event arrives)
  if (isStarting && !session) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-[hsl(var(--muted-foreground))]">
        <Loader2 className="w-5 h-5 motion-safe:animate-spin" aria-hidden="true" />
        <p className="text-sm">{t('sessionPanel.starting')}</p>
      </div>
    )
  }

  // Session exists
  if (!session) return <></>

  return (
    <SessionStarProvider value={starCtxValue}>
      <SessionNotesProvider value={notesCtxValue}>
        <ArtifactViewerProvider
          sessionId={session.id}
          issueId={issueId ?? null}
        >
        <ContentViewerProvider>
          {/* Guard: reset to Console tab when artifacts drop to 0 */}
          <ArtifactTabGuard activeTab={activeTab} onResetTab={switchToConsole} />
          <div className="h-full flex flex-col bg-[hsl(var(--card))]">
            {/* Combined Tab + Status Bar — single row */}
            <div className="flex items-center gap-2 px-2.5 py-1 border-b border-[hsl(var(--border)/0.5)] bg-[hsl(var(--card))] shrink-0">
              {/* Left: Tabs — reads artifactCount from ArtifactViewerContext */}
              <ConnectedTabBar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                noteCount={notes.length}
              />

              {/* Session-level diff button — self-subscribing to messages */}
              <SessionDiffButton
                sessionId={session.id}
                isProcessing={isProcessing}
                onShowDiff={sessionDiffDialog.show}
              />

              {/* Separator + Status (only when session is active) */}
              {!isReadOnly && (
                <>
                  <span className="w-px h-3.5 bg-[hsl(var(--border)/0.4)]" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <SessionStatusBar
                      sessionId={session.id}
                      state={session.state}
                      error={session.error ?? null}
                      stopReason={session.stopReason}
                      onStop={capabilities.stop}
                      onRetry={capabilities.retry}
                      onNewSession={capabilities.newSession}
                      onNewBlankSession={capabilities.newBlankSession}
                      history={history}
                      isExpanded={isExpanded}
                      onToggleExpand={onToggleExpand}
                    />
                  </div>
                </>
              )}
            </div>

            {/*
             * Content area — uses CSS `hidden` (display:none) instead of conditional
             * rendering so that the MessageList stays mounted when switching to
             * Artifacts/Notes, preserving scroll position and streaming state.
             */}

            {/* Console content — overlay architecture.
             *
             * Bottom controls (StreamingFooter, TodoStatusPill, QueuedMessages,
             * InputBar) float OVER the scroll area via absolute positioning
             * instead of being flex siblings of the Virtuoso container.
             *
             * This makes Virtuoso's container height CONSTANT — immune to
             * mount/unmount of bottom controls.  Without this, Virtuoso's
             * async ResizeObserver creates a 1-2 frame gap (white flash) when
             * the container height changes on state transitions.
             *
             * The Virtuoso container's `bottom` tracks the overlay height
             * (bottomInset) so the native scrollbar and footer content are
             * never hidden behind the floating panel. */}
            <div className={activeTab === 'console' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
              {/* Read-only banner — shown when viewing an archived session */}
              {history?.isViewingArchived && (
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] shrink-0">
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    {t('sessionHistory.viewingArchived')}
                  </span>
                  <button
                    onClick={history.onExitView}
                    className="text-xs text-[hsl(var(--primary))] hover:underline transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded px-1"
                  >
                    {t('sessionHistory.backToCurrent')}
                  </button>
                </div>
              )}
              {/* Sticky question banner — self-subscribing component that
               * derives latestUserInfo from commandStore independently. */}
              <StickyQuestionBanner
                sessionId={session.id}
                messageListRef={messageListRef}
                contextualQuestion={contextualQuestion}
                contextualQuestionMsgId={contextualQuestionMsgId}
              />

              {/* Stable scroll area — the `relative` div establishes a positioning
               *  context for both the message list and the bottom overlay.
               *  Also serves as the console-wide file drop zone — users can
               *  drop native files anywhere here to attach them to the input. */}
              <div
                className="relative flex-1 min-h-0"
                onDragEnter={handleConsoleDragEnter}
                onDragOver={handleConsoleDragOver}
                onDragLeave={handleConsoleDragLeave}
                onDrop={handleConsoleDrop}
              >
                {/* File drop overlay — full-panel visual cue when dragging native
                 *  files over the session console area. */}
                {isConsoleDragOver && (
                  <div className="absolute inset-0 z-30 flex items-center justify-center bg-[hsl(var(--background)/0.75)] backdrop-blur-[2px] pointer-events-none">
                    <div className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-dashed border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--primary)/0.04)]">
                      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[hsl(var(--primary)/0.1)]">
                        <Paperclip className="w-6 h-6 text-[hsl(var(--primary))]" aria-hidden="true" />
                      </div>
                      <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                        {t('sessionPanel.fileDropHint', { defaultValue: 'Drop files to attach' })}
                      </p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        {t('sessionPanel.fileDropHintSub', {
                          defaultValue: 'Images, PDFs, and text files will be attached to your message',
                        })}
                      </p>
                    </div>
                  </div>
                )}

                {/* Virtuoso container — bottom edge tracks the overlay height so
                 *  the native scrollbar is never hidden behind the floating panel.
                 *  VirtuosoFooter uses only base padding; the container itself
                 *  ends right where the overlay begins. */}
                <div className="absolute inset-x-0 top-0" style={{ bottom: bottomInset }}>
                  <SessionMessageList
                    key={session.id}
                    ref={messageListRef}
                    sessionId={session.id}
                    sessionState={state}
                    stopReason={session.stopReason}
                    onSendAnswer={isReadOnly ? undefined : handleSendOrQueue}
                    onContextualQuestionChange={handleContextualQuestionChange}
                    issueId={issueId}
                    footerNode={
                      !isProcessing ? (
                        <ArtifactSummaryFooter onViewAll={() => setActiveTab('artifacts')} />
                      ) : undefined
                    }
                  />
                </div>

                {/* Bottom overlay — floats over Virtuoso, NOT a flex sibling.
                 *  All children have their own opaque backgrounds:
                 *    StreamingFooter:  bg-[hsl(var(--muted))]
                 *    TodoStatusPill:   bg-[hsl(var(--muted))]
                 *    QueuedMessages:   bg-[hsl(var(--card))]
                 *    SessionInputBar:  bg-[hsl(var(--card))]
                 *  so scrolling content behind the overlay is never visible. */}
                <div
                  ref={overlayRef}
                  className="absolute bottom-0 inset-x-0 z-10 flex flex-col"
                >
                  {/* StreamingFooter / TodoStatusPill — self-subscribing to
                   *  commandStore for latestTodos derivation */}
                  <StreamingOverlayContent
                    sessionId={session.id}
                    isProcessing={isProcessing}
                    isSessionPaused={isSessionPaused}
                  />
                  {messageQueue.queue.length > 0 && (
                    <QueuedMessageList
                      queue={messageQueue.queue}
                      dispatch={messageQueue.dispatch}
                      onEdit={messageQueue.updateQueued}
                      onCancel={messageQueue.dequeue}
                      onReorder={messageQueue.reorder}
                    />
                  )}
                  {!inputHidden && (
                    <SessionInputBar
                      ref={inputBarRef}
                      onSend={handleSendOrQueue}
                      disabled={false}
                      placeholder={isResumeState ? t('agentChat.continueConversation') : undefined}
                      engineKind={session?.engineKind}
                      cacheKey={issueId}
                      sessionControl={sessionControlProps}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Artifacts content — reads artifacts from ArtifactViewerContext */}
            <div className={activeTab === 'artifacts' ? 'flex-1 min-h-0' : 'hidden'}>
              <ConnectedArtifactsView />
            </div>

            {/* Notes content */}
            <div className={activeTab === 'notes' ? 'flex-1 min-h-0' : 'hidden'}>
              <NotesView
                notes={notes}
                onAdd={handleAddNote}
                onUpdate={handleUpdateNote}
                onDelete={handleDeleteNote}
                onSendAndDeleteNote={handleSendAndDeleteNote}
                onSendToChat={handleSendToChat}
                onSwitchToConsole={switchToConsole}
              />
            </div>
          </div>

          {/* Artifact Viewer Dialog — rendered at SessionPanel level so it
           persists across isProcessing changes and tab switches. */}
          <ConnectedArtifactViewer />

          {/* Content/Diff Viewer Dialog — rendered at SessionPanel level so it
           persists across Virtuoso virtualisation, tab switches, and streaming. */}
          <ConnectedContentViewer />

          {/* Session-level diff dialog */}
          {sessionDiffDialog.data && (
            <DiffChangesDialog
              open={sessionDiffDialog.open}
              onClose={sessionDiffDialog.close}
              messages={sessionDiffDialog.data}
              title={t('diffChanges.allSessionChanges')}
              reviewContext={
                issueId && sessionId
                  ? { issueId, sessionId, scope: { type: 'session' } }
                  : undefined
              }
            />
          )}
        </ContentViewerProvider>
        </ArtifactViewerProvider>
      </SessionNotesProvider>
    </SessionStarProvider>
  )
})
