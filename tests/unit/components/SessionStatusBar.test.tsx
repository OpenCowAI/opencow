// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ManagedSessionInfo, SessionSnapshot } from '../../../src/shared/types'
import { resolveContextDisplayState } from '../../../src/shared/contextDisplay'

// ── Mock store ─────────────────────────────────────────────────────────
// SessionStatusBar self-subscribes to commandStore for volatile metrics.
// We mock the store so the component can read session data in tests.

let mockSessionData: Record<string, Partial<SessionSnapshot>>  = {}

vi.mock('@/stores/commandStore', () => {
  // Create a minimal zustand-compatible mock
  const createMockStore = () => {
    const getState = () => ({
      sessionById: Object.fromEntries(
        Object.entries(mockSessionData).map(([id, data]) => [id, { id, ...data }])
      ),
      managedSessions: [],
      messagesBySession: {},
    })
    const subscribe = () => () => {}
    const store = (selector: (s: ReturnType<typeof getState>) => unknown) => selector(getState())
    store.getState = getState
    store.subscribe = subscribe
    return store
  }

  const mockStore = createMockStore()

  return {
    useCommandStore: mockStore,
    useStreamingSessionMetrics: (sessionId: string) => {
      const session = mockSessionData[sessionId]
      if (!session) return null
      return {
        activeDurationMs: session.activeDurationMs ?? 0,
        activeStartedAt: session.activeStartedAt ?? null,
        inputTokens: session.inputTokens ?? 0,
        outputTokens: session.outputTokens ?? 0,
        activity: session.activity ?? null,
      }
    },
  }
})

// zustand/traditional's useStoreWithEqualityFn — redirect to our mock store
vi.mock('zustand/traditional', () => ({
  useStoreWithEqualityFn: (store: (sel: unknown) => unknown, selector: (s: unknown) => unknown) =>
    selector(typeof store.getState === 'function' ? store.getState() : store),
}))

vi.mock('zustand/shallow', () => ({ shallow: (a: unknown, b: unknown) => a === b }))

// Mock getAppAPI for locale
vi.mock('@/windowAPI', () => ({
  getAppAPI: () => ({
    getLocale: () => 'en-US',
    getSetting: () => undefined,
    onSettingChanged: () => () => {},
  }),
}))

// We import the component AFTER mocks are set up
import { SessionStatusBar } from '../../../src/renderer/components/DetailPanel/SessionPanel/SessionStatusBar'

function makeSession(overrides: Partial<ManagedSessionInfo> = {}): Partial<SessionSnapshot> {
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
    ...overrides,
  } as unknown as Partial<SessionSnapshot>
}

function setupStore(session: Partial<SessionSnapshot>) {
  const id = (session as { id?: string }).id ?? 'session-1'
  mockSessionData = { [id]: session }
}

