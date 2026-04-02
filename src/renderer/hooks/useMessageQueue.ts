// SPDX-License-Identifier: Apache-2.0

import { useCallback, useRef, useMemo, useSyncExternalStore } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import type { UserMessageContent } from '@shared/types'
import {
  compactSlashExecutionContract,
  normalizeSlashExecutionContract,
} from '@shared/slashExecution'
import type { UserMessageBlock } from '@shared/contentBuilder'
import { useCommandStore } from '@/stores/commandStore'

/* ================================================================== */
/*                                                                      */
/*  Message Queue for Session Console                                   */
/*                                                                      */
/*  Architecture (separation of concerns):                              */
/*                                                                      */
/*    ┌─────────────────────────────────────────────────────────────┐   */
/*    │  Storage Layer                                              │   */
/*    │  _store (unified Map) + _dispatchPhase (Map) + localStorage      │   */
/*    │  — single source of truth for ALL session queue state       │   */
/*    │  — subscribeStore / notifyStoreChange for React sync        │   */
/*    └────────────┬──────────────────────────────────┬────────────┘   */
/*                 │ writes                    reads │               */
/*    ┌────────────┴────────────────┐  ┌─────────────┴────────────┐   */
/*    │  Dispatch Layer             │  │  UI Layer                 │   */
/*    │  (module-level Zustand sub) │  │  (useMessageQueue hook)   │   */
/*    │  — auto-dispatch for ALL    │  │  — useSyncExternalStore   │   */
/*    │    sessions                 │  │    derives React state    │   */
/*    │  — batch / sequential modes │  │    from _store/_dispatchPhase  │   */
/*    │  — independent of React     │  │  — queue CRUD + reorder   │   */
/*    │    component lifecycle      │  │  — dispatch mode toggle   │   */
/*    │  — mutates _store/_dispatchPhase │  │  — NO dispatch logic      │   */
/*    │    + notifyStoreChange()    │  │                            │   */
/*    └─────────────────────────────┘  └───────────────────────────┘   */
/*                                                                      */
/*  Data flow is unidirectional:                                        */
/*    Dispatch Layer → mutates _store → notifyStoreChange()             */
/*    UI Layer → useSyncExternalStore(subscribeStore, getSnapshot)       */
/*  No observer pattern, no bidirectional coupling.                     */
/*                                                                      */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface QueuedMessage {
  id: string
  content: UserMessageContent
  queuedAt: number
}

/** Dispatch strategy for queued messages. */
export type QueueDispatchMode = 'batch' | 'sequential'

/**
 * Current phase of the dispatch lifecycle for a session.
 *
 * - `idle`      — no dispatch in progress
 * - `sending`   — message being sent to the agent (IPC in flight)
 * - `awaiting_agent` — message sent, waiting for agent to finish processing
 *                      (sequential mode only)
 */
export type DispatchPhase = 'idle' | 'sending' | 'awaiting_agent'

/**
 * Dispatch state — shared by hook return and component props for
 * zero-mapping passthrough between useMessageQueue → SessionPanel → QueuedMessageList.
 */
export interface QueueDispatchContext {
  /** Current dispatch mode. */
  mode: QueueDispatchMode
  /** Current phase of the dispatch lifecycle. */
  phase: DispatchPhase
  /** Toggle the dispatch mode. */
  onModeChange: (mode: QueueDispatchMode) => void
}

export interface UseMessageQueueOptions {
  /**
   * Session ID — used to persist queues across component unmount/remount
   * (e.g. when switching Issues) and to isolate queues per session.
   */
  sessionId: string
}

export interface UseMessageQueueReturn {
  /** Ordered list of queued messages */
  queue: QueuedMessage[]
  /** Add a message to the end of the queue */
  enqueue: (content: UserMessageContent) => void
  /** Remove a message from the queue by id */
  dequeue: (id: string) => void
  /** Update the content of a queued message */
  updateQueued: (id: string, content: UserMessageContent) => void
  /** Reorder queue items via drag-and-drop IDs (for sequential mode) */
  reorder: (activeId: string, overId: string) => void
  /** Clear all queued messages */
  clearQueue: () => void
  /** Dispatch state and mode control (memoized — only changes when mode/phase change) */
  dispatch: QueueDispatchContext
}

