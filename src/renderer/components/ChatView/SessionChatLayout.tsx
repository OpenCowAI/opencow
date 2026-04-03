// SPDX-License-Identifier: Apache-2.0

/**
 * SessionChatLayout — Shared conversation layout for active chat sessions.
 *
 * Extracts the common pattern used by AgentChatView, SkillCreatorView, and
 * ChatPanel into a single composable component. Renders:
 *   - Message list (full-width, scrollable)
 *   - Bottom controls in an optional max-width column:
 *     • StreamingFooter (when processing)
 *     • TodoStatusPill (when paused + has todos)
 *     • QueuedMessageList
 *     • Stop button (when processing)
 *     • ChatHeroInput
 */

import { useSessionMessages } from '@/hooks/useSessionMessages'
import { SessionMessageList } from '@/components/DetailPanel/SessionPanel/SessionMessageList'
import { StreamingFooter } from '@/components/DetailPanel/SessionPanel/StreamingFooter'
import { QueuedMessageList } from '@/components/DetailPanel/SessionPanel/QueuedMessageList'
import { TodoStatusPill } from '@/components/DetailPanel/SessionPanel/TodoWidgets'
import { ContentViewerProvider } from '@/components/DetailPanel/SessionPanel/ContentViewerContext'
import { ConnectedContentViewer } from '@/components/DetailPanel/SessionPanel/ConnectedContentViewer'
import { ChatHeroInput } from './ChatHeroInput'
import { cn } from '@/lib/utils'
import type { SessionSnapshot, UserMessageContent } from '@shared/types'
import type { UseMessageQueueReturn } from '@/hooks/useMessageQueue'
import { useCommandStore, selectLatestOpenTodos } from '@/stores/commandStore'

// ─── Props ───────────────────────────────────────────────────────────────────

export interface SessionChatLayoutProps {
  /** The active managed session. */
  session: SessionSnapshot
  /** Unified send / queue handler. */
  onSendOrQueue: (message: UserMessageContent) => Promise<boolean>
  /** Stop the current session. */
  onStop: () => void
  /** Message queue handle (for queue UI). */
  messageQueue: UseMessageQueueReturn
  /** Whether the session is actively processing (creating / streaming). */
  isProcessing: boolean
  /** Whether the session is paused (idle / stopped / error). */
  isPaused: boolean
  /**
   * Optional max-width class for the bottom controls column.
   * Defaults to `'max-w-[640px]'`. Pass `null` to skip the centered wrapper.
   */
  controlsMaxW?: string | null
  /** Optional placeholder for the chat input when paused. */
  pausedPlaceholder?: string
  /** Optional className for the bottom controls container. */
  controlsClassName?: string
  /**
   * Optional node rendered inline after all messages, scrolling with the list.
   * Passed through to SessionMessageList's footerNode prop.
   * Use this for persistent UI elements that should appear at the end of the
   * conversation (e.g. IssueConfirmationCard, ArtifactsSummaryBlock).
   */
  footerNode?: React.ReactNode
  /**
   * When true, the ConnectedContentViewer dialog is not rendered.
   * Useful for embedded contexts (e.g. InstallDialog) where opening a
   * full-screen file preview dialog would be disruptive.
   */
  hideContentViewer?: boolean
  /** Registers the layout input as the Chat tab's active focus target. */
  registerAsChatTabInput?: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SessionChatLayout({
  session,
  onSendOrQueue,
  onStop,
  messageQueue,
  isProcessing,
  isPaused,
  controlsMaxW = 'max-w-[640px]',
  pausedPlaceholder,
  controlsClassName,
  footerNode,
  hideContentViewer,
  registerAsChatTabInput = false,
}: SessionChatLayoutProps): React.JSX.Element {
  // Keep message lazy-load side effect for archived/resumed sessions.
  useSessionMessages(session.id)
  const latestTodos = useCommandStore((s) => selectLatestOpenTodos(s, session.id))

  const controlsWrapperCn = controlsMaxW
    ? cn('w-full mx-auto shrink-0', controlsMaxW, controlsClassName)
    : cn('shrink-0', controlsClassName)

  return (
    <ContentViewerProvider>
      <div className="flex-1 flex flex-col min-h-0">
        {/* Message List — full-width so scrolling works across the entire panel */}
        <SessionMessageList
          key={session.id}
          sessionId={session.id}
          sessionState={session.state}
          stopReason={session.stopReason}
          onSendAnswer={onSendOrQueue}
          variant="chat"
          footerNode={footerNode}
        />

        {/* ── Bottom controls ─────────────────────────────────────────── */}
        <div className={controlsWrapperCn}>
          {/* Streaming Footer */}
          {isProcessing && (
            <div className="px-2 pt-1">
              <StreamingFooter
                activeDurationMs={session.activeDurationMs}
                activeStartedAt={session.activeStartedAt ?? null}
                inputTokens={session.inputTokens}
                outputTokens={session.outputTokens}
                activity={session.activity}
                todos={latestTodos}
                rounded
              />
            </div>
          )}

          {/* Todo Status Pill (when not streaming) */}
          {!isProcessing && latestTodos && (
            <div className="flex items-center justify-end px-1 py-1 shrink-0">
              <TodoStatusPill todos={latestTodos} isPaused={isPaused} />
            </div>
          )}

          {/* Queued Messages */}
          {messageQueue.queue.length > 0 && (
            <QueuedMessageList
              queue={messageQueue.queue}
              dispatch={messageQueue.dispatch}
              onEdit={messageQueue.updateQueued}
              onCancel={messageQueue.dequeue}
              onReorder={messageQueue.reorder}
            />
          )}

          {/* Input — always visible; messages are queued when agent is busy.
               Stop action is integrated into the send button during processing. */}
          <div className="pb-3 pt-1">
            <ChatHeroInput
              onSend={onSendOrQueue}
              placeholder={isPaused ? pausedPlaceholder : undefined}
              engineKind={session.engineKind}
              sessionControl={{ isProcessing, onStop }}
              registerAsChatTabInput={registerAsChatTabInput}
            />
          </div>
        </div>
      </div>

      {/* Content/Diff Viewer Dialog — rendered outside the scrollable area
          so it persists across virtualisation and streaming-state changes. */}
      {!hideContentViewer && <ConnectedContentViewer />}
    </ContentViewerProvider>
  )
}
