// SPDX-License-Identifier: Apache-2.0

import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useIssueStore } from '../stores/issueStore'
import { useCommandStore, type CommandStore } from '../stores/commandStore'
import type { SessionSnapshot } from '@shared/types'

/**
 * Non-hook helper: finds the ManagedSession linked to an Issue via issue.sessionId.
 * Safe to call outside React (event handlers, callbacks, etc.).
 * Reads current snapshots from both appStore (issueById) and commandStore (managedSessions).
 */
export function selectSessionForIssue(issueId: string): SessionSnapshot | null {
  const issue = useIssueStore.getState().issueById[issueId]
  if (!issue?.sessionId) return null
  return useCommandStore.getState().sessionById[issue.sessionId] ?? null
}

// ─── Session History ─────────────────────────────────────────────────

/** Stable empty array to avoid creating new references on every selector call. */
const EMPTY_SESSION_HISTORY: SessionSnapshot[] = []

/**
 * Shallow array equality: returns true when both arrays have the same length
 * and every element at each index is referentially identical.
 *
 * This prevents Zustand from triggering re-renders when the selector returns
 * a new array reference but the contents (same SessionSnapshot objects
 * from the store) haven't changed.
 */
function shallowArrayEqual(a: SessionSnapshot[], b: SessionSnapshot[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Pure selector: resolves all archived session IDs in `issue.sessionHistory`
 * against the `managedSessions` in commandStore.
 *
 * Uses `issueDetailCache` from appStore (snapshot) because `IssueSummary` omits
 * `sessionHistory` — the full field is only available in the detail cache.
 *
 * Returns entries in chronological order (oldest first, newest last).
 * Sessions no longer in memory (purged) are silently omitted.
 *
 * **Reactivity boundary:** reads `issueDetailCache` as a snapshot,
 * subscribes to `commandStore` only.  Session history changes are
 * always accompanied by a `commandStore` mutation (archive/restore),
 * so the snapshot approach is safe here (unlike `useSessionByBinding`
 * where create needed a reactive subscription — see its JSDoc).
 */
function selectSessionHistoryForIssue(
  cs: CommandStore,
  issueId: string
): SessionSnapshot[] {
  const issue = useIssueStore.getState().issueDetailCache.get(issueId)
  if (!issue?.sessionHistory?.length) return EMPTY_SESSION_HISTORY

  return issue.sessionHistory
    .map((id) => cs.sessionById[id])
    .filter((ms): ms is SessionSnapshot => ms != null)
}

/**
 * React hook: subscribes to the commandStore and returns archived sessions
 * for the given Issue.
 *
 * **Important — Zustand v5 compatibility:**
 * The store is created with `create()` (not `createWithEqualityFn` from
 * `zustand/traditional`), so the bound hook `useCommandStore(selector)` uses
 * `useSyncExternalStore` with `Object.is` — any second argument (equality
 * function) is **silently ignored**.
 *
 * Since `selectSessionHistoryForIssue` produces a new array via `.map().filter()`
 * on every invocation, `Object.is` would always return `false`, causing the
 * consuming component to re-render on every store mutation → infinite cascade.
 *
 * Fix: use `useStoreWithEqualityFn` from `zustand/traditional`, which wraps
 * `useSyncExternalStoreWithSelector` and correctly forwards the equality
 * function.  `shallowArrayEqual` compares the array contents element-by-element
 * (stable SessionSnapshot refs from the store), preventing spurious re-renders.
 */
export function useSessionHistoryForIssue(issueId: string): SessionSnapshot[] {
  return useStoreWithEqualityFn(
    useCommandStore,
    (cs) => selectSessionHistoryForIssue(cs, issueId),
    shallowArrayEqual,
  )
}

// ─── Session Binding ─────────────────────────────────────────────────

/**
 * Declarative source of truth for selecting the session shown in SessionPanel.
 *
 * - `issue`: display the current issue session by default, or a specific
 *   archived session when `archivedSessionId` is provided.
 * - `session`: display one explicit session directly (schedule preview, chat,
 *   etc.), decoupled from issue lifecycles.
 */
export type SessionBinding =
  | {
      kind: 'issue'
      issueId: string
      archivedSessionId?: string | null
    }
  | {
      kind: 'session'
      sessionId: string
    }

/**
 * Combined selector for all session-bearing contexts.
 *
 * Designed to be called **inside SessionPanel** so parent detail containers do
 * not subscribe to `managedSessions`, preventing parent re-render cascades
 * during streaming.
 *
 * **Reactivity boundary (two subscriptions):**
 *
 * 1. `issueStore` → narrow selector returning ONLY `issue.sessionId` (a stable
 *    string that changes only on session create / archive / restore).
 * 2. `commandStore` → selector returning the `SessionSnapshot` for that
 *    sessionId (changes on every streaming tick — high frequency).
 *
 * Why two subscriptions:
 * During session creation, `commandStore` and `issueStore` update
 * NON-atomically — `commandStore` receives the `command:session:created`
 * DataBus event BEFORE `issueStore` is updated by the `updateIssue` IPC
 * in `commandActions.startSession`.  The previous snapshot-read approach
 * (`useIssueStore.getState()` inside a `commandStore` selector) would
 * evaluate with a stale `issue.sessionId = null`, leaving the session
 * invisible to SessionPanel until the NEXT `commandStore` mutation
 * (potentially seconds later, or never if the SDK fails to initialise).
 *
 * By subscribing to `issue.sessionId` reactively, the hook re-triggers
 * the `commandStore` selector the moment the session is linked to the
 * issue — eliminating the race condition entirely.
 *
 * Performance:
 * The `issueStore` selector returns a primitive string (`sessionId`).
 * Zustand's default `Object.is` equality check ensures a re-render only
 * when `sessionId` actually changes — NOT on every `issueDetailCache`
 * mutation (e.g. `lastAgentActivityAt` updates during streaming).  This
 * preserves the render isolation between SessionPanel and IssueDetailView.
 */
/**
 * Structural equality for SessionSnapshot that ignores per-frame volatile fields.
 *
 * During streaming, `batchUpsertManagedSessions` creates a new SessionSnapshot
 * object on every IPC tick (~60/sec) because `outputTokens`, `inputTokens`,
 * `activeDurationMs`, `activeStartedAt`, and `activity` change.  These fields
 * are NOT needed by SessionPanel's own rendering logic — they're only consumed
 * by self-subscribing children (StreamingOverlayContent, SessionStatusBar).
 *
 * By comparing only the STABLE fields, SessionPanel skips re-rendering on
 * streaming ticks entirely — eliminating ~7-12ms/frame of synchronous React
 * work that was blocking the main thread and causing input lag.
 *
 * Children that need per-frame data subscribe via `useStreamingSessionMetrics`.
 */
function sessionStableEqual(a: SessionSnapshot | null, b: SessionSnapshot | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.id === b.id &&
    a.state === b.state &&
    a.engineKind === b.engineKind &&
    a.error === b.error &&
    a.stopReason === b.stopReason &&
    a.model === b.model &&
    a.projectId === b.projectId &&
    a.projectPath === b.projectPath
  )
}

export function useSessionByBinding(binding: SessionBinding): SessionSnapshot | null {
  // Reactively subscribe to the issue's current sessionId.
  // Returns null for non-issue bindings or archived views (constant, no re-renders).
  const issueSessionId = useIssueStore((s) => {
    if (binding.kind !== 'issue' || binding.archivedSessionId) return null
    return s.issueDetailCache.get(binding.issueId)?.sessionId ?? null
  })

  return useStoreWithEqualityFn(
    useCommandStore,
    (cs) => {
      if (binding.kind === 'session') {
        return cs.sessionById[binding.sessionId] ?? null
      }

      if (binding.archivedSessionId) {
        return cs.sessionById[binding.archivedSessionId!] ?? null
      }

      // Uses reactively-subscribed issueSessionId (not a snapshot read).
      if (!issueSessionId) return null
      return cs.sessionById[issueSessionId] ?? null
    },
    sessionStableEqual,
  )
}
