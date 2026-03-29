// SPDX-License-Identifier: Apache-2.0

/**
 * useAutoFollow — Centralized auto-scroll state machine for Virtuoso.
 *
 * Two-state machine with **symmetric** transitions:
 *
 *   ┌───────────┐   atBottom=false        ┌───────────┐
 *   │ following  │ ────────────────────▶   │ browsing  │
 *   │           │   (cooldown expired)     │           │
 *   │ auto-scroll│ ◀────────────────────   │ no scroll │
 *   │ on growth  │   atBottom=true         │           │
 *   │           │   OR engage() called     │           │
 *   └───────────┘                          └───────────┘
 *
 * ## States
 *
 * - **following** — Auto-scroll when content grows (streaming, footer, etc.).
 * - **browsing**  — User deliberately scrolled up; suppress all auto-scroll.
 *
 * ## Transitions
 *
 * - following → browsing:
 *     1. Virtuoso reports atBottom=false AND the engage cooldown has expired.
 *        The cooldown prevents smooth scroll *animations* (which transiently
 *        report atBottom=false mid-flight) from falsely disengaging.
 *     2. Explicit `disengage()` call — triggered by programmatic scroll
 *        actions (scroll-to-top, anchor navigation) that bypass wheel/touchmove
 *        detection.  Without this, the state machine stays in 'following' and
 *        corrective scrolls fight the programmatic scroll back to bottom.
 *
 * - browsing → following:
 *     1. Virtuoso reports atBottom=true — handles both:
 *        - Auto-scroll completed (self-corrects from transient browsing)
 *        - User manually scrolled back to bottom (natural re-engagement)
 *     2. Explicit `engage()` call — triggered by:
 *        - Component mount (instant scroll to bottom)
 *        - New user message sent (smooth scroll to bottom)
 *        - Scroll-to-bottom button clicked (smooth scroll to bottom)
 *
 * ## Why atBottom=true re-engages following
 *
 * Without this, a `followOutput`-initiated scroll or `engage()`-initiated
 * smooth animation can cause a transient atBottom=false that transitions to browsing after
 * the cooldown expires.  Since `browsing → following` previously required
 * an explicit `engage()` call, the system would permanently lose auto-follow
 * during streaming — a one-way degradation with no self-recovery path.
 *
 * The symmetric design ensures the state machine is self-correcting:
 * any programmatic scroll that reaches the bottom automatically restores
 * following mode, while genuine user scroll-away properly disengages.
 *
 * ## Dual-dimension gating (isContentActive × userScrolled)
 *
 * `handleTotalHeightChanged` uses two orthogonal signals to decide whether
 * to issue a corrective scroll:
 *
 * | isContentActive | userScrolled | Action                | Scenario              |
 * |-----------------|--------------|---------------------- |-----------------------|
 * | true            | any          | ✅ allow correction   | streaming follow      |
 * | false           | false        | ✅ allow correction   | mount settling        |
 * | false           | true         | ❌ block              | user browsing static  |
 *
 * This is critical because Virtuoso's `totalListHeightChanged` fires on
 * ANY height change — including virtualisation measurement adjustments when
 * items enter/exit the viewport during scrolling.
 *
 * The previous single-dimension gate (`!isContentActive → block all`) had a
 * blind spot: mount-time height settling (complex cards finishing their first
 * measurement after the initial scrollTo) was also blocked, preventing the
 * list from reaching the true bottom on session switch.
 *
 * `userScrolled` is detected via DOM events (`wheel`/`touchmove`) on the
 * scroller element — the only events that are definitively user-initiated
 * and never fired by programmatic scrolling.
 *
 * ## Height-change tracking (totalListHeightChanged)
 *
 * Virtuoso's `followOutput` only fires when `data.length` changes (new items
 * added).  It does NOT fire when an existing item changes height — which
 * happens constantly during streaming text, card expand/collapse, image load,
 * Mermaid render, View Changes buttons appearing, footer resize, etc.
 *
 * Instead of enumerating each height-change source with individual effects
 * (whack-a-mole), we use Virtuoso's `totalListHeightChanged` callback which
 * fires on ANY height change.  A single `handleTotalHeightChanged` callback
 * issues a coalesced corrective scroll when in `following` state AND the
 * dual-dimension gate allows it (see table above).
 *
 * ## Scroll timing
 *
 * - `engage()` uses **double-rAF** timing + caller-specified behavior
 *   (typically 'smooth' for user actions, 'instant' for mount):
 *     Frame 1 — Virtuoso renders new items; ResizeObserver fires.
 *     Frame 2 — Measurements complete; scrollHeight is accurate.
 *
 * - `handleTotalHeightChanged` uses **single-rAF** coalescing + always
 *   **'instant'** behavior:
 *     Virtuoso has already measured the new height when it fires the callback,
 *     so we only need one rAF to batch multiple rapid changes per frame.
 *     Always uses 'instant' to avoid smooth-scroll animation restart jitter
 *     during streaming (each smooth scrollTo cancels the in-progress animation,
 *     producing visible decelerate→stop→re-accelerate stutter).
 *     Suppressed for 50 ms after `engage()` to avoid cancelling the engage
 *     scroll's smooth animation mid-flight.
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Cooldown (ms) after engage() during which atBottom=false is treated as
 * a transient scroll-animation artifact rather than a user scroll gesture.
 *
 * Only applies when content is actively growing (streaming).  For static
 * content, user-scroll detection via `userScrolledRef` provides a direct
 * signal, making the time-based cooldown unnecessary.
 *
 * `engage()` defaults to 'smooth' behavior for user-initiated actions
 * (scroll-to-bottom button, new message from browsing state).  Smooth
 * animations typically complete in 300–400 ms.  500 ms gives a comfortable
 * buffer without noticeably delaying user scroll detection.
 *
 * NOTE: `followOutput` returns 'auto' (instant) and does NOT need this
 * cooldown — it is only relevant for `engage()`-initiated smooth scrolls.
 */