/* ------------------------------------------------------------------ */
/*  Storage Layer — module-level persistence                           */
/* ------------------------------------------------------------------ */

/**
 * Unified queue state per session — holds both messages and dispatch mode
 * as an atomic unit.  Eliminates dual-Map fragility where queue and mode
 * could diverge if only one Map is updated.
 */
interface QueueState {
  messages: QueuedMessage[]
  dispatchMode: QueueDispatchMode
}

/**
 * Single source of truth for all session queues at the module level.
 * Keyed by sessionId so each session has its own isolated queue + mode.
 */
const _store = new Map<string, QueueState>()

/**
 * Module-level dispatch phase tracker — replaces the old boolean `_dispatchPhase` Set.
 *
 * Tracks WHERE in the dispatch lifecycle each session is:
 *   - absent     → idle (no dispatch)
 *   - 'sending'  → IPC in flight (sendMessage / resumeSession)
 *   - 'awaiting_agent' → message sent, waiting for agent to finish (sequential)
 *
 * Also serves as the concurrency guard — `_dispatchPhase.has(sessionId)`
 * prevents overlapping dispatches for the same session.
 */
const _dispatchPhase = new Map<string, Exclude<DispatchPhase, 'idle'>>()

/* ------------------------------------------------------------------ */
/*  Store subscription system                                          */
/*                                                                      */
/*  Bridges _store / _dispatchPhase (module-level mutable state) to React    */
/*  via useSyncExternalStore.  Any mutation to _store or _dispatchPhase       */
/*  calls notifyStoreChange() → React re-evaluates snapshots →          */
/*  re-renders only if the derived value actually changed.              */
/*                                                                      */
/*  This replaces the imperative DispatchObserver pattern — no manual   */
/*  sync needed; consistency is structurally guaranteed.                 */
/* ------------------------------------------------------------------ */

type StoreListener = () => void
const _storeListeners = new Set<StoreListener>()

/**
 * Notify all subscribers that `_store` or `_dispatchPhase` has been mutated.
 *
 * Must be called after EVERY mutation to `_store` entries or `_dispatchPhase`.
 * `useSyncExternalStore` will re-check snapshots and trigger re-render
 * only if the derived value changed (referential equality for arrays,
 * value equality for primitives).
 */
function notifyStoreChange(): void {
  for (const listener of _storeListeners) listener()
}

/**
 * Subscribe to store changes.  Used by `useSyncExternalStore` in the hook.
 * Module-level and referentially stable — avoids re-subscription on render.
 */
function subscribeStore(listener: StoreListener): () => void {
  _storeListeners.add(listener)
  return () => _storeListeners.delete(listener)
}

const EMPTY_QUEUE: QueuedMessage[] = []

/* ------------------------------------------------------------------ */
/*  localStorage persistence                                           */
/* ------------------------------------------------------------------ */

const STORAGE_PREFIX = 'queue:'
/** Queued messages older than 7 days are considered stale and auto-cleaned. */
const QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Persistable subset of UserMessageContent — excludes binary blobs
 * (image/document base64) to keep storage footprint bounded.
 *
 * Text intent is the primary value; images can be re-attached after restore.
 */
type PersistableContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | {
          type: 'slash_command'
          name: string
          category: 'command' | 'skill'
          label?: string
          execution?: {
            nativeRequirements: Array<{ capability: string; tool?: string }>
            providerExecution?: {
              provider: 'evose'
              appId: string
              appType: 'agent' | 'workflow'
              gatewayTool: 'evose_run_agent' | 'evose_run_workflow'
            }
          }
          expandedText: string
        }
    >

