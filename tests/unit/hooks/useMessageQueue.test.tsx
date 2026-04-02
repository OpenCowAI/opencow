// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useMessageQueue } from '../../../src/renderer/hooks/useMessageQueue'
import { useCommandStore } from '../../../src/renderer/stores/commandStore'
import { makeManagedSession } from '../../helpers'

// IPC mocks used by commandStore.sendMessage / resumeSession
const sendMessageMock = vi.fn<(sessionId: string, content: unknown) => Promise<boolean>>()
const resumeSessionMock = vi.fn<(sessionId: string, content: unknown) => Promise<boolean>>()

vi.mock('@/windowAPI', () => ({
  getAppAPI: () => ({
    'command:send-message': sendMessageMock,
    'command:resume-session': resumeSessionMock,
  }),
}))

describe('useMessageQueue auto dispatch', () => {
  function seedSession(sessionId: string, state: 'awaiting_input' | 'streaming' | 'idle'): void {
    const snapshot = makeManagedSession({
      id: sessionId,
      state,
    })
    useCommandStore.setState({
      managedSessions: [snapshot],
      sessionById: { [sessionId]: snapshot },
      sessionMessages: {},
      streamingMessageBySession: {},
      activeManagedSessionId: null,
    })
  }

  beforeEach(() => {
    sendMessageMock.mockReset()
    resumeSessionMock.mockReset()
    sendMessageMock.mockResolvedValue(true)
    resumeSessionMock.mockResolvedValue(true)

    // Reset command store
    useCommandStore.getState().reset()

    // Prevent storage leakage across tests
    localStorage.clear()
  })

  it('dispatches immediately after enqueue when session is already ready', async () => {
    const sessionId = 'session-queue-auto-dispatch-ready'
    seedSession(sessionId, 'awaiting_input')

    const { result } = renderHook(() => useMessageQueue({ sessionId }))

    act(() => {
      result.current.enqueue('hello queued')
    })

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledTimes(1)
    })
    expect(sendMessageMock).toHaveBeenCalledWith(sessionId, 'hello queued')

    // Sent message should be removed from queue.
    await waitFor(() => {
      expect(result.current.queue).toHaveLength(0)
    })
  })

  it('dispatches when only sessionById reference changes (managedSessions ref stable)', async () => {
    const sessionId = 'session-queue-auto-dispatch-by-id'
    seedSession(sessionId, 'streaming')

    const { result } = renderHook(() => useMessageQueue({ sessionId }))

    act(() => {
      result.current.enqueue('message waits for ready')
    })

    // Not ready yet: enqueue should not dispatch.
    expect(sendMessageMock).toHaveBeenCalledTimes(0)

    // Keep the same managedSessions array reference, only update sessionById.
    const prev = useCommandStore.getState()
    const updated = {
      ...prev.sessionById[sessionId],
      state: 'idle' as const,
    }
    act(() => {
      useCommandStore.setState({
        managedSessions: prev.managedSessions,
        sessionById: { ...prev.sessionById, [sessionId]: updated },
      })
    })

    // New logic should react to sessionById ref change and re-dispatch.
    await waitFor(() => {
      expect(resumeSessionMock).toHaveBeenCalledTimes(1)
    })
    expect(resumeSessionMock).toHaveBeenCalledWith(sessionId, 'message waits for ready')
    expect(sendMessageMock).toHaveBeenCalledTimes(0)
  })
})
