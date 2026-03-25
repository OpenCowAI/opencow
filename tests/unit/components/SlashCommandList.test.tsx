// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { SlashCommandList } from '../../../src/renderer/components/DetailPanel/SessionPanel/SlashCommandList'
import type { SlashItemGroup } from '../../../src/shared/slashItems'

const mockGroups: SlashItemGroup[] = [
  {
    category: 'builtin',
    label: 'Built-in',
    items: [
      { id: 'builtin:clear', name: 'clear', description: 'Clear history', category: 'builtin', order: 1 },
      {
        id: 'builtin:compact',
        name: 'compact',
        description: 'Compress context',
        category: 'builtin',
        order: 2,
        argumentHint: '[instructions]',
      },
    ],
  },
  {
    category: 'command',
    label: 'Commands',
    items: [
      { id: 'command:project:commit', name: 'commit', description: 'Smart commit', category: 'command', order: 1, scope: 'project' },
      { id: 'command:global:deploy', name: 'deploy', description: 'Deploy app', category: 'command', order: 2, scope: 'global' },
    ],
  },
  {
    category: 'skill',
    label: 'Skills',
    items: [
      { id: 'skill:global:review', name: 'review', description: 'Code review', category: 'skill', order: 1, scope: 'global' },
    ],
  },
  {
    category: 'apps',
    label: 'Apps',
    items: [
      {
        id: 'skill:global:evose_x',
        name: 'evose:x_analyst_abc123',
        description: 'X trend analyzer',
        category: 'skill',
        order: 2,
        presentation: {
          variant: 'app',
          title: 'X Analyst',
          subtitle: 'Analyze X/Twitter signals',
          avatarUrl: 'https://example.com/avatar.png',
        },
      },
    ],
  },
]

describe('SlashCommandList', () => {
  it('renders group labels', () => {
    render(<SlashCommandList groups={mockGroups} activeIndex={0} onSelect={vi.fn()} />)
    expect(screen.getByText('Built-in')).toBeInTheDocument()
    expect(screen.getByText('Commands')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
    expect(screen.getByText('Apps')).toBeInTheDocument()
  })

  it('renders item names with / prefix', () => {
    render(<SlashCommandList groups={mockGroups} activeIndex={0} onSelect={vi.fn()} />)
    expect(screen.getByText('/clear')).toBeInTheDocument()
    expect(screen.getByText('/compact')).toBeInTheDocument()
    expect(screen.getByText('/commit')).toBeInTheDocument()
  })

  it('renders app rows with title + subtitle', () => {
    render(<SlashCommandList groups={mockGroups} activeIndex={0} onSelect={vi.fn()} />)
    expect(screen.getByText('X Analyst')).toBeInTheDocument()
    expect(screen.getByText('Analyze X/Twitter signals')).toBeInTheDocument()
    expect(screen.queryByText('/evose:x_analyst_abc123')).not.toBeInTheDocument()
  })

  it('renders item descriptions', () => {
    render(<SlashCommandList groups={mockGroups} activeIndex={0} onSelect={vi.fn()} />)
    expect(screen.getByText('Clear history')).toBeInTheDocument()
  })

  it('renders argument hints when present', () => {
    render(<SlashCommandList groups={mockGroups} activeIndex={0} onSelect={vi.fn()} />)
    expect(screen.getByText('[instructions]')).toBeInTheDocument()
  })

  it('highlights the active item', () => {
    render(<SlashCommandList groups={mockGroups} activeIndex={1} onSelect={vi.fn()} />)
    const options = screen.getAllByRole('option')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('calls onSelect when item is clicked', async () => {
    const onSelect = vi.fn()
    render(<SlashCommandList groups={mockGroups} activeIndex={0} onSelect={onSelect} />)
    await userEvent.click(screen.getByText('/commit'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'command:project:commit', name: 'commit' }))
  })

  it('has listbox role with aria-label', () => {
    render(<SlashCommandList groups={mockGroups} activeIndex={0} onSelect={vi.fn()} />)
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-label', 'Slash commands')
  })

  it('shows empty state when no groups', () => {
    render(<SlashCommandList groups={[]} activeIndex={0} onSelect={vi.fn()} />)
    expect(screen.getByText('No commands found')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    render(<SlashCommandList groups={[]} activeIndex={0} onSelect={vi.fn()} loading />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  // --- Scope badge tests ---

  it('does not render scope badge for builtin items', () => {
    render(<SlashCommandList groups={mockGroups} activeIndex={0} onSelect={vi.fn()} />)
    // Builtin items have no scope, so no "project" or "global" badge should appear
    // within their option elements
    const builtinOptions = screen.getAllByRole('option').slice(0, 2)
    for (const opt of builtinOptions) {
      expect(opt.querySelector('[aria-label*="scope"]')).toBeNull()
    }
  })

  it('renders "project" scope badge for project-scoped items', () => {
    render(<SlashCommandList groups={mockGroups} activeIndex={0} onSelect={vi.fn()} />)
    const badge = screen.getByLabelText('project scope')
    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toBe('project')
  })

  it('renders "global" scope badge for global-scoped items', () => {
    render(<SlashCommandList groups={mockGroups} activeIndex={0} onSelect={vi.fn()} />)
    const badges = screen.getAllByLabelText('global scope')
    expect(badges.length).toBe(2) // deploy (command) + review (skill)
    expect(badges[0].textContent).toBe('global')
  })

  it('does not render scope badge for app rows', () => {
    render(<SlashCommandList groups={mockGroups} activeIndex={0} onSelect={vi.fn()} />)
    const appRow = screen.getByText('X Analyst').closest('[role="option"]')
    expect(appRow).not.toBeNull()
    expect(appRow!.querySelector('[aria-label*="scope"]')).toBeNull()
  })
})