interface PersistedRecord {
  id: string
  content: PersistableContent
  queuedAt: number
}

interface StorageEnvelope {
  records: PersistedRecord[]
  savedAt: number
  /** Dispatch mode — optional for backward compat with pre-existing envelopes. */
  dispatchMode?: QueueDispatchMode
}

/**
 * Strip binary blobs (image/document base64) from UserMessageContent.
 * Retains only text and slash_command blocks — the user's text intent
 * is the primary value; images can be re-attached after restore.
 *
 * Returns `null` if the content becomes empty after stripping (e.g.
 * image-only messages) — callers should skip persisting the record.
 */
function toPersistableContent(content: UserMessageContent): PersistableContent | null {
  if (typeof content === 'string') return content || null
  const persistable = content
    .filter((b) => b.type === 'text' || b.type === 'slash_command')
    .map((block) => {
      if (block.type !== 'slash_command') return block
      const normalizedLabel = typeof block.label === 'string' ? block.label.trim() : ''
      return {
        ...block,
        label: normalizedLabel || block.name,
        ...(compactSlashExecutionContract(block.execution)
          ? { execution: normalizeSlashExecutionContract(block.execution) }
          : {}),
      }
    })
  if (persistable.length === 0) return null
  // If only a single text block remains, simplify to plain string
  if (persistable.length === 1 && persistable[0].type === 'text') {
    return persistable[0].text || null
  }
  return persistable as PersistableContent
}

/**
 * Convert in-memory queue to persistable records.
 * Messages whose content becomes empty after binary stripping
 * (e.g. image-only messages) are excluded — no ghost entries on hydration.
 */
function toPersistableRecords(queue: QueuedMessage[]): PersistedRecord[] | null {
  const records: PersistedRecord[] = []
  for (const m of queue) {
    const content = toPersistableContent(m.content)
    if (content === null) continue
    records.push({ id: m.id, content, queuedAt: m.queuedAt })
  }
  return records.length > 0 ? records : null
}

/**
 * Write queue state to localStorage.  Writes synchronously — no debounce
 * needed because queue operations (enqueue/dequeue/edit) are discrete user
 * actions (not continuous keystrokes), and the data is tiny after binary
 * stripping (~100-500 bytes per message).
 */
function persistToStorage(sessionId: string, state: QueueState): void {
  const key = `${STORAGE_PREFIX}${sessionId}`
  const records = toPersistableRecords(state.messages)
  if (!records) {
    localStorage.removeItem(key)
    return
  }
  try {
    const envelope: StorageEnvelope = {
      records,
      savedAt: Date.now(),
      dispatchMode: state.dispatchMode,
    }
    localStorage.setItem(key, JSON.stringify(envelope))
  } catch {
    // Swallow quota errors — queue remains in memory as source of truth
  }
}

/** Remove queue data from localStorage for a session. */
function clearStorage(sessionId: string): void {
  localStorage.removeItem(`${STORAGE_PREFIX}${sessionId}`)
}

/**
 * Restore storage envelope from localStorage.  Returns null if no valid
 * data found, data is malformed, or data is older than QUEUE_MAX_AGE_MS.
 */
function restoreEnvelope(sessionId: string): StorageEnvelope | null {
  const key = `${STORAGE_PREFIX}${sessionId}`
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const envelope = JSON.parse(raw) as StorageEnvelope
    // Staleness check — matches useIssueDraftCache pattern
    if (Date.now() - envelope.savedAt > QUEUE_MAX_AGE_MS) {
      localStorage.removeItem(key)
      return null
    }
    return envelope.records?.length > 0 ? envelope : null
  } catch {
    localStorage.removeItem(key)
    return null
  }
}

/**
 * Hydrate QueuedMessage[] from persisted records.
 * The persisted records use PersistableContent (no binary blobs),
 * which is a valid subset of UserMessageContent, so the cast is safe.
 */