const ENGAGE_COOLDOWN_MS = 500

/**
 * Suppression window (ms) after engage() during which
 * `handleTotalHeightChanged` is skipped.
 *
 * `engage()` uses double-rAF (~32 ms) to issue a smooth scroll.
 * If `handleTotalHeightChanged` fires its instant scroll during this
 * window, it cancels the smooth animation mid-flight.  50 ms covers
 * the double-rAF with a small buffer.
 */
const ENGAGE_FLIGHT_MS = 50

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FollowState = 'following' | 'browsing'

export interface UseAutoFollowReturn {
  /** Pass to Virtuoso's `followOutput` prop. */
  handleFollowOutput: (isAtBottom: boolean) => 'auto' | false
  /** Pass to Virtuoso's `atBottomStateChange` prop. */
  handleAtBottomChange: (atBottom: boolean) => void
  /**
   * Pass to Virtuoso's `totalListHeightChanged` prop.
   *
   * Generic corrective scroll — fires on ANY height change (streaming text,
   * card expand/collapse, image load, Mermaid render, View Changes buttons,
   * footer appearance, etc.).
   *
   * Only scrolls when in `following` state.  Uses coalesced rAF to avoid
   * multiple scroll commands per frame during rapid height changes.
   */
  handleTotalHeightChanged: (_height: number) => void
  /** Whether to show a "scroll to bottom" affordance. */
  showScrollToBottom: boolean
  /**
   * Scroll to absolute bottom and (re-)engage follow mode.
   *
   * Use for: component mount, new user message, scroll-to-bottom button.
   */
  engage: (behavior?: ScrollBehavior) => void
  /**
   * Disengage follow mode — switch to 'browsing' so auto-scroll stops.
   *
   * Use for: programmatic scroll-to-top (which bypasses wheel/touchmove
   * detection).  Without this, the state machine stays in 'following' and
   * `handleTotalHeightChanged` / `handleFollowOutput` immediately fight
   * the scroll back to bottom.
   */
  disengage: () => void
  /**
   * Re-engage follow mode only if currently browsing.
   *
   * When already in 'following' state, this is a no-op — Virtuoso's
   * `followOutput` has already initiated an instant scroll for this data
   * change.  Issuing a second scroll (via `engage`) would compete and
   * needlessly suppress `handleTotalHeightChanged` corrective scrolls
   * during the `ENGAGE_FLIGHT_MS` window.
   *
   * Use for: new-message-arrived events where `followOutput` also fires
   * in the same render cycle.  For user-initiated scroll-to-bottom (button
   * click), use `engage()` which always fires regardless of state.
   */
  reengageIfBrowsing: (behavior?: ScrollBehavior) => void
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface UseAutoFollowOptions {
  /**
   * Whether content is actively growing (streaming / creating).
   *
   * When true, `handleTotalHeightChanged` corrective scrolls are always
   * enabled — regardless of user scroll state.  When false, corrective
   * scrolls are only enabled if the user hasn't physically scrolled yet
   * (mount-settling window).
   *
   * Defaults to false (safe: no forced scrolling during user browse).
   */
  isContentActive?: boolean
  /**
   * Scroller DOM element — used to listen for `wheel`/`touchmove` events
   * to detect user scroll intent.
   *
   * When null/undefined, user-scroll detection is disabled and the gate
   * degrades to `isContentActive`-only (v1 behaviour).
   */
  scrollerEl?: HTMLElement | null
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Centralized auto-scroll state machine for Virtuoso lists.
 *
 * @param virtuosoRef — Ref to the Virtuoso instance for imperative scroll control.
 * @param options     — Structured options controlling scroll behaviour.
 */
export function useAutoFollow(
  virtuosoRef: React.RefObject<VirtuosoHandle | null>,
  options: UseAutoFollowOptions = {},
): UseAutoFollowReturn {
  const { isContentActive = false, scrollerEl = null } = options

  const stateRef = useRef<FollowState>('following')
  const engageTimestampRef = useRef(0)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  // ── Render-time ref sync ───────────────────────────────────────────────
  // Standard React pattern: render-time assignment keeps the ref current
  // without useEffect (zero-frame delay), and the stable ref identity
  // means callback dependency arrays are unaffected.
  const contentActiveRef = useRef(isContentActive)
  contentActiveRef.current = isContentActive

  // ── User scroll intent detection ───────────────────────────────────────
  // Tracks whether the user has physically interacted with the scroller
  // since the last engage/atBottom reset.  Only DOM events that are
  // definitively user-initiated (wheel, touchmove) set this flag —
  // programmatic scrollTo calls never fire these events.
  const userScrolledRef = useRef(false)

  useEffect(() => {
    if (!scrollerEl) return
    const onUserScroll = () => { userScrolledRef.current = true }
    scrollerEl.addEventListener('wheel', onUserScroll, { passive: true })
    scrollerEl.addEventListener('touchmove', onUserScroll, { passive: true })
    return () => {
      scrollerEl.removeEventListener('wheel', onUserScroll)
      scrollerEl.removeEventListener('touchmove', onUserScroll)
    }
  }, [scrollerEl])

  // ── Internal: unified scroll-to-bottom with double-rAF timing ──────────

  const scrollToAbsoluteBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior })
        })
      })
    },
    [virtuosoRef],
  )

  // ── Virtuoso callbacks ─────────────────────────────────────────────────

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    setShowScrollToBottom(!atBottom)
    if (atBottom) {
      // Reached bottom — re-engage follow mode.  This handles:
      // 1. Auto-scroll animation completed (recovers from transient browsing)
      // 2. User manually scrolled back to bottom (natural re-engagement)
      stateRef.current = 'following'
      userScrolledRef.current = false   // Scroll intent resolved — reset
      return
    }
    // Not at bottom — decide whether to disengage.
    //
    // If the user hasn't physically scrolled, this not-at-bottom state was
    // caused by a programmatic scroll (animation mid-flight, height change
    // shifting the viewport, etc.).  Stay in following.
    if (!userScrolledRef.current) return
    // For streaming content, apply cooldown to protect against smooth scroll
    // animations transiently reporting atBottom=false mid-flight.
    if (contentActiveRef.current) {
      const elapsed = Date.now() - engageTimestampRef.current
      if (elapsed < ENGAGE_COOLDOWN_MS) return
    }
    // User has physically scrolled away — disengage follow.
    stateRef.current = 'browsing'
  }, [])

  const handleFollowOutput = useCallback(
    (_isAtBottom: boolean): 'auto' | false => {
      // In 'following' state, return 'auto' so Virtuoso instantly scrolls
      // to the estimated bottom when new data arrives.
      //
      // Why 'auto' (instant) instead of 'smooth':
      //   `handleTotalHeightChanged` fires an instant corrective scroll
      //   within the same frame (after item measurement).  If `followOutput`
      //   returned 'smooth', Virtuoso would start a smooth animation that
      //   gets cancelled ~16 ms later by the instant correction — producing
      //   a visible "smooth start → instant snap" micro-jitter.  Returning
      //   'auto' matches the actual behavior: both scrolls are instant,
      //   so the correction is seamless (no animation to cancel).
      //
      // Smooth scroll is reserved for explicit user actions via `engage()`
      // (scroll-to-bottom button, new user message from browsing state),
      // where `ENGAGE_FLIGHT_MS` suppresses `handleTotalHeightChanged`
      // to protect the animation.
      return stateRef.current === 'following' ? 'auto' : false
    },
    [],
  )

  // ── Generic height-change corrective scroll ──────────────────────────
  //
  // Virtuoso's `totalListHeightChanged` fires on ANY height change in the
  // rendered list — streaming text growth, card expand/collapse, image load,
  // Mermaid render, View Changes buttons appearing, footer resize, etc.
  //
  // This single callback provides one generic mechanism for all height-change
  // sources, instead of enumerating each with individual effects (whack-a-mole).
  //
  // ## Behaviour: always `instant`
  //
  // During streaming, content height changes every ~50-100 ms.  Using
  // `smooth` causes each `scrollTo(smooth)` to cancel the in-progress
  // smooth animation and restart from the current intermediate position,
  // producing visible "decelerate → stop → re-accelerate" jitter.
  //
  // `instant` eliminates this entirely — the viewport stays pinned to the
  // bottom with zero animation.  All major chat UIs (ChatGPT, Claude Web)
  // use the same approach for streaming scroll tracking.
  //
  // Smooth scroll is reserved for discrete user actions (`engage()`) such
  // as clicking the scroll-to-bottom button or sending a new message.
  //
  // ## Engage suppression
  //
  // `engage()` uses double-rAF (~32 ms) to issue a smooth scroll.  During
  // this flight window, this callback must NOT fire — otherwise its instant
  // scrollTo cancels the smooth animation mid-flight, causing a visible
  // "smooth → instant → smooth" jump.  A 50 ms suppression window (covers
  // double-rAF + buffer) prevents the overlap.
  //
  // ## Dual-dimension gate (isContentActive × userScrolled)
  //
  // See the table in the block comment at the top of this file.
  //
  // - isContentActive=true  → always allow (streaming follow)
  // - userScrolled=false    → allow (mount settling — cards measuring)
  // - both false/true combo → block (user browsing static content)
  //
  // Uses a coalesced rAF flag to batch multiple rapid height changes into
  // a single scroll command per frame, preventing scroll thrash.

  const repinScheduledRef = useRef(false)

  // ── Height-delta gating ──────────────────────────────────────────
  // During streaming, Virtuoso fires totalListHeightChanged on every
  // sub-pixel text reflow.  Most height changes are <10px (a few tokens).
  // Each scrollTo(instant) forces layout recalculation.  Gating on a
  // 24px threshold (~1.5 lines) reduces scroll commands by ~40-60%
  // during streaming while remaining visually imperceptible.
  const lastScrolledHeightRef = useRef(0)
  // Latest height reported by Virtuoso — stored in a ref so the rAF
  // callback always reads the most recent value, not a stale closure
  // capture from the call that scheduled the rAF.
  const latestHeightRef = useRef(0)

  const handleTotalHeightChanged = useCallback(
    (height: number) => {
      // Always record the latest height — even if this call is gated out,
      // the rAF callback (if already scheduled) should use the freshest value.
      latestHeightRef.current = height

      // Suppress during engage flight — let the engage scroll complete
      // without competition from this callback.
      if (Date.now() - engageTimestampRef.current < ENGAGE_FLIGHT_MS) return

      // Dual-dimension gate: block corrective scrolls for static content
      // when the user has physically scrolled.  Allow during mount settling
      // (userScrolled=false) or streaming (contentActive=true).
      if (!contentActiveRef.current && userScrolledRef.current) return

      if (stateRef.current !== 'following') return

      // Height-delta gate: skip scroll if height hasn't changed enough
      // to matter.  Deferred scrolls accumulate and fire on the next
      // frame that crosses the threshold.
      if (Math.abs(height - lastScrolledHeightRef.current) < 24) return

      if (repinScheduledRef.current) return
      repinScheduledRef.current = true
      requestAnimationFrame(() => {
        repinScheduledRef.current = false
        if (stateRef.current !== 'following') return
        if (!contentActiveRef.current && userScrolledRef.current) return
        // Read the latest height from ref — NOT the closure-captured `height`.
        // Multiple handleTotalHeightChanged calls may have fired since the
        // rAF was scheduled; we want the most recent measurement.
        lastScrolledHeightRef.current = latestHeightRef.current
        virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: 'instant' })
      })
    },
    [virtuosoRef],
  )

  // ── Actions ────────────────────────────────────────────────────────────

  const engage = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      stateRef.current = 'following'
      engageTimestampRef.current = Date.now()
      userScrolledRef.current = false   // Reset: programmatic scroll → clear intent
      lastScrolledHeightRef.current = 0 // Reset: ensure re-engagement always scrolls
      setShowScrollToBottom(false)
      scrollToAbsoluteBottom(behavior)
    },
    [scrollToAbsoluteBottom],
  )

  const disengage = useCallback(() => {
    stateRef.current = 'browsing'
    userScrolledRef.current = true      // Prevent handleTotalHeightChanged from re-engaging
    setShowScrollToBottom(true)
  }, [])

  // Re-engage only when browsing — prevents competing scrolls.
  //
  // When already in 'following' state, Virtuoso's `followOutput` has already
  // returned 'auto' for this data change.  Our `engage()` would issue a
  // SECOND scroll via `scrollToAbsoluteBottom` (double-rAF), which:
  //   1. Competes with Virtuoso's instant scroll (redundant work)
  //   2. Sets `engageTimestampRef` → suppresses `handleTotalHeightChanged`
  //      corrective scrolls during the 50 ms flight window
  // This is wasteful and briefly blocks corrective scrolls.
  //
  // Skipping the scroll when already following lets `followOutput` and
  // `handleTotalHeightChanged` cooperate without interference:
  //   - `followOutput` provides the initial instant scroll
  //   - `handleTotalHeightChanged` provides instant correction after measurement
  //   - No `ENGAGE_FLIGHT_MS` suppression → corrections fire freely
  const reengageIfBrowsing = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      if (stateRef.current === 'following') return
      engage(behavior)
    },
    [engage],
  )

  return {
    handleFollowOutput,
    handleAtBottomChange,
    handleTotalHeightChanged,
    showScrollToBottom,
    engage,
    disengage,
    reengageIfBrowsing,
  }
}
