// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { CommandRouter } from '../../../../electron/services/messaging/commandRouter'

describe('CommandRouter', () => {
  const router = new CommandRouter()

  it('parses /status command', () => {
    expect(router.parse('/status')).toEqual({ action: 'status', args: {} })
  })

  it('parses /sessions command', () => {
    expect(router.parse('/sessions')).toEqual({ action: 'sessions', args: {} })
  })

  it('parses /ask command with prompt (/new alias)', () => {
    expect(router.parse('/ask Fix the login bug')).toEqual({
      action: 'new', args: { prompt: 'Fix the login bug' },
    })
  })

  it('parses command with @botname suffix (group chat scenario)', () => {
    expect(router.parse('/status@my_bot')).toEqual({ action: 'status', args: {} })
  })

  it('parses /reply with session ID and message', () => {
    expect(router.parse('/reply sess-123 Yes, go ahead')).toEqual({
      action: 'reply',
      args: { sessionId: 'sess-123', message: 'Yes, go ahead' },
    })
  })

  it('parses /stop with session ID', () => {
    expect(router.parse('/stop sess-123')).toEqual({
      action: 'stop', args: { sessionId: 'sess-123' },
    })
  })

  it('parses /issues command', () => {
    expect(router.parse('/issues')).toEqual({ action: 'issues', args: {} })
  })

  it('parses /inbox command', () => {
    expect(router.parse('/inbox')).toEqual({ action: 'inbox', args: {} })
  })

  it('parses /help and /start commands', () => {
    expect(router.parse('/help')).toEqual({ action: 'help', args: {} })
    expect(router.parse('/start')).toEqual({ action: 'help', args: {} })
  })

  it('routes unprefixed text as chat (continues current session)', () => {
    expect(router.parse('Help me fix the login bug')).toEqual({
      action: 'chat', args: { prompt: 'Help me fix the login bug' },
    })
  })

  it('handles empty string', () => {
    expect(router.parse('')).toEqual({ action: 'help', args: {} })
  })
})
