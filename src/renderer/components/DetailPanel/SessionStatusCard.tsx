// SPDX-License-Identifier: Apache-2.0

import { useCallback, useState } from 'react'
import { Play, Square, RotateCcw, Loader2, AlertTriangle, CheckCircle2, PauseCircle, RefreshCw } from 'lucide-react'
import { cn } from '../../lib/utils'
import { PillDropdown } from '../ui/PillDropdown'
import { formatDuration, computeActiveDuration, toActiveDuration } from '@/lib/sessionHelpers'
import type { SessionSnapshot } from '@shared/types'
import { createLogger } from '@/lib/logger'
import { getAppAPI } from '@/windowAPI'

const log = createLogger('SessionStatusCard')

export interface SessionStatusCardProps {
  session: SessionSnapshot | null
  isStarting: boolean
  onStart: () => void
  onRetry: () => void
  onStop: () => void
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}

/** Whether an error message indicates a process-level corruption requiring full app restart */
function isProcessCorruptedError(error: string): boolean {
  return /EBADF|process failed/.test(error)
}

function ErrorMessageWithPopover({ error }: { error: string }): React.JSX.Element {
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
      trigger={
        <p className="text-xs text-red-500 line-clamp-2 cursor-default border-b border-dashed border-red-400/50 inline">
          {error}
        </p>
      }
    >
      <div className="p-3 max-w-xs space-y-2">
        <p className="text-xs font-medium text-[hsl(var(--foreground))]">Error Details</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))] break-words whitespace-pre-wrap">{error}</p>
        {needsRestart && (
          <>
            <div className="border-t border-[hsl(var(--border))]" />
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              This error is caused by a process-level corruption and cannot be recovered within the current session. Please restart OpenCow.
            </p>
            <button
              onClick={handleRestart}
              className="flex items-center gap-1.5 w-full justify-center px-3 py-1.5 text-xs font-medium rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              aria-label="Restart OpenCow"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              Restart OpenCow
            </button>
          </>
        )}
      </div>
    </PillDropdown>
  )
}

export function SessionStatusCard({
  session,
  isStarting,
  onStart,
  onRetry,
  onStop
}: SessionStatusCardProps): React.JSX.Element {
  // No session — show Start button
  if (!session && !isStarting) {
    return (
      <button
        onClick={onStart}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
      >
        <Play className="w-3.5 h-3.5" />
        Start Session
      </button>
    )
  }

  // Starting (local loading state before DataBus event arrives)
  if (isStarting && !session) {
    return (
      <button
        disabled
        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] opacity-50 cursor-not-allowed"
      >
        <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" />
        Starting...
      </button>
    )
  }

  // Session exists — render status card
  if (!session) return <></>

  const { state } = session

  return (
    <div
      className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 space-y-2"
      aria-label={`Session status: ${state}`}
    >
      {/* Status row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <SessionStateIndicator state={state} />
          <span className="font-medium text-[hsl(var(--foreground))]">
            <SessionStateLabel state={state} />
          </span>
        </div>
        {session.model && (
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {session.model}
          </span>
        )}
      </div>

      {/* Error message */}
      {state === 'error' && session.error && (
        <ErrorMessageWithPopover error={session.error} />
      )}

      {/* Meta row: cost + duration */}
      <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
        <span>Cost: {formatCost(session.totalCostUsd)}</span>
        <span>{formatDuration(computeActiveDuration(toActiveDuration(session)))}</span>
      </div>

      {/* Action row */}
      <div className="flex justify-end">
        {(state === 'streaming' || state === 'awaiting_input' || state === 'awaiting_question' || state === 'creating') && (
          <button
            onClick={onStop}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors',
              'text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:bg-[hsl(var(--foreground)/0.04)]'
            )}
            aria-label="Stop session"
          >
            <Square className="w-3 h-3" />
            Stop
          </button>
        )}
        {state === 'error' && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md text-[hsl(var(--primary))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
            aria-label="Retry session"
          >
            <RotateCcw className="w-3 h-3" />
            Retry
          </button>
        )}
        {state === 'stopped' && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md text-[hsl(var(--primary))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
            aria-label="Start new session"
          >
            <Play className="w-3 h-3" />
            New Session
          </button>
        )}
        {state === 'idle' && (
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            Ready to continue
          </span>
        )}
      </div>
    </div>
  )
}

export function SessionStateIndicator({ state }: { state: SessionSnapshot['state'] }): React.JSX.Element {
  switch (state) {
    case 'creating':
      return <Loader2 className="w-3.5 h-3.5 text-blue-500 motion-safe:animate-spin" />
    case 'streaming':
      return <span className="w-2 h-2 rounded-full bg-green-500 motion-safe:animate-pulse" />
    case 'awaiting_input':
      return <span className="w-2 h-2 rounded-full bg-green-500" />
    case 'awaiting_question':
      return <span className="w-2 h-2 rounded-full bg-amber-500" />
    case 'idle':
      return <PauseCircle className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
    case 'stopping':
      return <Loader2 className="w-3.5 h-3.5 text-yellow-500 motion-safe:animate-spin" />
    case 'error':
      return <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
    case 'stopped':
      return <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
  }
}

export function SessionStateLabel({ state }: { state: SessionSnapshot['state'] }): string {
  switch (state) {
    case 'creating':
      return 'Starting...'
    case 'streaming':
      return 'Running'
    case 'awaiting_input':
      return 'Ready'
    case 'awaiting_question':
      return 'Waiting for answer'
    case 'idle':
      return 'Idle'
    case 'stopping':
      return 'Stopping...'
    case 'error':
      return 'Error'
    case 'stopped':
      return 'Stopped'
  }
}
