// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest'
import { StreamState } from '../../../electron/command/streamState'

describe('StreamState', () => {
  let state: StreamState

  beforeEach(() => {
    state = new StreamState()
  })

  it('initial state: isStreaming is false and streamingMessageId is null', () => {
    expect(state.isStreaming).toBe(false)
    expect(state.streamingMessageId).toBeNull()
  })

  it('beginStreaming() sets message ID and isStreaming', () => {
    state.beginStreaming('msg-123')
    expect(state.isStreaming).toBe(true)
    expect(state.streamingMessageId).toBe('msg-123')
  })

  it('finalizeStreaming() returns the message ID and resets state', () => {
    state.beginStreaming('msg-456')
    const id = state.finalizeStreaming()
    expect(id).toBe('msg-456')
    expect(state.isStreaming).toBe(false)
    expect(state.streamingMessageId).toBeNull()
  })

  it('finalizeStreaming() returns null when not streaming', () => {
    const id = state.finalizeStreaming()
    expect(id).toBeNull()
  })
})
