// SPDX-License-Identifier: Apache-2.0

/**
 * commandStore — Managed agent session lifecycle and real-time messages.
 *
 * Manages the full lifecycle of SDK-backed agent sessions: creation,
 * message streaming, state tracking, and cleanup.  The store separates
 * high-frequency `sessionMessages` from `managedSessions` metadata so
 * that streaming updates (~20/sec) never trigger re-renders in
 * components that only need session state (IssueGroupedList, Sidebar).
 *
 * Session metadata is stored in **normalized** form: `sessionById`
 * (Record<string, SessionSnapshot>) provides O(1) lookup for selectors
 * and event handlers, while `managedSessions` (SessionSnapshot[])
 * preserves insertion order for list rendering.  Both are updated
 * atomically in every mutation — `sessionById` is the source of truth
 * and `managedSessions` is derived from it during each `set()`.
 *
 * Completely independent of all other stores — no cross-store reads
 * or writes.  Cross-store coordination (e.g. startSession linking an
 * issue, deleteSession clearing chat state) is handled by
 * `actions/commandActions.ts`.
 *
 * Populated by:
 *   - bootstrapCoordinator (setManagedSessions)
 *   - DataBus command:session:* events in useAppBootstrap
 *   - User interactions (start / stop / send / resume / delete)
 */

import { create } from 'zustand'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type {
  SessionSnapshot,
  ManagedSessionMessage,
  ManagedSessionState,
  StartSessionInput,
  UserMessageContent,
} from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ─── Types ────────────────────────────────────────────────────────────

/**
 * Flattened session context for a single issue row.
 *
 * All fields are PRIMITIVES (string, number, null) so that Zustand's `shallow`
 * equality works correctly.  A nested object (like `ActiveDuration`) would
 * defeat shallow comparison because `shallow` uses `Object.is()` on property
 * values — a new object with identical fields is still !== the old one.
 */
export interface IssueSessionContext {
  state: SessionSnapshot['state']
  /** Cumulative active time already settled (ms). */
  activeDurationMs: number
  /** Epoch ms when the current active segment started; `null` when not active. */
  activeStartedAt: number | null
}

// ─── Store Interface ──────────────────────────────────────────────────

export interface CommandStore {
  /**
   * Ordered list of managed sessions — preserves insertion order for
   * list rendering (DashboardView, Sidebar, SessionsView).
   *
   * Always kept in sync with `sessionById`.  Consumers that need O(1)
   * lookup should use `sessionById` directly; consumers that need
   * ordered iteration should use `managedSessions`.
   */
  managedSessions: SessionSnapshot[]
  /**
   * Normalized session index — O(1) lookup by session ID.
   *
   * Source of truth for session metadata.  Selectors, event handlers,
   * and cross-store helpers should always prefer `sessionById[id]`
   * over `managedSessions.find(ms => ms.id === id)`.
   */
  sessionById: Record<string, SessionSnapshot>
  /**
   * High-frequency message store — decoupled from `managedSessions` to prevent
   * streaming message updates (~20/sec) from triggering re-renders in components
   * that only need session metadata (state, cost, model, etc.).
   *
   * Keyed by sessionId. Updated exclusively by `appendSessionMessage`.
   * Components that display real-time messages subscribe to this map;
   * components that only need metadata subscribe to `managedSessions`.
   *
   * **Dual-source architecture:**
   * `sessionMessages[id]` is the authoritative source for real-time
   * message content.  Session metadata (`SessionSnapshot`) no longer
   * carries messages.
   *
   * All UI consumers MUST use `selectSessionMessages(store, sessionId)`
   * — never read messages from `managedSessions`.
   */
  sessionMessages: Record<string, ManagedSessionMessage[]>
  /**
   * Streaming message overlay — the latest snapshot of the currently-streaming
   * message for each session.
   *
   * During **text-only** streaming (~20 events/sec), content updates are written
   * here instead of to `sessionMessages`, keeping `sessionMessages[sid]` reference
   * stable.  This prevents downstream `useMemo` chains (groupMessages,
   * buildToolLifecycleMap, turnDiffMap, navAnchors, etc.) from recomputing on
   * every frame — they only recompute when messages are added/removed or when
   * content block types change (structural change).
   *
   * Automatically merged back into `sessionMessages` when:
   *   - A **structural change** is detected (new content block type or count)
   *   - A **new message** is appended (requires stable list for indexing)
   *   - **Streaming ends** (`isStreaming` becomes false)
   *
   * `SessionMessageList` subscribes to this field separately from
   * `selectSessionMessages` to render the live streaming content in Virtuoso.
   */
  streamingMessageBySession: Record<string, ManagedSessionMessage | null>
  activeManagedSessionId: string | null

