// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest'
import { selectSessionForIssue } from '../../../src/renderer/hooks/useSessionForIssue'
import {
  makeIssueSummary,
  makeManagedSession,
  resetCommandStore,
  setCommandStoreSessions,
  setAppStoreIssues,
} from '../../helpers'

describe('selectSessionForIssue', () => {
  beforeEach(() => {
    setAppStoreIssues([])
    resetCommandStore()
  })

  it('returns null when issue has no sessionId', () => {
    const issue = makeIssueSummary({ id: 'issue-1', sessionId: null })
    const session = makeManagedSession({ id: 'session-1' })
    setAppStoreIssues([issue])
    setCommandStoreSessions([session])
    expect(selectSessionForIssue('issue-1')).toBeNull()
  })

  it('returns null when issue.sessionId points to non-existent session', () => {
    const issue = makeIssueSummary({ id: 'issue-1', sessionId: 'ghost-session' })
    setAppStoreIssues([issue])
    expect(selectSessionForIssue('issue-1')).toBeNull()
  })

  it('returns session when issue.sessionId matches a managed session', () => {
    const issue = makeIssueSummary({ id: 'issue-1', sessionId: 'session-1' })
    const session = makeManagedSession({ id: 'session-1', state: 'streaming' })
    setAppStoreIssues([issue])
    setCommandStoreSessions([session])
    const result = selectSessionForIssue('issue-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('session-1')
    expect(result!.state).toBe('streaming')
  })

  it('returns session even when engine/session refs differ from id', () => {
    const issue = makeIssueSummary({ id: 'issue-1', sessionId: 'session-1' })
    const session = makeManagedSession({
      id: 'session-1',
      engineSessionRef: 'c66a28ba-561a-4a30-83ea-cc4f038ac728',
    })
    setAppStoreIssues([issue])
    setCommandStoreSessions([session])
    const result = selectSessionForIssue('issue-1')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('session-1')
    expect(result!.engineSessionRef).toBe('c66a28ba-561a-4a30-83ea-cc4f038ac728')
  })

  it('returns null when issueId not found', () => {
    expect(selectSessionForIssue('nonexistent')).toBeNull()
  })
})