function hydrateFromRecords(records: PersistedRecord[]): QueuedMessage[] {
  const normalizeSlashLabel = (value: PersistableContent): UserMessageContent => {
    if (typeof value === 'string') return value
    return value.map((block) => {
      if (block.type !== 'slash_command') return block
      const normalizedLabel = typeof block.label === 'string' ? block.label.trim() : ''
      return {
        ...block,
        label: normalizedLabel || block.name,
        ...(compactSlashExecutionContract(block.execution)
          ? { execution: normalizeSlashExecutionContract(block.execution) }
          : {}),
      }
    })
  }

  return records.map((r) => ({
    id: r.id,
    content: normalizeSlashLabel(r.content),
    queuedAt: r.queuedAt,
  }))
}

/**
 * Pre-populate `_store` from ALL localStorage `queue:*` entries.
 *
 * Called once at module init so the global dispatcher has complete queue
 * data before any React component mounts.  Without this, queues persisted
 * across page refreshes would only enter `_store` when their specific
 * useMessageQueue hook instance mounts — too late for the global dispatcher
 * to act when the initial `managedSessions` load arrives.
 */
function populateAllFromStorage(): void {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(STORAGE_PREFIX)) continue
    const sessionId = key.slice(STORAGE_PREFIX.length)
    if (_store.has(sessionId)) continue
    const envelope = restoreEnvelope(sessionId)
    if (envelope && envelope.records.length > 0) {
      _store.set(sessionId, {
        messages: hydrateFromRecords(envelope.records),
        dispatchMode: envelope.dispatchMode ?? 'batch',
      })
    }
  }
}

/**
 * Resolved queue state from all available sources.
 */
interface ResolvedQueue {
  messages: QueuedMessage[]
  dispatchMode: QueueDispatchMode
}

/**
 * Resolve the queue for a given sessionId from all available sources.
 *
 * Priority:
 *   1. In-memory `_store` Map (component remount within same page session)
 *   2. localStorage (page refresh / app restart)
 *   3. Empty queue (no data)
 *
 * Side-effect: populates `_store` when restoring from localStorage
 * so subsequent lookups hit the fast path.
 */
function resolveQueue(sessionId: string): ResolvedQueue {
  // Priority 1: in-memory Map
  const cached = _store.get(sessionId)
  if (cached && cached.messages.length > 0) {
    return { messages: cached.messages, dispatchMode: cached.dispatchMode }
  }

  // Priority 2: localStorage
  const envelope = restoreEnvelope(sessionId)
  if (envelope && envelope.records.length > 0) {
    const hydrated = hydrateFromRecords(envelope.records)
    const mode = envelope.dispatchMode ?? 'batch'
    _store.set(sessionId, { messages: hydrated, dispatchMode: mode })
    return { messages: hydrated, dispatchMode: mode }
  }

  return { messages: EMPTY_QUEUE, dispatchMode: 'batch' }
}

/* ------------------------------------------------------------------ */
/*  Merge helper                                                       */
/* ------------------------------------------------------------------ */

/**
 * Merge multiple queued messages into a single UserMessageContent.
 * - If all messages are plain text, join with `\n\n`.
 * - Otherwise, flatten all blocks into a single content-block array.
 */
function mergeQueuedMessages(messages: QueuedMessage[]): UserMessageContent {
  if (messages.length === 1) return messages[0].content

  const blocks: UserMessageBlock[] = []

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      blocks.push({ type: 'text', text: msg.content })
    } else {
      blocks.push(...(msg.content as UserMessageBlock[]))
    }
  }

  // Optimisation: if every block is text, collapse to a plain string
  if (blocks.every((b) => b.type === 'text')) {
    return blocks.map((b) => b.type === 'text' ? b.text : '').join('\n\n')
  }

  // Merge consecutive text blocks for readability
  const merged: UserMessageBlock[] = []
  for (const block of blocks) {
    const prev = merged.length > 0 ? merged[merged.length - 1] : null
    if (block.type === 'text' && prev?.type === 'text') {
      prev.text += '\n\n' + block.text
    } else {
      merged.push({ ...block })
    }
  }

  return merged
}