  setManagedSessions: (sessions: SessionSnapshot[]) => void
  upsertManagedSession: (session: SessionSnapshot) => void
  /**
   * Batch-upsert multiple sessions in a **single** `set()` call.
   *
   * Replaces the old pattern in `_flushPendingWrites` where
   * `upsertManagedSession` was called in a loop (N separate `set()` calls,
   * each creating a new `sessionById` object).  This produces exactly ONE
   * `sessionById` / `managedSessions` reference update regardless of how
   * many sessions changed — reducing GC pressure and eliminating N-1
   * redundant intermediate state objects.
   */
  batchUpsertManagedSessions: (sessions: ReadonlyMap<string, SessionSnapshot>) => void
  /**
   * @deprecated Use `batchAppendSessionMessages` instead.  This method does NOT
   * handle the `streamingMessageBySession` slot — calling it during active
   * streaming would create inconsistent state.  Retained only because removing
   * it from the interface requires updating the store initialiser; it has zero
   * external callers.
   */
  appendSessionMessage: (sessionId: string, message: ManagedSessionMessage) => void
  /**
   * Batch-apply multiple messages across sessions in a **single** `set()` call.
   *
   * Used by the rAF write-coalescing layer in `useAppBootstrap` to reduce
   * ~20 individual store updates/sec (one per streaming chunk) to 1 per
   * animation frame.  Within each session's batch, messages with the same
   * ID are deduplicated (last-write-wins) to avoid redundant array copies
   * when the same streaming message is updated multiple times per frame.
   */
  batchAppendSessionMessages: (entries: ReadonlyMap<string, ManagedSessionMessage[]>) => void
  removeManagedSession: (sessionId: string) => void
  setActiveManagedSession: (sessionId: string | null) => void

  /**
   * Ensure messages for a session are loaded into `sessionMessages`.
   *
   * If the session already has messages in memory, this is a no-op.
   * Otherwise, fetches messages from the main process via IPC.
   *
   * Use case: viewing a persisted/idle session in the Issue Detail panel.
   * Active streaming sessions have messages delivered via DataBus events
   * (`command:session:message`) — this method handles the cold-start path.
   */
  ensureSessionMessages: (sessionId: string) => Promise<void>

  /** Raw session start — IPC only, no cross-store side effects. */
  startSessionRaw: (input: StartSessionInput) => Promise<string>
  sendMessage: (sessionId: string, content: UserMessageContent) => Promise<boolean>
  resumeSession: (sessionId: string, content: UserMessageContent) => Promise<boolean>
  stopSession: (sessionId: string) => Promise<boolean>
  /** Raw session delete — IPC + local cleanup, no cross-store side effects. */
  deleteSessionRaw: (sessionId: string) => Promise<boolean>

