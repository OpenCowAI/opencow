// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TaskProgressBar } from '../../../src/renderer/components/ui/TaskProgressBar'
import type { TaskSummary } from '../../../src/shared/types'

const summaryWithTasks: TaskSummary = {
  total: 5,
  completed: 2,
  inProgress: 1,
  pending: 2
}

const emptySummary: TaskSummary = {
  total: 0,
  completed: 0,
  inProgress: 0,
  pending: 0
}

describe('TaskProgressBar', () => {
  describe('default variant', () => {
    it('renders progress bar with correct ARIA attributes', () => {
      render(<TaskProgressBar taskSummary={summaryWithTasks} status="active" />)
      const bar = screen.getByRole('progressbar')
      expect(bar).toHaveAttribute('aria-valuenow', '40')
      expect(bar).toHaveAttribute('aria-valuemin', '0')
      expect(bar).toHaveAttribute('aria-valuemax', '100')
    })

    it('renders task count text', () => {
      render(<TaskProgressBar taskSummary={summaryWithTasks} status="active" />)
      expect(screen.getByText('2/5')).toBeInTheDocument()
    })

    it('renders Tasks label by default', () => {
      render(<TaskProgressBar taskSummary={summaryWithTasks} status="active" />)
      expect(screen.getByText('Tasks')).toBeInTheDocument()
    })

    it('returns null when total is 0', () => {
      const { container } = render(<TaskProgressBar taskSummary={emptySummary} status="active" />)
      expect(container.firstChild).toBeNull()
    })

    it('shows 100% for fully completed tasks', () => {
      const allDone: TaskSummary = { total: 3, completed: 3, inProgress: 0, pending: 0 }
      render(<TaskProgressBar taskSummary={allDone} status="completed" />)
      const bar = screen.getByRole('progressbar')
      expect(bar).toHaveAttribute('aria-valuenow', '100')
    })

    it('has accessible aria-label', () => {
      render(<TaskProgressBar taskSummary={summaryWithTasks} status="active" />)
      const bar = screen.getByRole('progressbar')
      expect(bar.getAttribute('aria-label')).toContain('2')
      expect(bar.getAttribute('aria-label')).toContain('5')
    })
  })

  describe('compact variant', () => {
    it('renders progress bar', () => {
      render(<TaskProgressBar taskSummary={summaryWithTasks} status="active" variant="compact" />)
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
    })

    it('renders task count text', () => {
      render(<TaskProgressBar taskSummary={summaryWithTasks} status="active" variant="compact" />)
      expect(screen.getByText('2/5')).toBeInTheDocument()
    })

    it('does NOT render Tasks label', () => {
      render(<TaskProgressBar taskSummary={summaryWithTasks} status="active" variant="compact" />)
      expect(screen.queryByText('Tasks')).not.toBeInTheDocument()
    })

    it('returns null when total is 0', () => {
      const { container } = render(
        <TaskProgressBar taskSummary={emptySummary} status="active" variant="compact" />
      )
      expect(container.firstChild).toBeNull()
    })
  })
})
