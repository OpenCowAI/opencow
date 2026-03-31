// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_WINDOW_KEY } from '../../../src/shared/appIdentity'
import type { IssueSummary } from '../../../src/shared/types'

function makeIssueSummary(overrides: Partial<IssueSummary> = {}): IssueSummary {
  return {
    id: 'issue-1',
    projectId: 'proj-1',
    title: 'Issue',
    status: 'open',
    priority: 'medium',
    labels: [],
    sessionId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    readAt: null,
    sourceSessionId: null,
    sourceMessageIndex: null,
    sourceMessageType: null,
    sourceMessageRole: null,
    lastAgentActivityAt: null,
    parentIssueId: null,
    // Remote issue tracking
    providerId: null,
    remoteNumber: null,
    remoteUrl: null,
    remoteState: null,
    remoteSyncedAt: null,
    // Phase 2
    assignees: null,
    milestone: null,
    syncStatus: null,
    remoteUpdatedAt: null,
    ...overrides,
  }
}

describe('issueQueryService', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {}
  })

  it('de-duplicates semantically equivalent concurrent filters', async () => {
    const firstResult = [makeIssueSummary({ id: 'issue-a' })]
    let resolveRequest: ((value: IssueSummary[]) => void) | null = null

    const listIssues = vi.fn(() => new Promise<IssueSummary[]>((resolve) => {
      resolveRequest = resolve
    }))

    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {
      'list-issues': listIssues,
    }

    const service = await import('../../../src/renderer/lib/query/issueQueryService')

    const queryA = service.queryIssueSummaries({
      filter: { statuses: ['open', 'closed', 'open'], labels: ['ui', 'bug'] },
    })
    const queryB = service.queryIssueSummaries({
      filter: { statuses: ['closed', 'open'], labels: ['bug', 'ui', 'bug'] },
    })

    expect(listIssues).toHaveBeenCalledTimes(1)
    resolveRequest?.(firstResult)

    await expect(queryA).resolves.toEqual(firstResult)
    await expect(queryB).resolves.toEqual(firstResult)
  })

  it('does not cache completed responses across calls', async () => {
    const firstResult = [makeIssueSummary({ id: 'issue-a' })]
    const secondResult = [makeIssueSummary({ id: 'issue-b' })]

    const listIssues = vi
      .fn<() => Promise<IssueSummary[]>>()
      .mockResolvedValueOnce(firstResult)
      .mockResolvedValueOnce(secondResult)

    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {
      'list-issues': listIssues,
    }

    const service = await import('../../../src/renderer/lib/query/issueQueryService')

    const first = await service.queryIssueSummaries({ filter: { statuses: ['open'] } })
    const second = await service.queryIssueSummaries({ filter: { statuses: ['open'] } })

    expect(first).toEqual(firstResult)
    expect(second).toEqual(secondResult)
    expect(listIssues).toHaveBeenCalledTimes(2)
  })
})
