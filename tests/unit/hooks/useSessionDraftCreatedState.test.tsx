// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSessionDraftCreatedState } from '../../../src/renderer/hooks/useSessionDraftCreatedState'

describe('useSessionDraftCreatedState', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores and restores created issue id by exact draft identity', () => {
    const { result, rerender } = renderHook(
      ({ draftKey }) => useSessionDraftCreatedState({
        sessionId: 's1',
        draftType: 'issue',
        draftKey,
      }),
      {
        initialProps: { draftKey: 'issue-key-a' },
      }
    )

    act(() => {
      result.current.markIssueCreated('issue-123')
    })

    expect(result.current.createdIssueId).toBe('issue-123')
    expect(result.current.createdScheduleId).toBeNull()

    rerender({ draftKey: 'issue-key-b' })
    expect(result.current.createdIssueId).toBeNull()

    rerender({ draftKey: 'issue-key-a' })
    expect(result.current.createdIssueId).toBe('issue-123')
  })

  it('prunes expired entries and writes pruned store back on read path', () => {
    const now = Date.now()
    const old = now - 31 * 24 * 60 * 60 * 1000
    localStorage.setItem(
      'opencow:session-draft-created:v1:s2',
      JSON.stringify({
        entries: [
          { draftType: 'issue', draftKey: 'expired-key', entityId: 'issue-old', updatedAt: old },
          { draftType: 'issue', draftKey: 'fresh-key', entityId: 'issue-fresh', updatedAt: now },
        ],
      })
    )

    const { result } = renderHook(() =>
      useSessionDraftCreatedState({
        sessionId: 's2',
        draftType: 'issue',
        draftKey: 'fresh-key',
      })
    )

    expect(result.current.createdIssueId).toBe('issue-fresh')

    const persisted = JSON.parse(localStorage.getItem('opencow:session-draft-created:v1:s2') || '{}') as {
      entries?: Array<{ draftKey: string }>
    }
    expect(persisted.entries?.length).toBe(1)
    expect(persisted.entries?.[0]?.draftKey).toBe('fresh-key')
  })

  it('loads legacy v1 record map and resolves created state', () => {
    localStorage.setItem(
      'opencow:session-draft-created:v1:s3',
      JSON.stringify({
        'issue:old': {
          draftType: 'issue',
          draftKey: 'legacy-issue-key',
          entityId: 'issue-legacy',
          updatedAt: Date.now(),
        },
      })
    )

    const { result } = renderHook(() =>
      useSessionDraftCreatedState({
        sessionId: 's3',
        draftType: 'issue',
        draftKey: 'legacy-issue-key',
      })
    )

    expect(result.current.createdIssueId).toBe('issue-legacy')
  })
})
