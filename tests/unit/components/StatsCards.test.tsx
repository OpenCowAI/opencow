// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { StatsCards } from '../../../src/renderer/components/DashboardView/StatsCards'
import type { DashboardStats } from '../../../src/renderer/selectors/dashboardSelectors'

const SAMPLE_STATS: DashboardStats = {
  totalSessions: 4,
  sessionStatusCounts: { active: 1, waiting: 1, completed: 2, error: 0 },
  totalIssues: 6,
  issueStatusCounts: {
    backlog: 1,
    todo: 2,
    in_progress: 2,
    done: 1,
    cancelled: 0,
  },
  issueCompletionRate: 1 / 6,
  totalTasks: 10,
  taskCompletionRate: 0.5,
  todayTokens: 0,
  todayCost: 0,
}

describe('StatsCards', () => {
  it('renders custom actions on the right side when provided', () => {
    render(
      <StatsCards
        stats={SAMPLE_STATS}
        actions={<button type="button">Project Settings</button>}
      />,
    )

    expect(screen.getByRole('button', { name: 'Project Settings' })).toBeInTheDocument()
  })
})
