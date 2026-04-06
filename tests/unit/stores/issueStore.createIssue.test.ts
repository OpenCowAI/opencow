// SPDX-License-Identifier: Apache-2.0

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_VIEW } from '../../../src/shared/types'
import { useAppStore } from '../../../src/renderer/stores/appStore'
import { useIssueStore } from '../../../src/renderer/stores/issueStore'
import { makeIssue, makeIssueSummary, resetIssueStore, setAppStoreIssues } from '../../helpers'

const hoisted = vi.hoisted(() => ({
  api: {} as Record<string, unknown>,
  queryIssueSummaries: vi.fn(),
  steps: [] as string[],
}))

vi.mock('@/windowAPI', () => ({
  getAppAPI: () => hoisted.api,
}))

vi.mock('@/lib/query/issueQueryService', () => ({
  queryIssueSummaries: hoisted.queryIssueSummaries,
}))

describe('issueStore.createIssue', () => {
  beforeEach(() => {
    resetIssueStore()
    hoisted.queryIssueSummaries.mockReset()
    hoisted.steps.length = 0
    for (const key of Object.keys(hoisted.api)) delete hoisted.api[key]

    useAppStore.setState({
      appView: { mode: 'projects', tab: 'issues', projectId: null },
      activeViewId: ALL_VIEW.id,
      allViewDisplay: { ...ALL_VIEW.display },
      ephemeralFilters: {},
      selectedIssueId: 'issue-old',
    })
  })

  it('invokes onCreated callback before list reload so callers can update selection first', async () => {
    const oldSummary = makeIssueSummary({ id: 'issue-old', title: 'Old task', updatedAt: 10, createdAt: 10 })
    const newSummary = makeIssueSummary({ id: 'issue-new', title: 'New task', updatedAt: 20, createdAt: 20 })
    const created = makeIssue({ id: 'issue-new', title: 'New task', updatedAt: 20, createdAt: 20 })
    setAppStoreIssues([oldSummary])

    hoisted.api['create-issue'] = vi.fn(async () => {
      hoisted.steps.push('create-issue')
      return created
    })
    hoisted.queryIssueSummaries.mockImplementation(async () => {
      hoisted.steps.push('load-issues')
      return [newSummary, oldSummary]
    })

    const onCreated = vi.fn((issue: { id: string }) => {
      hoisted.steps.push(`on-created:${issue.id}`)
    })

    await (
      useIssueStore.getState().createIssue as unknown as
      (input: { title: string }, options: { onCreated: (issue: { id: string }) => void }) => Promise<void>
    )(
      { title: 'New task' },
      { onCreated },
    )

    expect(onCreated).toHaveBeenCalledOnce()
    expect(hoisted.steps).toEqual([
      'create-issue',
      'on-created:issue-new',
      'load-issues',
    ])
  })
})