/* ------------------------------------------------------------------ */
/*  Dispatch Layer — global auto-dispatch                              */
/* ------------------------------------------------------------------ */

/**
 * Wait for the agent to complete a full processing round-trip.
 *
 * Observes session state transitions via a temporary Zustand subscription:
 *   (current: ready) → busy (agent started) → ready (agent finished) → resolve
 *
 * ## Usage
 *
 * The caller sets up this watcher BEFORE invoking `sendMessage` / `resumeSession`
 * to guarantee that even "fast agent" transitions (busy → ready arriving before
 * the IPC ack) are captured.  JavaScript's single-threaded execution guarantees
 * no async events fire between `subscribe()` and the `await sendFn()` call.
 *
 * ## Self-cleaning
 *
 * The subscription is removed on resolution or when the session disappears.
 * At most one watcher exists per session (the `_dispatchPhase` lock prevents
 * concurrent dispatch).
 *
 * @param signal — optional AbortSignal to cancel the wait (e.g. on send failure).
 *   Ensures the internal subscription is cleaned up even when the caller
 *   never reaches `await completionPromise`.
 */
function waitForAgentCompletion(
  sessionId: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) { resolve(); return }

    let seenBusy = false

    const done = (): void => {
      unsub()
      resolve()
    }

    const unsub = useCommandStore.subscribe((state) => {
      const session = state.sessionById[sessionId]
      if (!session) { done(); return }

      const isBusy = session.state === 'streaming' || session.state === 'creating'
      const isReady = session.state === 'idle' || session.state === 'stopped'
        || session.state === 'awaiting_input'

      if (!seenBusy && isBusy) seenBusy = true
      if (seenBusy && isReady) done()
    })

    signal?.addEventListener('abort', done, { once: true })
  })
}

/**
 * Execute a single dispatch operation.
 *
 * - **Batch**: merges all queued messages into one payload, sends once.
 * - **Sequential**: sends only the first message, then awaits agent
 *   completion before returning.
 *
 * By the time this function resolves, the agent has finished processing
 * (sequential) or the IPC was acknowledged (batch).  The caller can
 * safely re-invoke `tryDispatchSession` for pipeline continuation / TOCTOU.
 *
 * ## TOCTOU safety
 *
 * Message removal uses ID-based filtering — reads the CURRENT `_store`
 * (not the stale closure snapshot) and removes only the dispatched
 * message IDs.  This prevents data loss when the user enqueues or
 * reorders during an in-flight dispatch.
 */
async function doDispatch(
  sessionId: string,
  queueState: QueueState,
): Promise<boolean> {
  const appState = useCommandStore.getState()
  const session = appState.sessionById[sessionId]
  if (!session) return false

  const mode = queueState.dispatchMode
  const messages = queueState.messages
  const payload = mode === 'batch'
    ? mergeQueuedMessages(messages)
    : messages[0].content

  // Sequential: subscribe BEFORE send to capture fast agent transitions.
  // JS single-threaded guarantee: no async events between subscribe() and
  // the await sendFn() call below.
  const abort = new AbortController()
  const completionPromise = mode === 'sequential'
    ? waitForAgentCompletion(sessionId, abort.signal)
    : undefined

  const isResumeReady = session.state === 'idle' || session.state === 'stopped'
  const { resumeSession, sendMessage } = appState

  let success: boolean
  try {
    success = isResumeReady
      ? await resumeSession(sessionId, payload)
      : await sendMessage(sessionId, payload)
  } catch (err) {
    abort.abort() // clean up the completion watcher subscription
    throw err
  }

  if (!success) {
    abort.abort() // clean up the completion watcher subscription
    return false
  }

  // TOCTOU-safe: ID-based filtering reads CURRENT _store
  const dispatchedIds = new Set(
    mode === 'batch' ? messages.map((m) => m.id) : [messages[0].id],
  )
  const current = _store.get(sessionId)
  if (current) {
    const remaining = current.messages.filter((m) => !dispatchedIds.has(m.id))
    if (remaining.length > 0) {
      current.messages = remaining
      persistToStorage(sessionId, current)
    } else {
      // Keep _store entry alive (preserves dispatchMode preference)
      // so the next enqueue inherits the user's chosen mode.
      current.messages = EMPTY_QUEUE
      clearStorage(sessionId)
    }
  }

  // Transition phase: 'sending' → 'awaiting_agent' for sequential mode.
  // The user sees:
  //   1. Queue updated (dispatched message removed)
  //   2. Phase changed (UI switches from "sending" to "awaiting reply")
  // Both happen in a single notifyStoreChange() call.
  if (completionPromise) {
    _dispatchPhase.set(sessionId, 'awaiting_agent')
  }
  notifyStoreChange()

  // Sequential: block until agent completes this round
  if (completionPromise) {
    await completionPromise
  }

  return true
}

