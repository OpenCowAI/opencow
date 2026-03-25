// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import {
  TaskExecutionView,
  TaskEventsProvider,
  type TaskEventsMap,
  type TaskLifecycleInfo,
} from '../../../src/renderer/components/DetailPanel/SessionPanel/TaskWidgets'
import type { ToolUseBlock } from '../../../src/shared/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTaskBlock(overrides: Partial<ToolUseBlock> = {}): ToolUseBlock {
  return {
    type: 'tool_use',
    id: 'task-1',
    name: 'Task',
    input: {
      subagent_type: 'Explore',
      description: 'Search codebase',
      prompt: 'Find all API endpoints',
      model: 'haiku',
    },
    ...overrides,
  }
}

function renderWithTaskEvents(
  ui: React.ReactElement,
  lifecycle?: Partial<TaskLifecycleInfo>,
  toolUseId = 'task-1',
) {
  const map: TaskEventsMap = new Map()
  if (lifecycle) {
    map.set(toolUseId, { state: 'pending', ...lifecycle })
  }
  return render(
    <TaskEventsProvider value={map}>
      {ui}
    </TaskEventsProvider>,
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TaskExecutionView', () => {
  // ── Basic rendering ──────────────────────────────────────────────────────

  it('renders agent type badge and description', () => {
    renderWithTaskEvents(<TaskExecutionView block={makeTaskBlock()} />)
    expect(screen.getByText('Explore')).toBeInTheDocument()
    expect(screen.getByText('Search codebase')).toBeInTheDocument()
  })

  it('shows generic Agent label for unknown subagent types', () => {
    renderWithTaskEvents(
      <TaskExecutionView block={makeTaskBlock({ input: { subagent_type: '', description: 'test' } })} />,
    )
    expect(screen.getByText('Agent')).toBeInTheDocument()
  })

  // ── State derivation ─────────────────────────────────────────────────────

  it('shows "Launching" when no lifecycle and not executing', () => {
    renderWithTaskEvents(<TaskExecutionView block={makeTaskBlock()} />)
    expect(screen.getByText('Launching\u2026')).toBeInTheDocument()
  })

  it('shows "Running" when isExecuting is true (even without lifecycle)', () => {
    renderWithTaskEvents(
      <TaskExecutionView block={makeTaskBlock()} isExecuting />,
    )
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('promotes pending → running when isExecuting is true (P1 fix)', () => {
    // lifecycle.state is 'pending' but isExecuting signals active execution
    renderWithTaskEvents(
      <TaskExecutionView block={makeTaskBlock()} isExecuting />,
      { state: 'pending' },
    )
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('shows "Completed" when lifecycle reports completed', () => {
    renderWithTaskEvents(
      <TaskExecutionView block={makeTaskBlock()} />,
      { state: 'completed', durationMs: 3200 },
    )
    // Duration replaces the label when usage is available
    expect(screen.getByText('3.2s')).toBeInTheDocument()
  })

  it('shows "Failed" when lifecycle reports failed', () => {
    renderWithTaskEvents(
      <TaskExecutionView block={makeTaskBlock()} />,
      { state: 'failed' },
    )
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('shows "Interrupted" when lifecycle reports stopped', () => {
    renderWithTaskEvents(
      <TaskExecutionView block={makeTaskBlock()} />,
      { state: 'stopped' },
    )
    expect(screen.getByText('Interrupted')).toBeInTheDocument()
  })

  // ── Expandable content ───────────────────────────────────────────────────

  it('does not show chevron when no expandable content', () => {
    renderWithTaskEvents(<TaskExecutionView block={makeTaskBlock()} />)
    // No summary, no resultContent, no progress → no expand toggle
    const buttons = screen.getAllByRole('button')
    for (const btn of buttons) {
      expect(btn).not.toHaveAttribute('aria-expanded')
    }
  })

  it('expands to show summary on click', async () => {
    const user = userEvent.setup()
    renderWithTaskEvents(
      <TaskExecutionView block={makeTaskBlock()} />,
      { state: 'completed', summary: 'Found 12 API endpoints in src/routes' },
    )
    const toggle = screen.getByRole('button', { expanded: false })
    await user.click(toggle)
    expect(screen.getByText('Found 12 API endpoints in src/routes')).toBeInTheDocument()
  })

  it('expands to show usage stats', async () => {
    const user = userEvent.setup()
    renderWithTaskEvents(
      <TaskExecutionView block={makeTaskBlock()} />,
      {
        state: 'completed',
        summary: 'Done',
        durationMs: 5400,
        totalTokens: 12500,
        toolUses: 7,
      },
    )
    await user.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('12.5k tokens')).toBeInTheDocument()
    expect(screen.getByText(/7 tools/)).toBeInTheDocument()
  })

  // ── Result output ────────────────────────────────────────────────────────

  it('shows result content in expanded view', async () => {
    const user = userEvent.setup()
    renderWithTaskEvents(
      <TaskExecutionView block={makeTaskBlock()} />,
      {
        state: 'completed',
        summary: 'Done',
        resultContent: 'Found: src/api/routes.ts\nFound: src/api/users.ts',
      },
    )
    await user.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText(/src\/api\/routes\.ts/)).toBeInTheDocument()
  })

  it('marks error results with red border', async () => {
    const user = userEvent.setup()
    renderWithTaskEvents(
      <TaskExecutionView block={makeTaskBlock()} />,
      {
        state: 'failed',
        summary: 'Error occurred',
        resultContent: 'TypeError: undefined is not a function',
        resultIsError: true,
      },
    )
    await user.click(screen.getByRole('button', { expanded: false }))
    const resultContainer = screen.getByText(/TypeError/).closest('div')
    expect(resultContainer?.parentElement?.className).toContain('border-red-500')
  })

  // ── Accessibility ─────────────────────────────────────────────────────────

  it('has region role with descriptive label', () => {
    renderWithTaskEvents(<TaskExecutionView block={makeTaskBlock()} />)
    expect(screen.getByRole('region', { name: /Search codebase/ })).toBeInTheDocument()
  })
})