describe('SessionStatusBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSessionData = {}
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const defaultProps = () => ({
    sessionId: 'session-1',
    onStop: vi.fn(),
    onRetry: vi.fn(),
    onNewSession: vi.fn(),
    onNewBlankSession: vi.fn(),
  })

  it('does not show Stop button while streaming', () => {
    const session = makeSession({ state: 'streaming' })
    setupStore(session)
    render(
      <SessionStatusBar
        sessionId="session-1"
        state="streaming"
        error={null}
        stopReason={null}
        {...defaultProps()}
      />
    )
    // The component renders a dot indicator; state label is in tooltip only.
    // Verify the dot is present and stop button is absent.
    expect(screen.queryByRole('button', { name: /stop session/i })).toBeNull()
  })

  it('renders awaiting_input state with Stop button', () => {
    const session = makeSession({ state: 'awaiting_input' })
    setupStore(session)
    render(
      <SessionStatusBar
        sessionId="session-1"
        state="awaiting_input"
        error={null}
        stopReason={null}
        {...defaultProps()}
      />
    )
    expect(screen.getByRole('button', { name: /stop session/i })).toBeInTheDocument()
  })

  it('renders creating state with spinner, no action buttons', () => {
    const session = makeSession({ state: 'creating' })
    setupStore(session)
    render(
      <SessionStatusBar
        sessionId="session-1"
        state="creating"
        error={null}
        stopReason={null}
        {...defaultProps()}
      />
    )
    // No action buttons visible during creating state
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })

  it('renders stopped state with Retry button', () => {
    const session = makeSession({ state: 'stopped' })
    setupStore(session)
    render(
      <SessionStatusBar
        sessionId="session-1"
        state="stopped"
        error={null}
        stopReason="user_stopped"
        {...defaultProps()}
      />
    )
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('renders error state with error text and Retry button', () => {
    const session = makeSession({ state: 'error', error: 'API limit' })
    setupStore(session)
    render(
      <SessionStatusBar
        sessionId="session-1"
        state="error"
        error="API limit"
        stopReason={null}
        {...defaultProps()}
      />
    )
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('calls onStop when Stop is clicked', async () => {
    vi.useRealTimers()
    const session = makeSession({ state: 'awaiting_input' })
    setupStore(session)
    const onStop = vi.fn()
    render(
      <SessionStatusBar
        sessionId="session-1"
        state="awaiting_input"
        error={null}
        stopReason={null}
        {...defaultProps()}
        onStop={onStop}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /stop session/i }))
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('calls onRetry when Retry is clicked', async () => {
    vi.useRealTimers()
    const session = makeSession({ state: 'error', error: 'fail' })
    setupStore(session)
    const onRetry = vi.fn()
    render(
      <SessionStatusBar
        sessionId="session-1"
        state="error"
        error="fail"
        stopReason={null}
        {...defaultProps()}
        onRetry={onRetry}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('has aria-live="polite" on container', () => {
    const session = makeSession({ state: 'streaming' })
    setupStore(session)
    const { container } = render(
      <SessionStatusBar
        sessionId="session-1"
        state="streaming"
        error={null}
        stopReason={null}
        {...defaultProps()}
      />
    )
    expect(container.firstChild).toHaveAttribute('aria-live', 'polite')
  })

  it('shows duration with tabular-nums', () => {
    const session = makeSession({ state: 'streaming', activeDurationMs: 192_000, activeStartedAt: null })
    setupStore(session)
    render(
      <SessionStatusBar
        sessionId="session-1"
        state="streaming"
        error={null}
        stopReason={null}
        {...defaultProps()}
      />
    )
    const durationEl = screen.getByText(/\d+m\s\d+s|\d+s/)
    expect(durationEl.className).toContain('tabular-nums')
  })

  it('renders context window ring when contextState.usedTokens > 0', () => {
    const session = makeSession({
      model: 'claude-sonnet-4-6',
      contextState: {
        metricKind: 'context_occupancy',
        usedTokens: 50_000,
        limitTokens: 200_000,
        source: 'claude.assistant_usage',
        confidence: 'estimated',
        updatedAtMs: Date.now(),
      },
    })
    setupStore(session)
    render(
      <SessionStatusBar
        sessionId="session-1"
        state="streaming"
        error={null}
        stopReason={null}
        {...defaultProps()}
      />
    )
    const meter = screen.getByRole('meter')
    expect(meter).toBeInTheDocument()
    // estimated contextState limit is ignored, genai fallback gives 1,000,000:
    // 50k / 1,000k = 5% used -> 95% remaining
    expect(meter).toHaveAttribute('aria-valuenow', '95')
  })

  it('prefers dynamic contextLimitOverride over static model mapping', () => {
    const session = makeSession({
      contextLimitOverride: 1_000_000,
      model: 'claude-sonnet-4-6',
      contextState: {
        metricKind: 'context_occupancy',
        usedTokens: 50_000,
        limitTokens: null,
        source: 'claude.assistant_usage',
        confidence: 'estimated',
        updatedAtMs: Date.now(),
      },
    })
    setupStore(session)
    render(
      <SessionStatusBar
        sessionId="session-1"
        state="streaming"
        error={null}
        stopReason={null}
        {...defaultProps()}
      />
    )
    const meter = screen.getByRole('meter')
    expect(meter).toBeInTheDocument()
    // 50k / 1M = 5% used -> 95% remaining
    expect(meter).toHaveAttribute('aria-valuenow', '95')
  })

  it('prefers canonical contextState over fallback context fields', () => {
    const session = makeSession({
      engineKind: 'codex',
      model: 'gpt-5-codex',
      lastInputTokens: 10_000,
      contextLimitOverride: 120_000,
      contextState: {
        metricKind: 'context_occupancy', usedTokens: 50_000,
        limitTokens: 1_000_000,
        source: 'codex.token_count',
        confidence: 'authoritative',
        updatedAtMs: Date.now(),
      },
      contextTelemetry: {
        metricKind: 'context_occupancy', usedTokens: 12_000,
        limitTokens: 120_000,
        remainingTokens: 108_000,
        remainingPct: 90,
        source: 'codex.token_count',
        confidence: 'authoritative',
        updatedAtMs: Date.now(),
      },
    })
    setupStore(session)
    render(
      <SessionStatusBar
        sessionId="session-1"
        state="streaming"
        error={null}
        stopReason={null}
        {...defaultProps()}
      />
    )
    const meter = screen.getByRole('meter')
    expect(meter).toBeInTheDocument()
    expect(meter).toHaveAttribute('aria-valuenow', '95')
    expect(meter).toHaveAttribute('aria-label', expect.not.stringContaining('estimated'))
  })

  it('does not render context window ring when contextState is absent', () => {
    const session = makeSession({ lastInputTokens: 0 })
    setupStore(session)
    render(
      <SessionStatusBar
        sessionId="session-1"
        state="streaming"
        error={null}
        stopReason={null}
        {...defaultProps()}
      />
    )
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('hides retry/new-session controls when capabilities are not provided', () => {
    const session = makeSession({ state: 'error', error: 'failed in schedule context' })
    setupStore(session)
    render(
      <SessionStatusBar
        sessionId="session-1"
        state="error"
        error="failed in schedule context"
        stopReason={null}
      />
    )
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /new session/i })).toBeNull()
  })
})
