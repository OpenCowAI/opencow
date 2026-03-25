// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { SessionStatusCard } from '../../../src/renderer/components/DetailPanel/SessionStatusCard'
import type { ManagedSessionInfo } from '../../../src/shared/types'

function makeSession(overrides: Partial<ManagedSessionInfo> = {}): ManagedSessionInfo {
  return {
    id: 'session-1',

    state: 'streaming',
    issueId: 'issue-1',
    projectPath: '/tmp/project',
    model: 'claude-sonnet-4-6',
    messages: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
    totalCostUsd: 0.12,
    inputTokens: 0,
    outputTokens: 0,
    lastInputTokens: 0,
    activity: null,
    error: null,
    stopReason: null,
    ...overrides
  }
}

const defaultProps = {
  session: null as ManagedSessionInfo | null,
  isStarting: false,
  onStart: vi.fn(),
  onRetry: vi.fn(),
  onStop: vi.fn()
}

describe('SessionStatusCard', () => {
  it('renders Start Session button when no session', () => {
    render(<SessionStatusCard {...defaultProps} />)
    expect(screen.getByRole('button', { name: /start session/i })).toBeEnabled()
  })

  it('renders disabled Starting button when isStarting', () => {
    render(<SessionStatusCard {...defaultProps} isStarting={true} />)
    const btn = screen.getByRole('button', { name: /starting/i })
    expect(btn).toBeDisabled()
  })

  it('renders creating state as card', () => {
    render(
      <SessionStatusCard
        {...defaultProps}
        session={makeSession({ state: 'creating' })}
      />
    )
    expect(screen.getByText(/starting/i)).toBeInTheDocument()
  })

  it('renders streaming state with Stop button', () => {
    render(
      <SessionStatusCard
        {...defaultProps}
        session={makeSession({ state: 'streaming' })}
      />
    )
    expect(screen.getByText(/running/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
  })

  it('renders awaiting_input state with Stop button', () => {
    render(
      <SessionStatusCard
        {...defaultProps}
        session={makeSession({ state: 'awaiting_input' })}
      />
    )
    expect(screen.getByText(/ready/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
  })

  it('renders error state with error message and Retry button', () => {
    render(
      <SessionStatusCard
        {...defaultProps}
        session={makeSession({ state: 'error', error: 'API rate limit' })}
      />
    )
    expect(screen.getByText(/error/i)).toBeInTheDocument()
    expect(screen.getByText(/API rate limit/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('renders stopped state with New Session button', () => {
    render(
      <SessionStatusCard
        {...defaultProps}
        session={makeSession({ state: 'stopped', totalCostUsd: 0.45 })}
      />
    )
    expect(screen.getByText(/stopped/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument()
  })

  it('calls onStart when Start Session is clicked', async () => {
    const onStart = vi.fn()
    render(<SessionStatusCard {...defaultProps} onStart={onStart} />)
    await userEvent.click(screen.getByRole('button', { name: /start session/i }))
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('calls onStop when Stop is clicked', async () => {
    const onStop = vi.fn()
    render(
      <SessionStatusCard
        {...defaultProps}
        session={makeSession({ state: 'streaming' })}
        onStop={onStop}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('calls onRetry when Retry is clicked', async () => {
    const onRetry = vi.fn()
    render(
      <SessionStatusCard
        {...defaultProps}
        session={makeSession({ state: 'error', error: 'fail' })}
        onRetry={onRetry}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