/**
 * Attempt to dispatch queued messages for a specific session.
 *
 * Called from:
 *   1. Global Zustand subscription (managedSessions changes)
 *   2. `.finally()` after dispatch completes (pipeline continuation / TOCTOU)
 *   3. `setMode` callback (user toggles mode while session is ready)
 *
 * Guards ensure safe no-op when conditions aren't met:
 *   - No pending queue → return
 *   - Dispatch already in-flight → return
 *   - Session not in a ready state → return
 *
 * ## Why `.finally()` → `tryDispatchSession` is safe
 *
 * `doDispatch` resolves only after the agent has completed processing
 * (sequential mode) or the IPC was acknowledged (batch mode).  When
 * `.finally()` re-invokes this function, the session is guaranteed to
 * be in a ready state (or the dispatch failed).  No external gating
 * mechanism is needed.
 */
function tryDispatchSession(sessionId: string): void {
  const queueState = _store.get(sessionId)
  if (!queueState || queueState.messages.length === 0) return
  if (_dispatchPhase.has(sessionId)) return

  const appState = useCommandStore.getState()
  const session = appState.sessionById[sessionId]
  if (!session) return

  const isReady = session.state === 'idle' || session.state === 'stopped'
    || session.state === 'awaiting_input'
  if (!isReady) return

  // ── Dispatch ──────────────────────────────────────────────────
  _dispatchPhase.set(sessionId, 'sending')
  notifyStoreChange() // phase → 'sending' for this session

  let dispatchSucceeded = false

  doDispatch(sessionId, queueState)
    .then((success) => {
      dispatchSucceeded = success
    })
    .catch((err) => {
      console.error(`[Queue] dispatch failed for session ${sessionId}:`, err)
    })
    .finally(() => {
      _dispatchPhase.delete(sessionId)
      notifyStoreChange() // phase → 'idle' for this session
      // Re-check for remaining messages:
      // - Sequential: doDispatch already awaited agent completion — safe to proceed.
      // - Batch: handles TOCTOU (user enqueued during in-flight dispatch).
      // - Failure (dispatchSucceeded=false): skip — queue intact for user retry.
      if (dispatchSucceeded) {
        tryDispatchSession(sessionId)
      }
    })
}

/**
 * Module-level Zustand subscription that dispatches queued messages for
 * ANY session that becomes ready, **independent of which issue/session
 * the user is currently viewing**.
 *
 * ## Why this exists
 *
 * Queue auto-dispatch is a domain concern (message delivery guarantee),
 * not a UI concern (what the user is looking at).  By placing the single
 * dispatch mechanism at the module level — decoupled from React component
 * lifecycle — we guarantee delivery regardless of navigation state:
 *
 *   • User viewing the session → dispatch fires, UI auto-updates via
 *     useSyncExternalStore (reads _store/_dispatchPhase reactively)
 *   • User on a different issue → dispatch fires, UI updates when they
 *     navigate back (useSyncExternalStore reads current _store)
 *   • Page refresh with persisted queue → populateAllFromStorage() pre-loads
 *     _store, dispatch fires when managedSessions arrive via DataBus
 *
 * ## Timing guarantee
 *
 * Zustand `subscribe` fires **synchronously** during `setState`.  This
 * means the dispatcher runs inside the DataBus event handler — before
 * React re-renders — giving it first shot at any pending queues.
 *
 * ## React state sync
 *
 * All UI state is derived reactively from `_store` / `_dispatchPhase` via
 * `useSyncExternalStore`.  The dispatch layer just mutates these data
 * structures and calls `notifyStoreChange()` — no observer pattern,
 * no manual React state sync.
 */
