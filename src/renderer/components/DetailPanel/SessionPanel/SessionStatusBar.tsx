// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Square, RotateCcw, Plus, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import { SessionStateIndicator, SessionStateLabel } from '../SessionStatusCard'
import { SessionHistoryDropdown } from './SessionHistoryDropdown'
import type { SessionHistoryContext } from './sessionHistoryTypes'
import { ContextWindowRing } from '../../ui/ContextWindowRing'
import { Tooltip } from '../../ui/Tooltip'
import { PillDropdown } from '../../ui/PillDropdown'
import { TodoStatusPill } from './TodoWidgets'
import { formatDuration, computeActiveDuration } from '@/lib/sessionHelpers'
import { isProcessCorruptedError } from '../../../lib/sessionErrors'
import { selectLatestOpenTodos, useStreamingSessionMetrics, useCommandStore } from '@/stores/commandStore'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { resolveContextDisplayState } from '@shared/contextDisplay'
import type { TFunction } from 'i18next'
import type { ManagedSessionState, SessionStopReason } from '@shared/types'
import { createLogger } from '@/lib/logger'
import { getAppAPI } from '@/windowAPI'

const log = createLogger('SessionStatusBar')

/**
 * SessionStatusBar props.
 *
 * Self-subscribing architecture: per-frame volatile fields (duration, context
 * usage, token counts) are read directly from commandStore via
 * `useStreamingSessionMetrics` and `resolveContextDisplayState`.
 *
 * Only stable identity/lifecycle fields come from the parent (SessionPanel),
 * so SessionPanel does NOT re-render on every streaming tick — eliminating
 * the main-thread contention that caused input lag.
 */
interface SessionStatusBarProps {
  /** Session ID — used for direct store subscriptions. */
  sessionId: string
  /** Current session state — drives indicator, button visibility, and duration tick. */
  state: ManagedSessionState
  /** Error message — only displayed when state === 'error'. */
  error: string | null
  /** Stop reason — shown in tooltip when state === 'idle'. */
  stopReason: SessionStopReason | null
  onStop?: () => void
  onRetry?: () => void
  onNewSession?: () => void
  onNewBlankSession?: () => void
  /** Session history context — omit to hide the history dropdown. */
  history?: SessionHistoryContext
  /** Whether the console is in expanded (maximized) mode */
  isExpanded?: boolean
  /** Toggle console expand/collapse */
  onToggleExpand?: () => void
}

function stopReasonLabel(reason: SessionStopReason | null, t: TFunction<'sessions'>): string {
  switch (reason) {
    case 'completed': return t('sessionStatusBar.stopReasons.taskCompleted')
    case 'max_turns': return t('sessionStatusBar.stopReasons.turnLimitReached')
    case 'user_stopped': return t('sessionStatusBar.stopReasons.stoppedByUser')
    default: return t('sessionStatusBar.stopReasons.idle')
  }
}

function ErrorPopover({ error }: { error: string }): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const [open, setOpen] = useState(false)
  const needsRestart = isProcessCorruptedError(error)

  const handleRestart = useCallback(() => {
    getAppAPI()['app:relaunch']().catch((err: unknown) => {
      log.error('Failed to relaunch app', err)
    })
  }, [])

  return (
    <PillDropdown
      open={open}
      onOpenChange={setOpen}
      hoverMode
      position="below"
      align="left"
      className="min-w-0 overflow-hidden"
      trigger={
        <span
          className="inline-block max-w-full truncate text-xs text-red-500 cursor-default border-b border-dashed border-red-400/50"
          title={error}
        >
          {error}
        </span>
      }
    >
      <div className="p-3 max-w-xs space-y-2">
        <p className="text-xs font-medium text-[hsl(var(--foreground))]">{t('sessionStatusBar.errorDetails')}</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))] break-words whitespace-pre-wrap">{error}</p>
        {needsRestart && (
          <>
            <div className="border-t border-[hsl(var(--border))]" />
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {t('sessionStatusBar.processError')}
            </p>
            <button
              onClick={handleRestart}
              className="flex items-center gap-1.5 w-full justify-center px-3 py-1.5 text-xs font-medium rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              aria-label={t('sessionStatusBar.restartApp')}
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              {t('sessionStatusBar.restartApp')}
            </button>
          </>
        )}
      </div>
    </PillDropdown>
  )
}

