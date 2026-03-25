// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { SessionStatusBar } from '../../../src/renderer/components/DetailPanel/SessionPanel/SessionStatusBar'
import { resolveContextDisplayState } from '../../../src/shared/contextDisplay'
import type { ManagedSessionInfo } from '../../../src/shared/types'

function makeSession(overrides: Partial<ManagedSessionInfo> = {}): ManagedSessionInfo {
  return {
    id: 'session-1',
    engineKind: 'claude',
    engineSessionRef: null,

    engineState: null,
    state: 'streaming',
    stopReason: null,
    origin: { source: 'issue', issueId: 'issue-1' },
    projectId: null,
    projectPath: '/tmp/project',
    model: 'claude-sonnet-4-6',
    messages: [],
    createdAt: Date.now() - 60_000,
    lastActivity: Date.now(),
    totalCostUsd: 0.12,
    inputTokens: 0,
    outputTokens: 0,
    lastInputTokens: 0,
    contextLimitOverride: null,
    contextTelemetry: null,
    activeDurationMs: 0,
    activeStartedAt: null,
    activity: null,
    error: null,
    ...overrides
  }
}

/**
 * Convert a ManagedSessionInfo into the flat-primitive props expected
 * by SessionStatusBar after the prop flattening refactor.
 */
function flatProps(session: ManagedSessionInfo) {
  const ctx = resolveContextDisplayState(session)
  return {
    state: session.state,
    error: session.error ?? null,
    stopReason: session.stopReason,
    activeDurationMs: session.activeDurationMs,
    activeStartedAt: session.activeStartedAt,
    contextUsed: ctx.usedTokens,
    contextLimit: ctx.limitTokens,
    isContextEstimate: ctx.estimated,
  }
}

describe('SessionStatusBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const defaultProps = () => ({
    onStop: vi.fn(),
    onRetry: vi.fn(),
    onNewSession: vi.fn(),
    onNewBlankSession: vi.fn(),
  })

  it('does not show Stop button while streaming', () => {
    render(
      <SessionStatusBar
        {...flatProps(makeSession({ state: 'streaming' }))}
        {...defaultProps()}
      />
    )
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /stop session/i })).toBeNull()
  })

  it('renders awaiting_input state with Stop button', () => {
    render(
      <SessionStatusBar
        {...flatProps(makeSession({ state: 'awaiting_input' }))}
        {...defaultProps()}
      />
    )
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /stop session/i })).toBeInTheDocument()
  })

  it('renders creating state with spinner, no action buttons', () => {
    render(
      <SessionStatusBar
        {...flatProps(makeSession({ state: 'creating' }))}
        {...defaultProps()}
      />
    )
    expect(screen.getByText(/starting/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders stopped state with Retry button', () => {
    render(
      <SessionStatusBar
        {...flatProps(makeSession({ state: 'stopped' }))}
        {...defaultProps()}
      />
    )
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('renders error state with error text and Retry button', () => {
    render(
      <SessionStatusBar
        {...flatProps(makeSession({ state: 'error', error: 'API limit' }))}
        {...defaultProps()}
      />
    )
    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.getByText('API limit')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('calls onStop when Stop is clicked', async () => {
    vi.useRealTimers()
    const onStop = vi.fn()
    render(
      <SessionStatusBar
        {...flatProps(makeSession({ state: 'awaiting_input' }))}
        {...defaultProps()}
        onStop={onStop}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /stop session/i }))
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('calls onRetry when Retry is clicked', async () => {
    vi.useRealTimers()
    const onRetry = vi.fn()
    render(
      <SessionStatusBar
        {...flatProps(makeSession({ state: 'error', error: 'fail' }))}
        {...defaultProps()}
        onRetry={onRetry}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('has aria-live="polite" on container', () => {
    const { container } = render(
      <SessionStatusBar
        {...flatProps(makeSession({ state: 'streaming' }))}
        {...defaultProps()}
      />
    )
    expect(container.firstChild).toHaveAttribute('aria-live', 'polite')
  })

  it('shows duration with tabular-nums', () => {
    render(
      <SessionStatusBar
        {...flatProps(makeSession({ state: 'streaming', activeDurationMs: 192_000, activeStartedAt: null }))}
        {...defaultProps()}
      />
    )
    const durationEl = screen.getByText(/\d+m\s\d+s|\d+s/)
    expect(durationEl.className).toContain('tabular-nums')
  })

  it('renders context window ring when lastInputTokens > 0', () => {
    render(
      <SessionStatusBar
        {...flatProps(makeSession({ lastInputTokens: 50_000, model: 'claude-sonnet-4-6' }))}
        {...defaultProps()}
      />
    )
    const meter = screen.getByRole('meter')
    expect(meter).toBeInTheDocument()
    // 50k / 200k = 25% used → 75% remaining
    expect(meter).toHaveAttribute('aria-valuenow', '75')
  })

  it('prefers dynamic contextLimitOverride over static model mapping', () => {
    render(
      <SessionStatusBar
        {...flatProps(makeSession({ lastInputTokens: 50_000, contextLimitOverride: 1_000_000, model: 'claude-sonnet-4-6' }))}
        {...defaultProps()}
      />
    )
    const meter = screen.getByRole('meter')
    expect(meter).toBeInTheDocument()
    // 50k / 1M = 5% used → 95% remaining
    expect(meter).toHaveAttribute('aria-valuenow', '95')
  })

  it('prefers canonical contextState over fallback context fields', () => {
    render(
      <SessionStatusBar
        {...flatProps(makeSession({
          engineKind: 'codex',
          model: 'gpt-5-codex',
          lastInputTokens: 10_000,
          contextLimitOverride: 120_000,
          contextState: {
            usedTokens: 50_000,
            limitTokens: 1_000_000,
            source: 'codex.token_count',
            confidence: 'authoritative',
            updatedAtMs: Date.now(),
          },
          contextTelemetry: {
            usedTokens: 12_000,
            limitTokens: 120_000,
            remainingTokens: 108_000,
            remainingPct: 90,
            source: 'codex.token_count',
            confidence: 'authoritative',
            updatedAtMs: Date.now(),
          },
        }))}
        {...defaultProps()}
      />
    )
    const meter = screen.getByRole('meter')
    expect(meter).toBeInTheDocument()
    expect(meter).toHaveAttribute('aria-valuenow', '95')
    expect(meter).toHaveAttribute('aria-label', expect.not.stringContaining('estimated'))
  })

  it('does not render context window ring when lastInputTokens is 0', () => {
    render(
      <SessionStatusBar
        {...flatProps(makeSession({ lastInputTokens: 0 }))}
        {...defaultProps()}
      />
    )
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('hides retry/new-session controls when capabilities are not provided', () => {
    render(
      <SessionStatusBar
        {...flatProps(makeSession({ state: 'error', error: 'failed in schedule context' }))}
      />
    )
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /new session/i })).toBeNull()
  })
})