;(function initGlobalQueueDispatcher(): void {
  // Pre-populate from localStorage so page-refresh queues are
  // available before the first managedSessions update arrives.
  populateAllFromStorage()

  useCommandStore.subscribe((state, prevState) => {
    // React when EITHER session list OR session index changes.
    //
    // Why both:
    // - managedSessions ref changes on structural updates (create/delete/new id)
    // - sessionById ref can change alone on metadata/state updates via
    //   commandStore.batchUpsertManagedSessions fast path
    //
    // Queue dispatch readiness depends on session.state, which lives on the
    // SessionSnapshot in sessionById. If we only watch managedSessions refs,
    // "sessionById-only" updates (streaming -> idle) won't trigger dispatch.
    if (
      state.managedSessions === prevState.managedSessions
      && state.sessionById === prevState.sessionById
    ) return

    // Fast path: no pending queues — nothing to do.
    // This keeps the subscription essentially free during normal streaming
    // (which triggers frequent managedSessions updates for token counts,
    // new messages, activity changes, etc.).
    if (_store.size === 0) return

    // Try dispatching for all sessions with pending queues.
    // Guards inside tryDispatchSession handle: in-flight lock, session
    // readiness, empty queue.
    for (const [sessionId] of _store.entries()) {
      tryDispatchSession(sessionId)
    }
  })
})()

/* ------------------------------------------------------------------ */
/*  UI Layer — React hook                                              */
/* ------------------------------------------------------------------ */

