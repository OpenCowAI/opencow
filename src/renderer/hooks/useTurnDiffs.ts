// SPDX-License-Identifier: Apache-2.0

/**
 * useTurnDiffs — Computes which conversation turns contain file changes.
 *
 * Extracted from SessionMessageList.tsx.  Scans messages to identify
 * turn boundaries, checks each completed turn for file changes, and
 * manages the "View Changes" dialog state.
 *
 * A turn is the sequence of assistant/system messages between two
 * visible user messages.  Historical turns are always considered
 * complete; the current (last) turn requires the session to have
 * settled (not streaming/creating).
 */

import { useRef, useMemo } from 'react'
import { useDialogState } from '@/hooks/useModalAnimation'
import { hasFileChanges, countChangedFiles } from '@/components/DetailPanel/SessionPanel/extractFileChanges'
import { getUserMessageDisplayInfo } from '@/components/DetailPanel/SessionPanel/messageDisplayUtils'
import type { ManagedSessionMessage, ManagedSessionState } from '@shared/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TurnDiffInfo {
  turnMessages: ManagedSessionMessage[]
  firstMessageId: string
  fileCount: number
}

export interface TurnDiffDialogData {
  messages: ManagedSessionMessage[]
  turnAnchorMessageId: string
}

export interface UseTurnDiffsReturn {
  /** Ref to the current turnDiffMap — read from renderItem to avoid useCallback invalidation. */
  turnDiffMapRef: React.RefObject<Map<string, TurnDiffInfo>>
  /** Dialog state for the per-turn diff viewer. */
  turnDiffDialog: {
    open: boolean
    data: TurnDiffDialogData | null
    show: (data: TurnDiffDialogData) => void
    close: () => void
  }
  /** Stable reference to turnDiffDialog.show — safe for useCallback deps. */
  showTurnDiffDialog: (data: TurnDiffDialogData) => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTurnDiffs(
  messages: ManagedSessionMessage[],
  sessionState?: ManagedSessionState,
): UseTurnDiffsReturn {
  /** Session has finished the current turn and is no longer producing changes. */
  const isTurnSettled = !sessionState
    || sessionState === 'idle'
    || sessionState === 'awaiting_input'
    || sessionState === 'stopped'
    || sessionState === 'error'

  const turnDiffMap = useMemo(() => {
    const map = new Map<string, TurnDiffInfo>()
    let turnMsgs: ManagedSessionMessage[] = []
    let lastAssistantId: string | null = null

    const isVisibleUser = (msg: ManagedSessionMessage): boolean =>
      msg.role === 'user' && !getUserMessageDisplayInfo(msg.content).isEmpty

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

  const turnDiffDialog = useDialogState<TurnDiffDialogData>()

  // Extract stable callback — useDialogState returns a new object literal every
  // render, but .show is a useCallback([], []) with stable identity.  Using the
  // extracted reference in renderItem's deps keeps the useCallback effective.
  const showTurnDiffDialog = turnDiffDialog.show

  return { turnDiffMapRef, turnDiffDialog, showTurnDiffDialog }
}