  reset: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Build a `sessionById` index from an array.  O(N) — called once per bulk set. */
function indexSessions(sessions: SessionSnapshot[]): Record<string, SessionSnapshot> {
  const map: Record<string, SessionSnapshot> = {}
  for (const s of sessions) {
    map[s.id] = s
  }
  return map
}



// ─── Default State ────────────────────────────────────────────────────

const initialState = {
  managedSessions: [] as SessionSnapshot[],
  sessionById: {} as Record<string, SessionSnapshot>,
  sessionMessages: {} as Record<string, ManagedSessionMessage[]>,
  streamingMessageBySession: {} as Record<string, ManagedSessionMessage | null>,
  activeManagedSessionId: null as string | null,
}

// ─── In-flight deduplication for ensureSessionMessages ───────────────
// Tracks sessionIds currently being fetched to prevent concurrent IPC
// requests when multiple components mount simultaneously.
const _ensureInFlight = new Set<string>()

// Tracks sessionIds whose full message history has been fetched via IPC.
// Separated from sessionMessages to avoid false positives: DataBus streaming
// events can populate sessionMessages[sid] before the IPC fetch runs.
const _historyFetched = new Set<string>()

// ─── Store ────────────────────────────────────────────────────────────

export const useCommandStore = create<CommandStore>((set, get) => ({
  ...initialState,

  setManagedSessions: (sessions) =>
    set(() => {
      // SessionSnapshot carries no messages — sessionMessages is populated
      // exclusively via appendSessionMessage / batchAppendSessionMessages.
      return {
        managedSessions: sessions,
        sessionById: indexSessions(sessions),
      }
    }),

  upsertManagedSession: (session) =>
    set((s) => {
      const exists = session.id in s.sessionById
      // Update sessionById (O(1) — object spread + property set)
      const nextById = { ...s.sessionById, [session.id]: session }
      // Update ordered array
      let nextList: SessionSnapshot[]
      if (exists) {
        nextList = s.managedSessions.map((ms) => (ms.id === session.id ? session : ms))
      } else {
        nextList = [...s.managedSessions, session]
      }
      return {
        managedSessions: nextList,
        sessionById: nextById,
      }
    }),

  batchUpsertManagedSessions: (sessions) =>
    set((s) => {
      // Build the next sessionById in ONE pass (single object spread + N property sets).
      // Replaces the old loop of N upsertManagedSession calls, each of which
      // did its own full object spread — O(N×M) where M is the session count.
      const nextById = { ...s.sessionById }
      const newIds: string[] = []
      for (const [id, session] of sessions) {
        if (!(id in nextById)) newIds.push(id)
        nextById[id] = session
      }
      // Update ordered array: replace existing entries + append new ones.
      // Single pass through the array with Map.get() for O(1) lookup.
      //
      // ⚠️  PERFORMANCE CONTRACT — REFERENCE PRESERVATION:
      // The `?? ms` fallback is critical: it preserves the ORIGINAL object
      // reference for sessions NOT in the current batch.  Multiple Zustand
      // selectors depend on this for correct `Object.is` equality:
      //   - `useReviewSession` → ID-first selector (robust by construction)
      //   - `useAgentSession` → `sessionListEqual` structural comparator
      //   - `SidebarSessionItem` / `SessionPickerItem` → `React.memo`
      // If this line ever changes to always create new objects (e.g. deep
      // clone), those selectors will silently degrade to re-rendering on
      // every batch upsert (~20/sec during streaming).
      let nextList: SessionSnapshot[]
      if (newIds.length === 0) {
        nextList = s.managedSessions.map((ms) => sessions.get(ms.id) ?? ms)
      } else {
        nextList = s.managedSessions.map((ms) => sessions.get(ms.id) ?? ms)
        for (const id of newIds) {
          nextList.push(nextById[id])
        }
      }
      return {
        managedSessions: nextList,
        sessionById: nextById,
      }
    }),

  appendSessionMessage: (sessionId, message) =>
    set((s) => {
      // Update ONLY sessionMessages — does NOT touch managedSessions reference.
      // This is the critical performance fix: components subscribing to
      // managedSessions (IssueGroupedList, Sidebar, DashboardView) no longer
      // re-render on every streaming message (~20/sec).
      const existing = s.sessionMessages[sessionId] ?? []
      const idx = existing.findIndex((m) => m.id === message.id)
      let nextList: ManagedSessionMessage[]
      if (idx >= 0) {
        // Update in-place: preserve message ordering (fixes filter+append bug)
        nextList = [...existing]
        nextList[idx] = message
      } else {
        // Append new message
        nextList = [...existing, message]
      }
      return { sessionMessages: { ...s.sessionMessages, [sessionId]: nextList } }
    }),

  batchAppendSessionMessages: (entries) =>
    set((s) => {
      // Lazily initialized — `null` means "no structural changes yet".
      // Avoids creating new object references when only the streaming
      // message content is growing (the dominant streaming pattern).
      let nextMsgs: Record<string, ManagedSessionMessage[]> | null = null
      let nextStreaming: Record<string, ManagedSessionMessage | null> | null = null

      // Helper: read current streaming message for a session, respecting
      // any pending changes accumulated earlier in this batch.
      const getStreaming = (sid: string): ManagedSessionMessage | null =>
        (nextStreaming ?? s.streamingMessageBySession)[sid] ?? null

      for (const [sid, msgs] of entries) {
        // Deduplicate within the batch (last-write-wins)
        const latestById = new Map<string, ManagedSessionMessage>()
        for (const msg of msgs) latestById.set(msg.id, msg)

        // Read the current structural message list for this session
        const currentList = (nextMsgs ?? s.sessionMessages)[sid] ?? []
        const posMap = new Map<string, number>()
        for (let i = 0; i < currentList.length; i++) posMap.set(currentList[i].id, i)

        let newList: ManagedSessionMessage[] | null = null // null = not yet copied
        const toAppend: ManagedSessionMessage[] = []

        for (const [id, msg] of latestById) {
          const pos = posMap.get(id)
          if (pos !== undefined) {
            // ── Update existing message ──────────────────────────────
            const existing = currentList[pos]

            if (msg.role === 'assistant' && msg.isStreaming) {
              // FAST PATH: ALL streaming assistant updates — text growth AND
              // structural changes (new tool_use block, thinking block, etc.).
              //
              // Write to streamingMessageBySession ONLY — sessionMessages
              // reference stays stable → all downstream useMemos skip:
              //   - groupMessages: streaming messages are never batchable
              //     (isBatchableToolMessage returns false for isStreaming=true)
              //   - buildToolLifecycleMap: streaming messages have no tool_result yet
              //   - buildTaskLifecycleMap: only scans system events
              //   - turnDiffMap: gated by isTurnSettled (false during streaming)
              //
              // AssistantMessage self-subscribes to the streaming overlay
              // (selectStreamingMessage) and uses it as the authoritative
              // source for ALL live fields (content, activeToolUseId, etc.),
              // so tool pills and all blocks render correctly.
              //
              // When streaming ends (isStreaming → false), the slow path fires
              // and merges the final version into sessionMessages — at which
              // point downstream scans recompute with the complete message.
              if (!nextStreaming) nextStreaming = { ...s.streamingMessageBySession }
              nextStreaming[sid] = msg
            } else {
              // SLOW PATH: streaming ended (isStreaming → false) or non-streaming
              // message update.  Merge into sessionMessages → triggers downstream
              // recomputation (groupMessages, buildToolLifecycleMap, etc.).
              if (!newList) newList = [...currentList]
              newList[pos] = msg
              // Clear streaming slot if this message was in it
              if (getStreaming(sid)?.id === id) {
                if (!nextStreaming) nextStreaming = { ...s.streamingMessageBySession }
                nextStreaming[sid] = null
              }
            }
          } else {
            // ── New message ──────────────────────────────────────────
            // Merge any pending streaming message back into the list
            // before appending, so the final list has correct ordering.
            const pendingStreaming = getStreaming(sid)
            if (pendingStreaming) {
              const streamPos = posMap.get(pendingStreaming.id)
              if (streamPos !== undefined) {
                if (!newList) newList = [...currentList]
                newList[streamPos] = pendingStreaming
              }
              if (!nextStreaming) nextStreaming = { ...s.streamingMessageBySession }
              nextStreaming[sid] = null
            }
            toAppend.push(msg)
          }
        }

        // Apply structural changes for this session
        if (newList || toAppend.length > 0) {
          if (!nextMsgs) nextMsgs = { ...s.sessionMessages }
          const base = newList ?? currentList
          nextMsgs[sid] = toAppend.length > 0 ? base.concat(toAppend) : base
        }
      }

      // Only include fields that actually changed — Zustand merges
      // shallowly, so omitting a field preserves its current reference.
      const update: Partial<Pick<CommandStore, 'sessionMessages' | 'streamingMessageBySession'>> = {}
      if (nextMsgs) update.sessionMessages = nextMsgs
      if (nextStreaming) update.streamingMessageBySession = nextStreaming
      return update
    }),

  removeManagedSession: (sessionId) => {
    // Clean up module-level caches so a re-created session triggers a fresh fetch.
    _historyFetched.delete(sessionId)
    _ensureInFlight.delete(sessionId)
    set((s) => {
      // Clean up all structures atomically
      const { [sessionId]: _removedSession, ...remainingById } = s.sessionById
      const { [sessionId]: _removedMessages, ...remainingMessages } = s.sessionMessages
      const { [sessionId]: _removedStreaming, ...remainingStreaming } = s.streamingMessageBySession
      return {
        managedSessions: s.managedSessions.filter((ms) => ms.id !== sessionId),
        sessionById: remainingById,
        sessionMessages: remainingMessages,
        streamingMessageBySession: remainingStreaming,
        activeManagedSessionId:
          s.activeManagedSessionId === sessionId ? null : s.activeManagedSessionId,
      }
    })
  },

  setActiveManagedSession: (sessionId) => set({ activeManagedSessionId: sessionId }),

  ensureSessionMessages: async (sessionId) => {
    // Only skip if we've done a full IPC history fetch for this session.
    // Do NOT use `sessionId in get().sessionMessages` — that key can be
    // populated by DataBus streaming events before the history fetch runs,
    // causing the early exit to skip the full fetch (page-refresh bug).
    if (_historyFetched.has(sessionId)) return

    // Deduplicate concurrent calls for the same session.
    // Multiple components may mount simultaneously and all pass the
    // cache-check above before the first IPC resolves.
    if (_ensureInFlight.has(sessionId)) return
    _ensureInFlight.add(sessionId)

    try {
      const fetched = await getAppAPI()['command:get-session-messages'](sessionId)

      // Merge: the IPC result is the authoritative history base.
      // Any DataBus messages that arrived while the IPC was in-flight and
      // are NOT already in the fetched result (generated after the snapshot)
      // must be preserved so we don't lose recent streaming chunks.
      const fetchedIds = new Set(fetched.map((m) => m.id))
      set((s) => {
        // Session was deleted while IPC was in-flight — discard result.
        if (!(sessionId in s.sessionById)) return {}

        const existing = s.sessionMessages[sessionId] ?? []
        const tail = existing.filter((m) => !fetchedIds.has(m.id))
        return {
          sessionMessages: {
            ...s.sessionMessages,
            [sessionId]: tail.length > 0 ? [...fetched, ...tail] : fetched,
          },
        }
      })
      _historyFetched.add(sessionId)
    } catch {
      // Silently ignore — session may have been deleted between render and fetch.
    } finally {
      _ensureInFlight.delete(sessionId)
    }
  },

  startSessionRaw: async (input) => {
    return getAppAPI()['command:start-session'](input)
  },

  sendMessage: async (sessionId, content) => {
    return getAppAPI()['command:send-message'](sessionId, content)
  },

  resumeSession: async (sessionId, content) => {
    return getAppAPI()['command:resume-session'](sessionId, content)
  },

  stopSession: async (sessionId) => {
    return getAppAPI()['command:stop-session'](sessionId)
  },

  deleteSessionRaw: async (sessionId) => {
    const result = await getAppAPI()['command:delete-session'](sessionId)
    if (result) {
      // Optimistic removal — DataBus event will also trigger removeManagedSession
      // but we update immediately for snappy UI response.
      // Delegates to removeManagedSession to keep cleanup logic DRY.
      get().removeManagedSession(sessionId)
    }
    return result
  },

  reset: () => {
    _ensureInFlight.clear()
    _historyFetched.clear()
    set(initialState)
  },
}))

// ─── Row-Level Selectors ──────────────────────────────────────────────
//
// These hooks provide per-item store subscriptions for use INSIDE list row
// components (below the React.memo boundary).  They replace the old pattern
// of subscribing to the entire `managedSessions` array, which caused the
// entire list to re-render on every session state change.
//
// Key design:
//   - `shallow` equality prevents re-renders when the derived values haven't
//     changed, even though the source array (`managedSessions`) has a new ref.
//   - In Virtuoso flat mode, only ~20-30 visible rows mount these hooks —
//     off-screen rows have zero subscription overhead.
//   - Selectors use `sessionById` for O(1) lookup instead of `managedSessions.find()`.

/**
 * Row-level hook: subscribe to the session context for a single issue.
 *
 * Returns `null` when the issue has no linked session or the session is not
 * in the managed list.  Uses `shallow` equality on a flat primitive-only object
 * so the component only re-renders when the session's STATE or TIMING actually
 * changes — not when unrelated session fields (cost, messages, model) update.
 */
export function useIssueSessionContext(
  sessionId: string | null,
): IssueSessionContext | null {
  return useStoreWithEqualityFn(
    useCommandStore,
    (s) => {
      if (!sessionId) return null
      const session = s.sessionById[sessionId]
      if (!session) return null
      // Return flat primitives only — no nested objects.
      // The consumer reconstructs `ActiveDuration` if needed.
      return {
        state: session.state,
        activeDurationMs: session.activeDurationMs,
        activeStartedAt: session.activeStartedAt,
      }
    },
    shallow,
  )
}

// ─── Session Identity Selector ────────────────────────────────────────

interface SessionIdentity {
  id: string
  projectPath: string | null
  projectId: string | null
}

/**
 * Narrow identity selector — resolves a session by its managed ID or
 * `engineSessionRef`, returning only the stable identity fields (id,
 * projectPath, projectId).
 *
 * Uses `shallow` equality so the consuming component only re-renders
 * when one of these identity fields actually changes — NOT on every
 * metadata update (cost, tokens, state) during streaming.
 *
 * The fallback `.find()` on `managedSessions` still runs inside the
 * selector, but the component skips re-render because identity fields
 * are stable for the lifetime of a session.
 */
export function useSessionIdentity(ref: string): SessionIdentity | null {
  return useStoreWithEqualityFn(
    useCommandStore,
    (s): SessionIdentity | null => {
      const session =
        s.sessionById[ref] ??
        s.managedSessions.find((ms) => ms.engineSessionRef === ref)
      if (!session) return null
      return {
        id: session.id,
        projectPath: session.projectPath,
        projectId: session.projectId,
      }
    },
    shallow,
  )
}

// ─── Sidebar Live Counts ─────────────────────────────────────────────

/** Managed session states where the agent is actively running or awaiting user input. */
const LIVE_SESSION_STATES: ReadonlySet<ManagedSessionState> = new Set<ManagedSessionState>([
  'creating', 'streaming', 'awaiting_input', 'awaiting_question',
])

/**
 * Sidebar-level hook: compute live session counts per project.
 *
 * Returns `Record<string, number>` — projectId → count of sessions in
 * a live state (creating/streaming/awaiting).  Uses `shallow` equality
 * so the Sidebar only re-renders when an actual count changes, NOT on
 * every metadata update (cost, tokens, context) during streaming.
 *
 * During streaming the session.state stays 'streaming' the entire time,
 * so the computed counts are stable → zero Sidebar re-renders.
 */
export function useLiveSessionCounts(): Record<string, number> {
  return useStoreWithEqualityFn(
    useCommandStore,
    (s) => {
      const live: Record<string, number> = {}
      for (const ms of s.managedSessions) {
        if (!ms.projectId) continue
        // Skip schedule-triggered sessions — automated runs should not inflate the live badge.
        if (ms.origin.source === 'schedule') continue
        if (LIVE_SESSION_STATES.has(ms.state)) {
          live[ms.projectId] = (live[ms.projectId] ?? 0) + 1
        }
      }
      return live
    },
    shallow,
  )
}

// ─── Streaming Session Metrics ───────────────────────────────────────

/**
 * Per-frame volatile session metrics for streaming display components.
 *
 * These fields change on every IPC tick (~60/sec) during streaming.
 * Components that display token counts, elapsed time, or activity status
 * subscribe via `useStreamingSessionMetrics` — which uses `shallow` equality
 * on this flat-primitive structure — instead of receiving props from
 * SessionPanel.  This decoupling prevents SessionPanel from re-rendering
 * on every streaming tick (the root cause of input lag during streaming).
 */
export interface StreamingSessionMetrics {
  activeDurationMs: number
  activeStartedAt: number | null
  inputTokens: number
  outputTokens: number
  activity: string | null
}

/**
 * Hook: subscribe to per-frame streaming metrics for a session.
 *
 * Returns flat primitives — `shallow` equality ensures re-render only when
 * an actual value changes (not just the SessionSnapshot reference).
 *
 * Used by StreamingOverlayContent and SessionStatusBar to receive per-frame
 * data independently from SessionPanel.
 */
export function useStreamingSessionMetrics(sessionId: string): StreamingSessionMetrics | null {
  return useStoreWithEqualityFn(
    useCommandStore,
    (s): StreamingSessionMetrics | null => {
      const session = s.sessionById[sessionId]
      if (!session) return null
      return {
        activeDurationMs: session.activeDurationMs,
        activeStartedAt: session.activeStartedAt ?? null,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        activity: session.activity ?? null,
      }
    },
    shallow,
  )
}

// ─── Derived State Selectors ─────────────────────────────────────────

/**
 * Whether a session is "actively processing" — creating, streaming, or in an
 * awaiting state with a still-streaming assistant message.
 *
 * This is a *selector*, not a hook — it reads from both `sessionById`
 * (metadata) and `sessionMessages` (streaming flag) in a single pass.
 *
 * Fast-path: for states other than `awaiting_input` / `awaiting_question`
 * the answer is determined from metadata alone (O(1)), avoiding the
 * `messages.some()` scan entirely.
 */
export function selectIsProcessing(store: CommandStore, sessionId: string | null): boolean {
  if (!sessionId) return false
  const session = store.sessionById[sessionId]
  if (!session) return false
  const { state } = session
  if (state === 'creating' || state === 'streaming') return true
  if (state !== 'awaiting_input' && state !== 'awaiting_question') return false
  // Awaiting states: only "processing" if an assistant message is still streaming.
  // Check the streaming slot first (O(1) — fast path during active streaming).
  const streaming = store.streamingMessageBySession[sessionId]
  if (streaming?.role === 'assistant' && streaming.isStreaming === true) return true
  // Fall back to the structural messages array.
  const msgs = store.sessionMessages[sessionId]
  return msgs?.some((m) => m.role === 'assistant' && m.isStreaming === true) ?? false
}

// ─── Session Message Selectors ────────────────────────────────────────

/** Stable empty array to avoid new references when a session has no messages. */
const EMPTY_SESSION_MESSAGES: ManagedSessionMessage[] = []

/**
 * Selector for real-time session messages.
 *
 * Returns the message array from the high-frequency `sessionMessages` store,
 * falling back to a stable empty array reference.
 * Components that display streaming messages should use this selector
 * instead of `session.messages` to avoid re-rendering metadata-only subscribers.
 */
export function selectSessionMessages(store: CommandStore, sessionId: string | null): ManagedSessionMessage[] {
  if (!sessionId) return EMPTY_SESSION_MESSAGES
  return store.sessionMessages[sessionId] ?? EMPTY_SESSION_MESSAGES
}

/**
 * Selector for the currently-streaming message overlay (if any).
 *
 * During text-only streaming, the latest message snapshot lives here
 * instead of in `sessionMessages`, keeping the array reference stable
 * for structural scans.  Returns `null` when:
 *   - The session has no active streaming message
 *   - The streaming message was merged back into `sessionMessages`
 *     (structural change or streaming ended)
 *
 * `SessionMessageList` subscribes to this separately and splices the
 * result into the Virtuoso data array.  Other subscribers (StickyQuestionBanner,
 * ArtifactViewerProvider, etc.) do NOT need this — they only use structural
 * data from `selectSessionMessages`.
 */
export function selectStreamingMessage(store: CommandStore, sessionId: string | null): ManagedSessionMessage | null {
  if (!sessionId) return null
  return store.streamingMessageBySession[sessionId] ?? null
}
