// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { SessionDraftFooter } from '../../../src/renderer/components/DetailPanel/SessionPanel/SessionDraftFooter'
import type { ParsedIssueOutput } from '../../../src/shared/issueOutputParser'
import type { ParsedScheduleOutput } from '../../../src/shared/scheduleOutputParser'

vi.mock('../../../src/renderer/components/IssueForm/IssueFormModal', () => ({
  IssueFormModal: () => <div data-testid="issue-form-modal">Issue Form Modal</div>,
}))

vi.mock('../../../src/renderer/components/ScheduleView/ScheduleFormModal', () => ({
  ScheduleFormModal: () => <div data-testid="schedule-form-modal">Schedule Form Modal</div>,
}))

vi.mock('../../../src/renderer/hooks/useDraftApplyActions', () => ({
  useDraftApplyActions: () => ({
    applyIssueDraft: vi.fn(async (params: { parsed: ParsedIssueOutput }) => ({
      id: 'created-issue-1',
      title: params.parsed.title,
      description: params.parsed.description,
      status: params.parsed.status,
      priority: params.parsed.priority,
      labels: params.parsed.labels,
      projectId: params.parsed.projectId ?? null,
      parentIssueId: params.parsed.parentIssueId ?? null,
      sessionId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
    applyScheduleDraft: vi.fn(async (params: { parsed: ParsedScheduleOutput }) => ({
      id: 'created-schedule-1',
      name: params.parsed.name,
      description: params.parsed.description,
      priority: params.parsed.priority,
      triggerType: 'scheduled',
      actionType: 'start_session',
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
  }),
}))

describe('SessionDraftFooter — Phase C', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  const issueDraftA: ParsedIssueOutput = {
    title: 'Issue Draft A',
    description: 'Issue A description',
    status: 'todo',
    priority: 'medium',
    labels: ['bug'],
    projectId: 'project-1',
    parentIssueId: null,
  }

  const issueDraftB: ParsedIssueOutput = {
    title: 'Issue Draft B',
    description: 'Issue B description',
    status: 'in_progress',
    priority: 'high',
    labels: ['enhancement'],
    projectId: 'project-1',
    parentIssueId: null,
  }

  it('resets editing issue modal when activeDraftKey changes', async () => {
    const { rerender } = render(
      <SessionDraftFooter
        sessionId="session-test-1"
        activeDraftKey="draft-key-a"
        activeDraftType="issue"
        latestIssueDraft={issueDraftA}
        latestScheduleDraft={null}
        projectId="project-1"
        issueCreationMode="standalone"
      />
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /edit fields/i }))
    expect(screen.getByTestId('issue-form-modal')).toBeInTheDocument()

    rerender(
      <SessionDraftFooter
        sessionId="session-test-1"
        activeDraftKey="draft-key-b"
        activeDraftType="issue"
        latestIssueDraft={issueDraftB}
        latestScheduleDraft={null}
        projectId="project-1"
        issueCreationMode="standalone"
      />
    )

    expect(screen.queryByTestId('issue-form-modal')).toBeNull()
    expect(screen.getByText('Issue Draft B')).toBeInTheDocument()
  })

  it('returns null when active draft type and payload do not match', () => {
    const { container } = render(
      <SessionDraftFooter
        sessionId="session-test-1"
        activeDraftKey="mismatch-key"
        activeDraftType="schedule"
        latestIssueDraft={issueDraftA}
        latestScheduleDraft={null}
        projectId="project-1"
        issueCreationMode="standalone"
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('resets editing schedule modal when activeDraftKey changes', async () => {
    const scheduleDraftA: ParsedScheduleOutput = {
      name: 'Schedule Draft A',
      description: 'A description',
      frequency: 'weekly',
      timeOfDay: '10:30',
      daysOfWeek: [1, 3, 5],
      prompt: 'Run schedule A',
      systemPrompt: 'Use strict style A',
      priority: 'high',
      projectId: 'project-1',
    }
    const scheduleDraftB: ParsedScheduleOutput = {
      name: 'Schedule Draft B',
      description: 'B description',
      frequency: 'daily',
      timeOfDay: '09:00',
      prompt: 'Run schedule B',
      systemPrompt: 'Use strict style B',
      priority: 'normal',
      projectId: 'project-1',
    }

    const { rerender } = render(
      <SessionDraftFooter
        sessionId="session-test-1"
        activeDraftKey="schedule-key-a"
        activeDraftType="schedule"
        latestIssueDraft={null}
        latestScheduleDraft={scheduleDraftA}
        projectId="project-1"
        issueCreationMode="standalone"
      />
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /edit fields/i }))
    expect(screen.getByTestId('schedule-form-modal')).toBeInTheDocument()

    rerender(
      <SessionDraftFooter
        sessionId="session-test-1"
        activeDraftKey="schedule-key-b"
        activeDraftType="schedule"
        latestIssueDraft={null}
        latestScheduleDraft={scheduleDraftB}
        projectId="project-1"
        issueCreationMode="standalone"
      />
    )

    expect(screen.queryByTestId('schedule-form-modal')).toBeNull()
    expect(screen.getByText('Schedule Draft B')).toBeInTheDocument()
  })

  it('restores created issue state for the same session draft after remount', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <SessionDraftFooter
        sessionId="session-persist-1"
        activeDraftKey="persist-issue-key"
        activeDraftType="issue"
        latestIssueDraft={issueDraftA}
        latestScheduleDraft={null}
        projectId="project-1"
        issueCreationMode="standalone"
      />
    )

    await user.click(screen.getByRole('button', { name: /create issue/i }))
    expect(await screen.findByText('View')).toBeInTheDocument()

    unmount()

    render(
      <SessionDraftFooter
        sessionId="session-persist-1"
        activeDraftKey="persist-issue-key"
        activeDraftType="issue"
        latestIssueDraft={issueDraftA}
        latestScheduleDraft={null}
        projectId="project-1"
        issueCreationMode="standalone"
      />
    )

    expect(screen.getByText('View')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create issue/i })).toBeNull()
  })

  it('does not reuse created state when draft key changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <SessionDraftFooter
        sessionId="session-persist-2"
        activeDraftKey="old-key"
        activeDraftType="issue"
        latestIssueDraft={issueDraftA}
        latestScheduleDraft={null}
        projectId="project-1"
        issueCreationMode="standalone"
      />
    )

    await user.click(screen.getByRole('button', { name: /create issue/i }))
    expect(await screen.findByText('View')).toBeInTheDocument()

    rerender(
      <SessionDraftFooter
        sessionId="session-persist-2"
        activeDraftKey="new-key"
        activeDraftType="issue"
        latestIssueDraft={issueDraftB}
        latestScheduleDraft={null}
        projectId="project-1"
        issueCreationMode="standalone"
      />
    )

    expect(screen.getByRole('button', { name: /create issue/i })).toBeInTheDocument()
  })
})

afterEach(() => {
  cleanup()
})
