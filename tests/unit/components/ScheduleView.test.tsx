// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ScheduleView } from '../../../src/renderer/components/ScheduleView/ScheduleView'
import { useAppStore } from '../../../src/renderer/stores/appStore'
import { useScheduleStore } from '../../../src/renderer/stores/scheduleStore'
import type { Project, Schedule, SchedulePipeline } from '../../../src/shared/types'

vi.mock('../../../src/renderer/components/ScheduleView/ScheduleFormModal', () => ({
  ScheduleFormModal: () => null,
}))

vi.mock('../../../src/renderer/components/ScheduleAICreator', () => ({
  ScheduleAICreatorModal: () => null,
}))

vi.mock('../../../src/renderer/hooks/useScheduleCountdown', () => ({
  useScheduleCountdown: () => 'in 1h',
}))

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    path: '/tmp/proj-1',
    name: 'Project 1',
    sessionCount: 0,
    pinOrder: null,
    archivedAt: null,
    displayOrder: 0,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sch-1',
    name: 'Daily Review',
    description: '',
    trigger: {
      time: {
        type: 'daily',
        workMode: 'all_days',
        timezone: 'Asia/Shanghai',
        timeOfDay: '09:00',
      },
    },
    action: {
      type: 'start_session',
      projectId: 'proj-1',
      session: { promptTemplate: 'Run review' },
    },
    priority: 'normal',
    failurePolicy: {
      maxRetries: 0,
      retryBackoff: 'fixed',
      retryDelayMs: 0,
      pauseAfterConsecutiveFailures: 0,
      notifyOnFailure: false,
      webhookOnFailure: false,
    },
    missedPolicy: 'skip',
    concurrencyPolicy: 'skip',
    status: 'active',
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunError: null,
    executionCount: 0,
    consecutiveFailures: 0,
    projectId: 'proj-1',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

function resetScheduleStore(): void {
  useScheduleStore.setState({
    schedules: [],
    pipelines: [],
    selectedScheduleId: null,
    scheduleExecutions: {},
  })
}

function resetAppStore(): void {
  useAppStore.setState({
    appView: { mode: 'projects', tab: 'schedule', projectId: null },
    projects: [],
    detailContext: null,
    selectedSessionDetail: null,
  })
}

describe('ScheduleView', () => {
  beforeEach(() => {
    resetAppStore()
    resetScheduleStore()
  })

  it('shows project filter bar in All Projects context and uses "All" label', () => {
    useAppStore.setState({
      projects: [
        makeProject({ id: 'proj-1', name: 'Project Alpha', displayOrder: 0 }),
        makeProject({ id: 'proj-2', name: 'Project Beta', displayOrder: 1 }),
      ],
      appView: { mode: 'projects', tab: 'schedule', projectId: null },
    })
    useScheduleStore.setState({
      schedules: [
        makeSchedule({ id: 'sch-a', name: 'Alpha Schedule', projectId: 'proj-1', action: { type: 'start_session', projectId: 'proj-1', session: { promptTemplate: 'A' } } }),
        makeSchedule({ id: 'sch-b', name: 'Beta Schedule', projectId: 'proj-2', action: { type: 'start_session', projectId: 'proj-2', session: { promptTemplate: 'B' } } }),
      ],
      pipelines: [] as SchedulePipeline[],
    })

    render(<ScheduleView />)

    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Project Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Project Beta' })).toBeInTheDocument()
  })

  it('hides project filter bar when a concrete project is selected', () => {
    useAppStore.setState({
      projects: [
        makeProject({ id: 'proj-1', name: 'Project Alpha', displayOrder: 0 }),
        makeProject({ id: 'proj-2', name: 'Project Beta', displayOrder: 1 }),
      ],
      appView: { mode: 'projects', tab: 'schedule', projectId: 'proj-1' },
    })
    useScheduleStore.setState({
      schedules: [
        makeSchedule({ id: 'sch-a', name: 'Alpha Schedule', projectId: 'proj-1', action: { type: 'start_session', projectId: 'proj-1', session: { promptTemplate: 'A' } } }),
        makeSchedule({ id: 'sch-b', name: 'Beta Schedule', projectId: 'proj-2', action: { type: 'start_session', projectId: 'proj-2', session: { promptTemplate: 'B' } } }),
      ],
      pipelines: [] as SchedulePipeline[],
    })

    render(<ScheduleView />)

    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Project Alpha' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Project Beta' })).not.toBeInTheDocument()
  })

  it('filters schedules by project pill only in All Projects scope', () => {
    useAppStore.setState({
      projects: [
        makeProject({ id: 'proj-1', name: 'Project Alpha', displayOrder: 0 }),
        makeProject({ id: 'proj-2', name: 'Project Beta', displayOrder: 1 }),
      ],
      appView: { mode: 'projects', tab: 'schedule', projectId: null },
    })
    useScheduleStore.setState({
      schedules: [
        makeSchedule({ id: 'sch-a', name: 'Alpha Schedule', projectId: 'proj-1', action: { type: 'start_session', projectId: 'proj-1', session: { promptTemplate: 'A' } } }),
        makeSchedule({ id: 'sch-b', name: 'Beta Schedule', projectId: 'proj-2', action: { type: 'start_session', projectId: 'proj-2', session: { promptTemplate: 'B' } } }),
      ],
      pipelines: [] as SchedulePipeline[],
    })

    render(<ScheduleView />)

    expect(screen.getByText('Alpha Schedule')).toBeInTheDocument()
    expect(screen.getByText('Beta Schedule')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Project Beta' }))

    expect(screen.queryByText('Alpha Schedule')).not.toBeInTheDocument()
    expect(screen.getByText('Beta Schedule')).toBeInTheDocument()
  })

  it('enforces selected project scope when project is selected from sidebar', () => {
    useAppStore.setState({
      projects: [
        makeProject({ id: 'proj-1', name: 'Project Alpha', displayOrder: 0 }),
        makeProject({ id: 'proj-2', name: 'Project Beta', displayOrder: 1 }),
      ],
      appView: { mode: 'projects', tab: 'schedule', projectId: 'proj-1' },
    })
    useScheduleStore.setState({
      schedules: [
        makeSchedule({ id: 'sch-a', name: 'Alpha Schedule', projectId: 'proj-1', action: { type: 'start_session', projectId: 'proj-1', session: { promptTemplate: 'A' } } }),
        makeSchedule({ id: 'sch-b', name: 'Beta Schedule', projectId: 'proj-2', action: { type: 'start_session', projectId: 'proj-2', session: { promptTemplate: 'B' } } }),
      ],
      pipelines: [] as SchedulePipeline[],
    })

    render(<ScheduleView />)

    expect(screen.getByText('Alpha Schedule')).toBeInTheDocument()
    expect(screen.queryByText('Beta Schedule')).not.toBeInTheDocument()
  })
})

