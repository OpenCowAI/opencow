// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { useAppStore } from '../../../src/renderer/stores/appStore'
import { useIssueStore } from '../../../src/renderer/stores/issueStore'
import { IssueDetailView } from '../../../src/renderer/components/DetailPanel/IssueDetailView'
import {
  makeIssue,
  makeManagedSession,
  resetCommandStore,
  resetIssueStore,
  setCommandStoreSessions,
  setAppStoreIssueDetailCache,
} from '../../helpers'

// Mock react-resizable-panels (v4.x exports: Group, Panel, Separator)
vi.mock('react-resizable-panels', () => ({
  Group: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <div data-testid="panel-group" {...props}>{children}</div>
  ),
  Panel: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Separator: ({ children }: React.PropsWithChildren) => (
    <div data-testid="resize-handle">{children}</div>
  ),
}))

// Mock react-virtuoso — jsdom has no layout dimensions so Virtuoso renders nothing.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent, components }: any) => {
    const ListComp = components?.List
    const list = data?.map((item: any, index: number) => (
      <div key={index}>{itemContent(index, item)}</div>
    ))
    return ListComp
      ? <ListComp role="list" aria-label="Session messages">{list}</ListComp>
      : <div role="list" aria-label="Session messages">{list}</div>
  },
}))

// Polyfill ResizeObserver for jsdom
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof globalThis.ResizeObserver
}

const DEFAULT_ISSUE = () => makeIssue({ description: 'Fix the bug', status: 'in_progress' })

// Mock window.opencow — must cover all getAppAPI() calls triggered during render.
beforeEach(() => {
  const issue = DEFAULT_ISSUE()
  ;(window as any).opencow = {
    'command:start-session': vi.fn().mockResolvedValue('session-1'),
    'command:send-message': vi.fn().mockResolvedValue(true),
    'command:stop-session': vi.fn().mockResolvedValue(true),
    'list-child-issues': vi.fn().mockResolvedValue([]),
    'get-issue': vi.fn().mockResolvedValue(issue),
    'get-context-candidates': vi.fn().mockResolvedValue({ artifacts: [] }),
    'mark-issue-read': vi.fn().mockResolvedValue(issue),
    'list-artifacts': vi.fn().mockResolvedValue([]),
    'list-session-notes': vi.fn().mockResolvedValue([]),
    'list-slash-commands': vi.fn().mockResolvedValue([]),
    'capability:snapshot': vi.fn().mockResolvedValue({ commands: [], skills: [] }),
    'on:opencow:event': vi.fn(() => () => {}),
  }
})

describe('IssueDetailView — SessionPanel integration', () => {
  beforeEach(() => {
    const issue = DEFAULT_ISSUE()
    resetIssueStore()
    useAppStore.setState({
      selectedIssueId: issue.id,
      projects: [],
    })
    useIssueStore.setState({
      childIssuesCache: {},
    })
    setAppStoreIssueDetailCache([issue])
    resetCommandStore()
  })

  it('renders PanelGroup with resize handle', () => {
    render(<IssueDetailView issueId="issue-1" />)
    expect(screen.getByTestId('panel-group')).toBeInTheDocument()
    expect(screen.getByTestId('resize-handle')).toBeInTheDocument()
  })

  it('renders SessionPanel empty state when no session linked', () => {
    render(<IssueDetailView issueId="issue-1" />)
    expect(screen.getByText(/no session/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Session' })).toBeInTheDocument()
  })

  it('renders SessionPanel with session data when session linked', () => {
    const issueWithSession = makeIssue({ description: 'Fix the bug', status: 'in_progress', sessionId: 'session-1' })
    const session = makeManagedSession({
      origin: { source: 'issue', issueId: 'issue-1' },
      state: 'awaiting_input',
      messages: [
        { id: 'msg-1', role: 'user', content: [{ type: 'text', text: 'Working on the fix now' }], timestamp: 1_700_000_000_000 },
      ],
    })
    useAppStore.setState({
      selectedIssueId: issueWithSession.id,
    })
    setAppStoreIssueDetailCache([issueWithSession])
    setCommandStoreSessions([session])
    render(<IssueDetailView issueId="issue-1" />)
    expect(screen.getAllByText('Working on the fix now').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('textbox')).toBeEnabled()
  })

  it('does not render SessionStatusCard (removed)', () => {
    const issueWithSession = makeIssue({ description: 'Fix the bug', status: 'in_progress', sessionId: 'session-1' })
    const session = makeManagedSession({
      origin: { source: 'issue', issueId: 'issue-1' },
    })
    useAppStore.setState({
      selectedIssueId: issueWithSession.id,
    })
    setAppStoreIssueDetailCache([issueWithSession])
    setCommandStoreSessions([session])
    render(<IssueDetailView issueId="issue-1" />)
    expect(screen.queryByText(/cost:/i)).toBeNull()
  })

  it('renders Compose & Start button in empty state', () => {
    render(<IssueDetailView issueId="issue-1" />)
    expect(screen.getByRole('button', { name: /compose and start/i })).toBeInTheDocument()
  })

  it('enters compose mode when Compose & Start is clicked', async () => {
    render(<IssueDetailView issueId="issue-1" />)
    await userEvent.click(screen.getByRole('button', { name: /compose and start/i }))
    expect(screen.getByText('Compose Session Prompt')).toBeInTheDocument()
    const editor = await screen.findByRole('textbox')
    expect(editor.textContent).toContain('Test Issue')
  })

  it('exits compose mode when Cancel is clicked', async () => {
    render(<IssueDetailView issueId="issue-1" />)
    await userEvent.click(screen.getByRole('button', { name: /compose and start/i }))
    expect(screen.getByText('Compose Session Prompt')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Cancel'))
    expect(screen.getByText(/no session/i)).toBeInTheDocument()
  })
})