export function useMessageQueue(options: UseMessageQueueOptions): UseMessageQueueReturn {
  const { sessionId } = options

  // ── Reactive state derived from _store / _dispatchPhase ──────────────────
  //
  // useSyncExternalStore guarantees:
  //   - Consistency: any _store/_dispatchPhase mutation + notifyStoreChange()
  //     automatically reflects in React — no manual observer sync needed.
  //   - No tearing: safe under React concurrent mode.
  //   - Efficient: re-renders only when the snapshot value actually changes
  //     (referential equality for arrays, value equality for primitives).
  //
  // On first render, resolveQueue populates _store from localStorage if
  // needed, ensuring the snapshot returns hydrated data immediately.

  const getQueue = useCallback((): QueuedMessage[] => {
    resolveQueue(sessionId) // ensures _store is populated (no-op if already there)
    return _store.get(sessionId)?.messages ?? EMPTY_QUEUE
  }, [sessionId])

  const getDispatchMode = useCallback(
    (): QueueDispatchMode => _store.get(sessionId)?.dispatchMode ?? 'batch',
    [sessionId],
  )

  const getDispatchPhase = useCallback(
    (): DispatchPhase => _dispatchPhase.get(sessionId) ?? 'idle',
    [sessionId],
  )

  const queue = useSyncExternalStore(subscribeStore, getQueue)
  const dispatchMode = useSyncExternalStore(subscribeStore, getDispatchMode)
  const phase = useSyncExternalStore(subscribeStore, getDispatchPhase)

  // ── Stable ref for async callback access ────────────────────────────
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  // ── Wrapped setter — mutates _store + persists + notifies ───────────
  //
  // All queue operations go through this.  The flow:
  //   1. Mutate _store (single source of truth)
  //   2. Persist to localStorage
  //   3. notifyStoreChange() → useSyncExternalStore re-evaluates → re-render
  //
  // No rawSetQueue, no React setState — React reads _store directly.

  const setQueue = useCallback(
    (update: QueuedMessage[] | ((prev: QueuedMessage[]) => QueuedMessage[])) => {
      const sid = sessionIdRef.current
      if (!sid) return

      const current = _store.get(sid)
      const prev = current?.messages ?? EMPTY_QUEUE
      const next = typeof update === 'function' ? update(prev) : update

      if (next.length > 0) {
        if (current) {
          current.messages = next
        } else {
          _store.set(sid, { messages: next, dispatchMode: 'batch' })
        }
        persistToStorage(sid, _store.get(sid)!)
      } else {
        // Keep _store entry alive (preserves dispatchMode preference)
        // so the next enqueue inherits the user's chosen mode.
        if (current) {
          current.messages = EMPTY_QUEUE
        }
        clearStorage(sid)
      }

      notifyStoreChange()
    },
    [],
  )

  /* -- Queue operations -- */

  const enqueue = useCallback(
    (content: UserMessageContent) => {
      const msg: QueuedMessage = {
        id: crypto.randomUUID(),
        content,
        queuedAt: Date.now(),
      }
      setQueue((prev) => [...prev, msg])
      // Best-effort immediate dispatch attempt for the common case where the
      // session is already ready when enqueue happens. Guards in
      // tryDispatchSession prevent overlap and non-ready dispatch.
      tryDispatchSession(sessionIdRef.current)
    },
    [setQueue],
  )

  const dequeue = useCallback(
    (id: string) => {
      setQueue((prev) => prev.filter((m) => m.id !== id))
    },
    [setQueue],
  )

  const updateQueued = useCallback(
    (id: string, content: UserMessageContent) => {
      setQueue((prev) => prev.map((m) => (m.id === id ? { ...m, content } : m)))
    },
    [setQueue],
  )

  const reorder = useCallback(
    (activeId: string, overId: string) => {
      setQueue((prev) => {
        const oldIndex = prev.findIndex((m) => m.id === activeId)
        const newIndex = prev.findIndex((m) => m.id === overId)
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return prev
        return arrayMove(prev, oldIndex, newIndex)
      })
    },
    [setQueue],
  )

  const clearQueue = useCallback(() => {
    setQueue(EMPTY_QUEUE)
  }, [setQueue])

  /* -- Dispatch mode -- */

  const setMode = useCallback((mode: QueueDispatchMode) => {
    const sid = sessionIdRef.current
    const state = _store.get(sid)
    if (state) {
      state.dispatchMode = mode
      persistToStorage(sid, state)
    }
    notifyStoreChange()
    // Trigger dispatch re-evaluation with new mode.
    // Handles: user toggles mode while session is ready + queue non-empty
    // (e.g. switching from sequential to batch between pipeline steps).
    tryDispatchSession(sid)
  }, [])

  /**
   * Memoized dispatch context — only re-creates the object when
   * dispatchMode or phase actually change, preventing unnecessary
   * re-renders of QueuedMessageList's DnD subtree.
   */
  const dispatchContext: QueueDispatchContext = useMemo(() => ({
    mode: dispatchMode,
    phase,
    onModeChange: setMode,
  }), [dispatchMode, phase, setMode])

  // Memoize the entire return object so that consumers referencing it in
  // useCallback / useMemo dependency arrays (e.g. SessionPanel's
  // handleSendOrQueue) don't needlessly invalidate.  All inner values
  // are already stable (useCallback / useMemo), so the outer object
  // only changes when `queue` or `dispatchContext` actually change.
  return useMemo<UseMessageQueueReturn>(() => ({
    queue,
    enqueue,
    dequeue,
    updateQueued,
    reorder,
    clearQueue,
    dispatch: dispatchContext,
  }), [queue, enqueue, dequeue, updateQueued, reorder, clearQueue, dispatchContext])
}
