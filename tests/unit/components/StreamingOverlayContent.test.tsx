// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { StreamingOverlayContent } from '../../../src/renderer/components/DetailPanel/SessionPanel/StreamingOverlayContent'
import { useCommandStore } from '../../../src/renderer/stores/commandStore'
import { makeManagedSession } from '../../helpers'
import type { ManagedSessionMessage } from '../../../src/shared/types'

function userMsg(id: string, text: string): ManagedSessionMessage {
  return {
    id,
    role: 'user',
    timestamp: Date.now(),
    content: [{ type: 'text', text }],
  }
}

function assistantTodoMsg(
  id: string,
  todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }>,
): ManagedSessionMessage {
  return {
    id,
    role: 'assistant',
    timestamp: Date.now(),
    isStreaming: false,
    content: [
      {
        type: 'tool_use',
        id: `${id}-todo`,
        name: 'TodoWrite',
        input: { todos },
      },
    ],
  }
}

describe('StreamingOverlayContent todo lifecycle', () => {
  const sessionId = 'session-overlay-todo'

  beforeEach(() => {
    useCommandStore.getState().reset()
    const snapshot = makeManagedSession({
      id: sessionId,
      state: 'idle',
    })
    useCommandStore.setState({
      managedSessions: [snapshot],
      sessionById: { [sessionId]: snapshot },
      sessionMessages: { [sessionId]: [] },
      streamingMessageBySession: {},
      latestTodosBySession: {},
      activeManagedSessionId: null,
    })
  })

  it('shows todo pill while open todos exist, updates stats, and hides after all completed', () => {
    render(
      <StreamingOverlayContent
        sessionId={sessionId}
        isProcessing={false}
        isSessionPaused={true}
      />,
    )

    // Initial: no todos => no pill
    expect(screen.queryByLabelText('Toggle task list')).toBeNull()

    // Phase 1: first TodoWrite has open items => pill appears
    act(() => {
      useCommandStore.getState().appendSessionMessage(sessionId, userMsg('u1', 'do work'))
      useCommandStore.getState().appendSessionMessage(
        sessionId,
        assistantTodoMsg('a1', [
          { content: 'Task A', status: 'pending' },
          { content: 'Task B', status: 'pending' },
        ]),
      )
    })

    expect(screen.getByLabelText('Toggle task list')).toBeInTheDocument()
    expect(screen.getByText('○2')).toBeInTheDocument()

    // Phase 2: same turn updates one item to completed => stats update
    act(() => {
      useCommandStore.getState().appendSessionMessage(
        sessionId,
        assistantTodoMsg('a2', [
          { content: 'Task A', status: 'completed' },
          { content: 'Task B', status: 'pending' },
        ]),
      )
    })

    expect(screen.getByText('✓1')).toBeInTheDocument()
    expect(screen.getByText('○1')).toBeInTheDocument()

    // Phase 3: all completed => latest open todos become null, pill disappears
    act(() => {
      useCommandStore.getState().appendSessionMessage(
        sessionId,
        assistantTodoMsg('a3', [
          { content: 'Task A', status: 'completed' },
          { content: 'Task B', status: 'completed' },
        ]),
      )
    })

    expect(screen.queryByLabelText('Toggle task list')).toBeNull()
    expect(screen.queryByText('✓1')).toBeNull()
    expect(screen.queryByText('○1')).toBeNull()
  })
})
