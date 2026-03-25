// SPDX-License-Identifier: Apache-2.0

/**
 * SessionDiffButton — self-subscribing diff trigger for session-level changes.
 *
 * Subscribes to commandStore for messages and derives `sessionHasChanges`
 * independently.  Visible when the session has file changes and is not
 * actively streaming.
 *
 * Extracted from SessionPanel so it owns its own messages subscription,
 * preventing SessionPanel from re-rendering on every streaming chunk.
 */
import React, { useMemo } from 'react'
import { GitCompare } from 'lucide-react'
import { useCommandStore, selectSessionMessages } from '@/stores/commandStore'
import { hasFileChanges } from './extractFileChanges'
import type { ManagedSessionMessage } from '@shared/types'

interface SessionDiffButtonProps {
  sessionId: string
  isProcessing: boolean
  /** Narrow callback — receives the current messages snapshot for the diff dialog. */
  onShowDiff: (messages: ManagedSessionMessage[]) => void
}

export function SessionDiffButton({
  sessionId,
  isProcessing,
  onShowDiff,
}: SessionDiffButtonProps): React.JSX.Element | null {
  const messages = useCommandStore((s) => selectSessionMessages(s, sessionId))
  const sessionHasChanges = useMemo(() => hasFileChanges(messages), [messages])
  if (!sessionHasChanges || isProcessing) return null
  return (
    <button
      onClick={() => onShowDiff(messages)}
      className="flex items-center gap-1 p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] shrink-0"
      aria-label="View all session changes"
      title="View All Changes"
    >
      <GitCompare className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  )
}
