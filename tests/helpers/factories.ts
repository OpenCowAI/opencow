// SPDX-License-Identifier: Apache-2.0

/**
 * Centralized test data factories.
 *
 * Every test file that needs domain objects (ManagedSessionInfo, Issue,
 * IssueSummary) should import from here instead of defining local helpers.
 *
 * Design:
 *   - Each factory returns a **complete, type-safe** object — no reliance on
 *     TypeScript structural subtyping to silently accept missing fields.
 *   - Callers can override any field via the `overrides` parameter.
 *   - Deterministic defaults: timestamps use epoch-relative values so tests
 *     are not sensitive to wall-clock time.
 */

import type {
  ManagedSessionInfo,
  Issue,
  IssueSummary,
} from '../../src/shared/types'

// ─── Deterministic Timestamps ─────────────────────────────────────────
// Use a fixed base to keep test snapshots stable.
const BASE_TS = 1_700_000_000_000 // 2023-11-14 ~22:13 UTC

// ─── ManagedSessionInfo ───────────────────────────────────────────────

/**
 * Create a complete ManagedSessionInfo with sensible defaults.
 *
 * All required fields are explicitly set.  Runtime-only optional fields
 * (`contextLimitOverride`, `contextState`, `contextTelemetry`) are
 * omitted by default — matching production semantics where they are
 * only present when populated by the engine at runtime.
 * Callers can override any field (including optionals) via `overrides`.
 */
export function makeManagedSession(
  overrides: Partial<ManagedSessionInfo> = {},
): ManagedSessionInfo {
  return {
    id: 'session-1',
    engineKind: 'claude',
    engineSessionRef: null,

    engineState: null,
    state: 'idle',
    stopReason: null,
    origin: { source: 'agent' },
    projectPath: null,
    projectId: null,
    model: 'claude-sonnet-4-6',
    messages: [],
    createdAt: BASE_TS,
    lastActivity: BASE_TS,
    activeDurationMs: 0,
    activeStartedAt: null,
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    lastInputTokens: 0,
    activity: null,
    error: null,
    executionContext: null,
    ...overrides,
  }
}

// ─── Issue (Full) ─────────────────────────────────────────────────────

/**
 * Create a complete Issue with all fields (including heavy ones like
 * description, images, richContent).
 *
 * Use this for detail-view tests that need the full object.
 * For list-view tests, prefer `makeIssueSummary`.
 */
export function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    title: 'Test Issue',
    description: '',
    richContent: null,
    status: 'open',
    priority: 'medium',
    labels: [],
    projectId: null,
    sessionId: null,
    sessionHistory: [],
    parentIssueId: null,
    images: [],
    createdAt: BASE_TS,
    updatedAt: BASE_TS,
    readAt: null,
    lastAgentActivityAt: null,
    contextRefs: [],
    // Remote issue tracking
    providerId: null,
    remoteNumber: null,
    remoteUrl: null,
    remoteState: null,
    remoteSyncedAt: null,
    // Phase 2
    assignees: null,
    milestone: null,
    syncStatus: null,
    remoteUpdatedAt: null,
    ...overrides,
  }
}

// ─── IssueSummary ─────────────────────────────────────────────────────

/**
 * Create a lightweight IssueSummary for list-view / selector tests.
 *
 * Omits `description`, `richContent`, `images`, `sessionHistory`,
 * `contextRefs` — matching the real `IssueSummary` type.
 */
export function makeIssueSummary(
  overrides: Partial<IssueSummary> = {},
): IssueSummary {
  return {
    id: 'issue-1',
    title: 'Test Issue',
    status: 'open',
    priority: 'medium',
    labels: [],
    projectId: null,
    sessionId: null,
    parentIssueId: null,
    createdAt: BASE_TS,
    updatedAt: BASE_TS,
    readAt: null,
    lastAgentActivityAt: null,
    // Remote issue tracking
    providerId: null,
    remoteNumber: null,
    remoteUrl: null,
    remoteState: null,
    remoteSyncedAt: null,
    // Phase 2
    assignees: null,
    milestone: null,
    syncStatus: null,
    remoteUpdatedAt: null,
    ...overrides,
  }
}