export const SessionStatusBar = React.memo(function SessionStatusBar({
  sessionId,
  state,
  error,
  stopReason,
  onStop,
  onRetry,
  onNewSession,
  onNewBlankSession,
  history,
  isExpanded,
  onToggleExpand
}: SessionStatusBarProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const [newSessionOpen, setNewSessionOpen] = useState(false)

  // ── Self-subscriptions for per-frame volatile data ──
  // These change on every streaming tick but no longer flow through
  // SessionPanel props — SessionPanel's render is completely skipped.
  const metrics = useStreamingSessionMetrics(sessionId)
  const activeDurationMs = metrics?.activeDurationMs ?? 0
  const activeStartedAt = metrics?.activeStartedAt ?? null
  const latestTodos = useCommandStore((s) => selectLatestOpenTodos(s, sessionId))

  // Context display — resolves from the full session snapshot.
  // Uses useStoreWithEqualityFn + shallow to avoid re-renders when
  // resolveContextDisplayState returns a new object with identical values.
  const contextDisplay = useStoreWithEqualityFn(
    useCommandStore,
    (s) => {
      const session = s.sessionById[sessionId]
      if (!session) return { usedTokens: 0, limitTokens: 200_000, estimated: true }
      return resolveContextDisplayState(session)
    },
    shallow,
  )

  // Tick duration every second for active states
  const [, setTick] = useState(0)
  const isActive = state === 'creating' || state === 'streaming' || state === 'awaiting_input' || state === 'awaiting_question'
  useEffect(() => {
    if (!isActive) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [isActive])

  // Stop button is shown for awaiting states only — during streaming/creating,
  // the stop action is integrated into the input bar's send button.
  const showStop = (state === 'awaiting_input' || state === 'awaiting_question') && !!onStop
  // Process-corrupted errors (EBADF) are NOT retryable — resuming a session
  // whose subprocess hit a file-descriptor leak is semantically invalid.
  // New Session remains available: it creates a fresh session which works fine
  // after an app restart (EBADF is a process-level issue, not a data issue).
  const isCorrupted = state === 'error' && !!error && isProcessCorruptedError(error)
  const showRetry = (state === 'stopped' || state === 'error') && !isCorrupted && !!onRetry
  const showNewSession = (
    state === 'idle' ||
    state === 'awaiting_input' ||
    state === 'stopped' ||
    state === 'error'
  ) && !!onNewSession && !!onNewBlankSession
  const isTodoPaused = state === 'idle' || state === 'stopped' || state === 'error'

  return (
    <div
      className="flex items-center justify-between gap-3"
      aria-live="polite"
    >
      <div className="flex items-center gap-1.5 text-xs min-w-0">
        <Tooltip content={`${SessionStateLabel({ state })}${state === 'idle' ? ` · ${stopReasonLabel(stopReason, t)}` : ''}`}>
          <span className="flex items-center shrink-0">
            <SessionStateIndicator state={state} />
          </span>
        </Tooltip>
        {state === 'error' && error && (
          <ErrorPopover error={error} />
        )}
        <span className="text-xs text-[hsl(var(--muted-foreground))] tabular-nums shrink-0">
          {formatDuration(computeActiveDuration({ accumulatedMs: activeDurationMs, activeStartedAt }))}
        </span>
        {/* Context window usage ring */}
        <span className="inline-flex items-center shrink-0">
          <ContextWindowRing
            contextUsed={contextDisplay.usedTokens}
            contextLimit={contextDisplay.limitTokens}
            estimated={contextDisplay.estimated}
          />
        </span>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {latestTodos && (
          <TodoStatusPill todos={latestTodos} isPaused={isTodoPaused} />
        )}
        {showStop && (
          <button
            onClick={() => onStop?.()}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            aria-label={t('sessionStatusBar.stopSessionAria')}
          >
            <Square className="w-3 h-3" aria-hidden="true" />
            {t('sessionStatusBar.stopSession')}
          </button>
        )}
        {showRetry && (
          <Tooltip content={t('sessionStatusBar.retryTooltip')} align="end">
            <button
              onClick={() => onRetry?.()}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md text-[hsl(var(--primary))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              aria-label={t('sessionStatusBar.retryAria')}
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
              {t('sessionStatusBar.retry')}
            </button>
          </Tooltip>
        )}
        {/* Session History — shown when archived sessions exist */}
        {history && (
          <SessionHistoryDropdown
            archivedSessions={history.archivedSessions}
            onRestore={history.onRestore}
            onView={history.onView}
          />
        )}
        {showNewSession && (
          <PillDropdown
            open={newSessionOpen}
            onOpenChange={setNewSessionOpen}
            position="below"
            align="right"
            trigger={
              <button
                onClick={() => setNewSessionOpen((prev) => !prev)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                aria-label={t('sessionStatusBar.newSessionAria')}
              >
                <Plus className="w-3 h-3" aria-hidden="true" />
                {t('sessionStatusBar.newSession')}
              </button>
            }
          >
            <div className="p-3 space-y-2.5 min-w-[280px]">
              <p className="text-xs font-medium text-[hsl(var(--foreground))]">
                {t('sessionStatusBar.createNewSession')}
              </p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {t('sessionStatusBar.archiveNote')}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setNewSessionOpen(false)
                    onNewSession?.()
                  }}
                  className="flex-1 px-3 py-1.5 text-xs rounded-md border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  {t('sessionStatusBar.fromIssue')}
                </button>
                <button
                  onClick={() => {
                    setNewSessionOpen(false)
                    onNewBlankSession?.()
                  }}
                  className="flex-1 px-3 py-1.5 text-xs rounded-md font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  {t('sessionStatusBar.blankSession')}
                </button>
              </div>
            </div>
          </PillDropdown>
        )}
        {onToggleExpand && (
          <>
            <div className="w-px h-3.5 bg-[hsl(var(--border))]" aria-hidden="true" />
            <Tooltip content={isExpanded ? t('sessionStatusBar.collapseConsole') : t('sessionStatusBar.expandConsole')} align="end">
              <button
                onClick={onToggleExpand}
                className="flex items-center justify-center w-6 h-6 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                aria-label={isExpanded ? t('sessionStatusBar.collapseConsole') : t('sessionStatusBar.expandConsole')}
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3" aria-hidden="true" />
                ) : (
                  <ChevronUp className="w-3 h-3" aria-hidden="true" />
                )}
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  )
})
