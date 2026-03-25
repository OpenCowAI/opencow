// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { SessionPanel } from '../../../src/renderer/components/DetailPanel/SessionPanel/SessionPanel'
import type { SessionPanelCapabilities } from '../../../src/renderer/components/DetailPanel/SessionPanel/SessionPanel'
import { useAppStore } from '../../../src/renderer/stores/appStore'
import { useIssueStore } from '../../../src/renderer/stores/issueStore'
import {
  makeIssue,
  makeManagedSession,
  resetCommandStore,
  setCommandStoreSessions,
} from '../../helpers'

// Mock react-virtuoso — jsdom has no real layout so render a simple list fallback.
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

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof globalThis.ResizeObserver
}

beforeEach(() => {
  ;(window as any).opencow = {
    'list-artifacts': vi.fn().mockResolvedValue([]),
    'list-session-notes': vi.fn().mockResolvedValue([]),
    'list-slash-commands': vi.fn().mockResolvedValue([]),
    'capability:snapshot': vi.fn().mockResolvedValue({ commands: [], skills: [] }),
    'on:opencow:event': vi.fn(() => () => {}),
  }

  useIssueStore.setState({
    issueDetailCache: new Map(),
  })
  resetCommandStore()
})

/** Session with a user message for content-rendering assertions. */
const DEFAULT_SESSION_OVERRIDES = {
  state: 'awaiting_input' as const,
  origin: { source: 'issue' as const, issueId: 'issue-1' },
  projectPath: '/tmp/project',
  totalCostUsd: 0.12,
  messages: [
    {
      id: 'msg-1',
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'Fix the bug' }],
      timestamp: 1_700_000_000_000,
    },
  ],
}

function makeCapabilities(overrides: Partial<SessionPanelCapabilities> = {}): SessionPanelCapabilities {
  return {
    create: vi.fn(),
    retry: vi.fn(),
    stop: vi.fn(),
    newSession: vi.fn(),
    newBlankSession: vi.fn(),
    send: vi.fn().mockResolvedValue(true),
    resume: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

describe('SessionPanel', () => {
  it('shows empty state with Start button when no bound session', () => {
    render(
      <SessionPanel
        binding={{ kind: 'session', sessionId: 'session-1' }}
        lifecycle="active"
        isStarting={false}
        capabilities={makeCapabilities()}
      />
    )
    expect(screen.getByText(/no session/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^start session$/i })).toBeInTheDocument()
  })

  it('shows starting state when isStarting and no session', () => {
    render(
      <SessionPanel
        binding={{ kind: 'session', sessionId: 'session-1' }}
        lifecycle="active"
        isStarting={true}
        capabilities={makeCapabilities()}
      />
    )
    expect(screen.getByText(/starting/i)).toBeInTheDocument()
  })

  it('renders session content when bound session exists', () => {
    const session = makeManagedSession(DEFAULT_SESSION_OVERRIDES)
    setCommandStoreSessions([session])
    render(
      <SessionPanel
        binding={{ kind: 'session', sessionId: 'session-1' }}
        lifecycle="active"
        isStarting={false}
        capabilities={makeCapabilities()}
      />
    )
    expect(screen.getAllByText('Fix the bug').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('renders compose action in empty state when compose capability exists', () => {
    render(
      <SessionPanel
        binding={{ kind: 'session', sessionId: 'session-1' }}
        lifecycle="active"
        isStarting={false}
        capabilities={makeCapabilities({ compose: vi.fn() })}
      />
    )
    expect(screen.getByRole('button', { name: /compose and start/i })).toBeInTheDocument()
  })

  it('hides start/compose buttons in readonly mode', () => {
    render(
      <SessionPanel
        binding={{ kind: 'session', sessionId: 'session-1' }}
        lifecycle="readonly"
        isStarting={false}
        capabilities={makeCapabilities()}
      />
    )
    expect(screen.queryByRole('button', { name: /start session/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /compose and start/i })).toBeNull()
  })

  it('resolves issue binding from issueDetailCache', () => {
    const issue = makeIssue({ title: 'Test issue', description: 'Fix the bug', sessionId: 'session-1' })
    const session = makeManagedSession(DEFAULT_SESSION_OVERRIDES)
    useIssueStore.setState({
      issueDetailCache: new Map([[issue.id, issue]]),
    })
    setCommandStoreSessions([session])

    render(
      <SessionPanel
        binding={{ kind: 'issue', issueId: issue.id }}
        lifecycle="active"
        isStarting={false}
        capabilities={makeCapabilities()}
      />
    )

    expect(screen.getAllByText('Fix the bug').length).toBeGreaterThanOrEqual(1)
  })

  it('calls create capability when Start Session is clicked', async () => {
    const create = vi.fn()
    render(
      <SessionPanel
        binding={{ kind: 'session', sessionId: 'session-1' }}
        lifecycle="active"
        isStarting={false}
        capabilities={makeCapabilities({ create })}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /^start session$/i }))
    expect(create).toHaveBeenCalledOnce()
  })
})
