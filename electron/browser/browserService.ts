// SPDX-License-Identifier: Apache-2.0

import { WebContentsView, session } from 'electron'
import type { BrowserWindow } from 'electron'
import type {
  DataBusEvent,
  BrowserShowContext,
  BrowserSource,
  BrowserStatePolicy,
  BrowserSourceResolutionRequest,
} from '@shared/types'
import type {
  BrowserProfile,
  BrowserCommand,
  BrowserCommandResult,
  BrowserExecutionContext,
  BrowserError,
  CreateProfileInput,
  ViewBounds,
  PageInfo,
} from './types'
import { BrowserStore } from './browserStore'
import { BrowserActionExecutor } from './browserActionExecutor'
import { BrowserActionDecorator } from './browserActionDecorator'
import { CookiePersistenceInterceptor, type CookiePersistenceConfig } from './cookiePersistenceInterceptor'
import { createLogger } from '../platform/logger'
import {
  defaultBrowserStatePolicyForSource,
  normalizeBrowserStatePolicy,
} from '../../src/shared/browserStatePolicy'

const log = createLogger('BrowserService')

/** Default TTL for persisted cookies: 30 days */
const DEFAULT_COOKIE_TTL = 86400 * 30

// ─── Managed View (internal aggregate) ──────────────────────────────────

interface ManagedView {
  id: string
  profileId: string
  /** Cached profile name — avoids async store lookup inside synchronous setDisplayedView. */
  profileName: string
  view: WebContentsView
  session: Electron.Session
  executor: BrowserActionExecutor
  decorator: BrowserActionDecorator
  interceptor: CookiePersistenceInterceptor
  /** Saved bounds before the view was hidden by the overlay guard. */
  savedBounds?: Electron.Rectangle
  /** Last resolved source binding that displayed this view. */
  sourceBinding?: BrowserStateBinding
}

interface BrowserStateBinding {
  policy: BrowserStatePolicy
  profileId: string
  reason: string
  sourceType: BrowserSource['type']
  projectId: string | null
  issueId: string | null
  sessionId: string | null
}

// ─── Dependencies ───────────────────────────────────────────────────────

export interface BrowserServiceDeps {
  dispatch: (event: DataBusEvent) => void
  store: BrowserStore
}

/**
 * BrowserService — core browser subsystem orchestrator.
 *
 * Responsibilities:
 * - Profile CRUD (delegates to BrowserStore)
 * - WebContentsView lifecycle (create, attach to window, destroy)
 * - **Per-session view isolation** — each session that uses browser tools gets
 *   its own WebContentsView, preventing cross-session navigation interference.
 *   The mapping is maintained in `sessionViews`.
 * - **Displayed view** — the view currently shown in the browser window (`_displayedViewId`).
 *   This is orthogonal to session views: the window shows one session's view at a time,
 *   but each session's view persists independently.
 * - Bounds synchronisation (receives bounds from renderer, applies to native view)
 * - Command execution routing (delegates to BrowserActionExecutor)
 * - Domain allowlist enforcement
 * - DataBus event broadcasting
 */
/** Maximum thumbnail width (px). Height is derived from aspect ratio. */
const THUMBNAIL_MAX_WIDTH = 240
/** JPEG quality for thumbnail data URLs (0-100). */
const THUMBNAIL_JPEG_QUALITY = 70
/** Debounce delay (ms) before capturing a thumbnail after navigation/load. */
const THUMBNAIL_DEBOUNCE_MS = 500
/** Timeout for profile-rebind URL priming before transaction abort. */
const REBIND_NAVIGATION_TIMEOUT_MS = 8_000

export class BrowserService {
  private readonly managedViews = new Map<string, ManagedView>()
  private readonly store: BrowserStore
  private readonly dispatch: (event: DataBusEvent) => void
  /** Per-view debounce timers for thumbnail capture. */
  private readonly thumbnailTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * Session → View mapping (per-session isolation).
   *
   * Key insight: a session's view must be independent from the view currently
   * displayed in the browser window. Two sessions can have views open; only
   * one is displayed at a time. This prevents cross-session interference when
   * multiple sessions with browser capability run concurrently.
   */
  private readonly sessionViews = new Map<string, string>()  // sessionId → viewId

  /**
   * Issue → View mapping (per-issue standalone browsing).
   *
   * Parallel to `sessionViews` but for Issue-scoped views created when the
   * user clicks "Open Browser" on an Issue that has no active session.
   *
   * Lifecycle:
   * - Created eagerly on `getOrCreateIssueView` (user-initiated, always displayed).
   * - Persists across the app lifetime so the user's browsing state is preserved
   *   when they switch between Issues and come back.
   * - Released on `releaseIssueView` (call when the Issue is deleted).
   */
  private readonly issueViews = new Map<string, string>()  // issueId → viewId

  /**
   * The view currently displayed in the browser window.
   *
   * Separate from `sessionViews` — the displayed view changes when the user
   * switches which session's browser is shown, but session views remain alive
   * independently. The renderer tracks this via `browser:view:opened` events.
   */
  private _displayedViewId: string | null = null

  /**
   * The session whose view should be auto-displayed when it creates a view.
   *
   * Set by `setFocusedSession()` when the browser window is opened in
   * session-linked mode (Path A: `browser:show` with `linkedSessionId`).
   *
   * When `doCreateSessionView` creates a new view for a session, it checks
   * against this field and `_focusedIssueId` to decide whether to display:
   *
   *   _focusedSessionId == sessionId → display (user's explicit intent)
   *   both null                      → display (pure autonomous mode, first-view-wins)
   *   _focusedIssueId set, this null → do NOT display (issue-standalone mode guard)
   */
  private _focusedSessionId: string | null = null

  /**
   * The Issue whose standalone browser view owns the display slot.
   *
   * Set by `setFocusedIssue()` when the browser window is opened in
   * issue-standalone mode (Path B: `browser:show` with `sourceIssueId` only).
   *
   * **Critical guard:** while this is non-null, agent-created session views
   * must NOT auto-steal the display. Without this guard, any session that
   * coincidentally uses a browser tool after the user opens an Issue browser
   * would silently override the user's chosen Issue view.
   *
   * Cleared (→ null) when Path A (session-linked) or Path C (standalone) is taken.
   */
  private _focusedIssueId: string | null = null

  constructor(deps: BrowserServiceDeps) {
    this.store = deps.store
    this.dispatch = deps.dispatch
  }

  /**
   * Resolve a stable profile binding for the incoming browser source request.
   *
   * Policy precedence:
   * 1) custom-profile when preferredProfileId/profileId is provided
   * 2) explicit request.policy
   * 3) source-based default (issue-session/issue-standalone/chat-session -> shared-project; standalone -> shared-global)
   */
  async resolveStateBinding(request: BrowserSourceResolutionRequest): Promise<BrowserStateBinding> {
    const preferredProfileId = request.preferredProfileId ?? request.profileId
    const sourceIdentity = this.resolveSourceIdentity(request)
    if (preferredProfileId) {
      const profileId = await this.resolveProfileId(preferredProfileId)
      return {
        policy: 'custom-profile',
        profileId,
        reason: `custom-profile:preferred:${preferredProfileId}`,
        sourceType: request.source.type,
        projectId: sourceIdentity.projectId,
        issueId: sourceIdentity.issueId,
        sessionId: sourceIdentity.sessionId,
      }
    }

    const policy = this.resolvePolicyForRequest(request, sourceIdentity)
    if (policy === 'custom-profile') {
      const fallbackPolicy = this.defaultPolicyForSource(request.source)
      const fallbackScopeKey = this.buildScopeKey(fallbackPolicy, request, sourceIdentity)
      const fallbackName = `State:${fallbackScopeKey}`
      const fallbackProfileId = await this.findOrCreateProfileByName(fallbackName)
      return {
        policy: fallbackPolicy,
        profileId: fallbackProfileId,
        reason: `policy:custom-profile-missing-preferred:fallback:${fallbackPolicy}:${fallbackScopeKey}`,
        sourceType: request.source.type,
        projectId: sourceIdentity.projectId,
        issueId: sourceIdentity.issueId,
        sessionId: sourceIdentity.sessionId,
      }
    }
    const scopeKey = this.buildScopeKey(policy, request, sourceIdentity)
    const profileName = `State:${scopeKey}`
    const profileId = await this.findOrCreateProfileByName(profileName)

    return {
      policy,
      profileId,
      reason: `policy:${policy}:${scopeKey}`,
      sourceType: request.source.type,
      projectId: sourceIdentity.projectId,
      issueId: sourceIdentity.issueId,
      sessionId: sourceIdentity.sessionId,
    }
  }

  // ── Displayed View (browser window viewport) ─────────────────────

  /**
   * Get the currently displayed view ID, with automatic staleness detection.
   *
   * If the stored view has been destroyed (e.g. webContents crashed,
   * window closed externally), this getter self-heals by returning null.
   */
  get activeViewId(): string | null {
    if (this._displayedViewId) {
      const managed = this.managedViews.get(this._displayedViewId)
      if (!managed || managed.view.webContents.isDestroyed()) {
        log.warn(`Displayed view "${this._displayedViewId}" is stale — clearing`)
        this._displayedViewId = null
      }
    }
    return this._displayedViewId
  }

  // ── Focus & Display ───────────────────────────────────────────────

  /**
   * Set which session's view should auto-display when it creates a browser view.
   *
   * Called by the `browser:show` IPC handler when the browser window is opened
   * with a `linkedSessionId` context. Passing `null` clears focus (standalone mode).
   *
   * This is the public entry point; the actual display dispatch happens inside
   * the private `setDisplayedView()`.
   */
  setFocusedSession(sessionId: string | null): void {
    this._focusedSessionId = sessionId
    this._focusedIssueId = null  // mutually exclusive with issue-standalone mode
    log.debug(`setFocusedSession: ${sessionId ?? 'none'}`)
  }

  /**
   * Enter issue-standalone mode: the given Issue owns the display slot.
   *
   * Called by the `browser:show` IPC handler (Path B) when the browser is
   * opened for an Issue that has no active session. While this is set, agent
   * tools running in any session will NOT auto-steal the display — they create
   * their view silently and wait until the user switches context.
   *
   * Pass `null` to leave issue-standalone mode (Path A/C taken instead).
   */
  setFocusedIssue(issueId: string | null): void {
    this._focusedIssueId = issueId
    this._focusedSessionId = null  // mutually exclusive with session-linked mode
    log.debug(`setFocusedIssue: ${issueId ?? 'none'}`)
  }

  /**
   * Return the current focus context so the renderer can catch up on mount.
   *
   * When the browser window is first created, the `browser:context` DataBus
   * event fires before React's `useEffect` registers the IPC listener —
   * the event is silently lost. This query lets `useBrowserDataBus` perform
   * the same initialisation as the `browser:context` handler on mount.
   */
  getFocusedContext(): BrowserShowContext | null {
    if (this._focusedSessionId) {
      return { linkedSessionId: this._focusedSessionId }
    }
    if (this._focusedIssueId) {
      return { sourceIssueId: this._focusedIssueId }
    }
    return null
  }

  /**
   * Make a session's existing view the displayed one in the browser window.
   *
   * **Sync, no side-effects beyond dispatching `browser:view:opened`.**
   * Does NOT create a view — view creation is handled lazily by `getOrCreateSessionView`.
   * If the session has no view yet, this is a no-op: the view will be auto-displayed
   * when it is created (if the session is still focused via `_focusedSessionId`).
   *
   * Called by the `browser:show` IPC handler when the linked session may already
   * have an active view from a previous tool invocation.
   */
  displaySessionView(sessionId: string): void {
    const viewId = this.getSessionView(sessionId)
    if (!viewId) {
      log.debug(`displaySessionView(${sessionId}): no view yet — will auto-display when created`)
      return
    }
    const managed = this.managedViews.get(viewId)
    if (managed && !managed.sourceBinding) {
      managed.sourceBinding = {
        policy: 'isolated-session',
        profileId: managed.profileId,
        reason: 'legacy:display-session',
        sourceType: 'chat-session',
        projectId: null,
        issueId: null,
        sessionId,
      }
    }
    this.setDisplayedView(viewId)
  }

  // ── Per-Issue View Management ─────────────────────────────────────

  /**
   * Get the view assigned to an Issue, or null if none exists.
   *
   * Used when the user opens the browser from an Issue that has no active
   * Claude session. Performs the same staleness check as `getSessionView`.
   */
  getIssueView(issueId: string): string | null {
    const viewId = this.issueViews.get(issueId)
    if (!viewId) return null

    const managed = this.managedViews.get(viewId)
    if (!managed || managed.view.webContents.isDestroyed()) {
      log.warn(`Issue "${issueId}" view "${viewId}" is stale — clearing mapping`)
      this.issueViews.delete(issueId)
      return null
    }

    return viewId
  }

  /**
   * Get or create a browser view for a specific Issue (standalone browsing mode).
   *
   * Unlike session views (created lazily by agent tools), issue views are
   * created **eagerly** when the user explicitly clicks "Open Browser".
   * The view is immediately displayed and persists for the app lifetime.
   *
   * A per-issue mutex prevents duplicate creation if the user double-clicks.
   *
   * @param issueId   The Issue that owns this view.
   * @param getWindow Callback to obtain the parent BrowserWindow.
   */
  async getOrCreateIssueView(
    issueId: string,
    getWindow: () => Promise<BrowserWindow>,
    preferredProfileId?: string,
    binding?: BrowserStateBinding,
  ): Promise<string> {
    const existing = this.getIssueView(issueId)
    if (existing) {
      const managed = this.managedViews.get(existing)
      if (!preferredProfileId || !managed || managed.profileId === preferredProfileId) {
        if (managed && binding) {
          managed.sourceBinding = binding
        }
        return existing
      }

      log.info('browser:view-profile-rebind', {
        scope: 'issue',
        sourceId: issueId,
        previousViewId: existing,
        previousProfileId: managed.profileId,
        preferredProfileId,
      })
    }

    const mutexKey = `issue:${issueId}`
    if (this.ensureViewMutexes.has(mutexKey)) {
      log.debug(`getOrCreateIssueView(${issueId}): awaiting in-flight mutex`)
      return this.ensureViewMutexes.get(mutexKey)!
    }

    log.debug(`getOrCreateIssueView(${issueId}): acquiring mutex`)
    const promise = this.doCreateIssueView(issueId, getWindow, preferredProfileId, binding)
    this.ensureViewMutexes.set(mutexKey, promise)
    try {
      return await promise
    } finally {
      this.ensureViewMutexes.delete(mutexKey)
      log.debug(`getOrCreateIssueView(${issueId}): mutex released`)
    }
  }

  /**
   * Switch the browser window to show the given Issue's view.
   *
   * Sync and side-effect-free (beyond dispatching `browser:view:opened`).
   * No-op if the Issue has no view yet (should not happen in normal flow since
   * `getOrCreateIssueView` is always called first by the IPC handler).
   */
  displayIssueView(issueId: string): void {
    const viewId = this.getIssueView(issueId)
    if (!viewId) {
      log.warn(`displayIssueView(${issueId}): no view found — was getOrCreateIssueView called?`)
      return
    }
    const managed = this.managedViews.get(viewId)
    if (managed && !managed.sourceBinding) {
      managed.sourceBinding = {
        policy: 'shared-project',
        profileId: managed.profileId,
        reason: 'legacy:display-issue',
        sourceType: 'issue-standalone',
        projectId: null,
        issueId,
        sessionId: null,
      }
    }
    this.setDisplayedView(viewId)
  }

  /**
   * Release (close) the view assigned to an Issue.
   *
   * Call when an Issue is deleted so browser resources are freed.
   * Safe to call when the Issue has no view (no-op).
   */
  async releaseIssueView(issueId: string): Promise<void> {
    const viewId = this.issueViews.get(issueId)
    if (!viewId) return

    this.issueViews.delete(issueId)
    log.info(`releaseIssueView(${issueId}): closing view "${viewId}"`)
    await this.closeView(viewId)
  }

  /** Internal: create and register a new view for an Issue. Always displays immediately. */
  private async doCreateIssueView(
    issueId: string,
    getWindow: () => Promise<BrowserWindow>,
    preferredProfileId?: string,
    binding?: BrowserStateBinding,
  ): Promise<string> {
    const existing = this.getIssueView(issueId)
    const existingManaged = existing ? this.managedViews.get(existing) : null
    const needsRebind =
      !!existing &&
      !!existingManaged &&
      !!preferredProfileId &&
      existingManaged.profileId !== preferredProfileId
    const rebindNavigationUrl = needsRebind
      ? this.resolveRebindNavigationUrl(existingManaged)
      : null

    if (existing && !needsRebind) {
      return existing
    }

    const profileId = await this.resolveProfileId(preferredProfileId)
    const win = await getWindow()
    const viewId = await this.openView(profileId, win)

    const resolvedBinding: BrowserStateBinding = binding ?? {
      policy: preferredProfileId ? 'custom-profile' : 'shared-project',
      profileId,
      reason: preferredProfileId
        ? `legacy:issue:custom-profile:${preferredProfileId}`
        : 'legacy:issue:shared-project',
      sourceType: 'issue-standalone',
      projectId: null,
      issueId,
      sessionId: null,
    }
    const managed = this.managedViews.get(viewId)
    if (managed) {
      managed.sourceBinding = resolvedBinding
    }
    if (needsRebind) {
      try {
        await this.primeReboundViewNavigation(viewId, rebindNavigationUrl)
      } catch (error) {
        log.warn('browser:view-rebind-transaction-aborted', {
          scope: 'issue',
          sourceId: issueId,
          previousViewId: existing,
          newViewId: viewId,
          rebindNavigationUrl,
          error: error instanceof Error ? error.message : String(error),
        })
        await this.closeView(viewId)
        throw error
      }
    }

    this.issueViews.set(issueId, viewId)
    log.info('browser:view-created', {
      scope: 'issue',
      sourceId: issueId,
      viewId,
      profileId,
      preferredProfileId: preferredProfileId ?? null,
    })

    // Issue views are ALWAYS immediately displayed.
    // The user explicitly opened the browser for this Issue; they expect to see it.
    this.setDisplayedView(viewId, resolvedBinding)

    // Profile switched: old issue view is now stale and should be retired.
    // Close AFTER the new view is displayed to avoid overlay teardown races.
    if (existing && existing !== viewId) {
      await this.closeView(existing)
    }

    return viewId
  }

  /**
   * The single source of truth for changing which view is displayed.
   *
   * Dispatches `browser:view:opened` — the only place this event is emitted.
   * Idempotent: no-op if the view is already displayed.
   *
   * Having a single dispatch point prevents the "multiple sessions fighting over
   * the display" race condition that existed when `openView` dispatched this
   * event unconditionally on every view creation.
   */
  private buildViewOpenedPayload(
    viewId: string,
    managed: ManagedView,
  ): Extract<DataBusEvent, { type: 'browser:view:opened' }>['payload'] {
    const resolvedBinding = managed.sourceBinding
    const fallbackSource = this.deriveSourceFromMaps(viewId)
    const eventSource: BrowserSource = resolvedBinding
      ? this.bindingToSource(resolvedBinding, fallbackSource)
      : fallbackSource
    const eventPolicy: BrowserStatePolicy = resolvedBinding?.policy ?? this.defaultPolicyForSource(eventSource)
    const eventProjectId = resolvedBinding?.projectId ?? null
    const eventBindingReason = resolvedBinding?.reason ?? 'legacy:map-derived'

    return {
      viewId,
      profileId: managed.profileId,
      profileName: managed.profileName,
      source: eventSource,
      statePolicy: eventPolicy,
      projectId: eventProjectId,
      profileBindingReason: eventBindingReason,
    }
  }

  private setDisplayedView(viewId: string, binding?: BrowserStateBinding): void {
    const managed = this.managedViews.get(viewId)
    if (!managed) {
      log.warn(`setDisplayedView("${viewId}"): view not found in managedViews`)
      return
    }

    if (binding) {
      managed.sourceBinding = binding
    }

    if (this._displayedViewId === viewId) {
      // Binding/source metadata may still change (e.g. policy/profile switch
      // resolving to the same view). Re-dispatch to keep renderer caches fresh.
      this.dispatch({
        type: 'browser:view:opened',
        payload: this.buildViewOpenedPayload(viewId, managed),
      })
      return
    }

    // Hide the previously displayed view BEFORE switching.
    //
    // Electron's WebContentsView z-order is determined by addChildView() insertion order
    // and does not change dynamically. Without explicit hiding, a previously displayed view
    // retains its bounds and stays on top of newly-displayed lower-z-order views, causing
    // the wrong content to be visible even after switching activeViewId in the renderer.
    //
    // NativeViewport is responsible for re-establishing the new view's bounds via
    // browser:sync-bounds once it receives browser:view:opened and updates activeViewId.
    if (this._displayedViewId) {
      this.setViewVisible(this._displayedViewId, false)
    }

    // When reopening from PiP/minimize, the target view may still be hidden
    // via savedBounds (setViewVisible(false)). Explicitly restore visibility
    // before notifying the renderer.
    this.setViewVisible(viewId, true)

    this._displayedViewId = viewId
    this.dispatch({
      type: 'browser:view:opened',
      payload: this.buildViewOpenedPayload(viewId, managed),
    })
    log.info(`setDisplayedView: "${this._displayedViewId ?? 'none'}" → "${viewId}" (profile: ${managed.profileName})`)
  }

  /**
   * Get displayed view snapshot for renderer catch-up.
   *
   * Returns viewId + profileId so the renderer can synchronize its state
   * on mount (handles the case where browser:view:opened event was dispatched
   * before React's useEffect subscribed to DataBus).
   */
  getActiveView(): { viewId: string; profileId: string } | null {
    const viewId = this.activeViewId // triggers staleness check
    if (!viewId) {
      log.debug('getActiveView(): no displayed view')
      return null
    }

    const managed = this.managedViews.get(viewId)
    if (!managed) {
      log.debug(`getActiveView(): viewId="${viewId}" not in managedViews (orphan?)`)
      return null
    }

    log.debug(`getActiveView(): returning viewId="${viewId}", profileId="${managed.profileId}"`)
    return { viewId, profileId: managed.profileId }
  }

  // ── Per-Session View Management ──────────────────────────────────

  /**
   * Get the view assigned to a session, or null if none exists yet.
   *
   * Performs a staleness check — if the view was destroyed externally,
   * the mapping is cleaned up and null is returned.
   */
  getSessionView(sessionId: string): string | null {
    const viewId = this.sessionViews.get(sessionId)
    if (!viewId) return null

    const managed = this.managedViews.get(viewId)
    if (!managed || managed.view.webContents.isDestroyed()) {
      log.warn(`Session "${sessionId}" view "${viewId}" is stale — clearing mapping`)
      this.sessionViews.delete(sessionId)
      return null
    }

    return viewId
  }

  /**
   * Get session view info for IPC queries (viewId + profileId).
   *
   * Returns null if the session has no view yet or if the view is stale.
   * This is the read-only counterpart to `getOrCreateSessionView()`.
   */
  getSessionViewInfo(sessionId: string): { viewId: string; profileId: string } | null {
    const viewId = this.getSessionView(sessionId)
    if (!viewId) return null

    const managed = this.managedViews.get(viewId)
    if (!managed) return null

    return { viewId, profileId: managed.profileId }
  }

  /**
   * Get issue view info for IPC queries (viewId + profileId).
   *
   * Returns null if the issue has no view yet or if the view is stale.
   * This is the read-only counterpart to `getOrCreateIssueView()`.
   */
  getIssueViewInfo(issueId: string): { viewId: string; profileId: string } | null {
    const viewId = this.getIssueView(issueId)
    if (!viewId) return null

    const managed = this.managedViews.get(viewId)
    if (!managed) return null

    return { viewId, profileId: managed.profileId }
  }

  /**
   * Get or create a browser view for the given session.
   *
   * - If the session already has a view, returns it immediately.
   * - If not, creates a new view using the default (first available) profile.
   *   A profile is created automatically if none exists.
   *
   * A per-session mutex prevents concurrent tool calls within the same session
   * from racing to create duplicate views.
   *
   * @param sessionId  The owning session's ID.
   * @param getWindow  Callback to obtain the parent BrowserWindow.
   */
  async getOrCreateSessionView(
    sessionId: string,
    getWindow: () => Promise<BrowserWindow>,
    preferredProfileId?: string,
    binding?: BrowserStateBinding,
  ): Promise<string> {
    // Fast path: session already has a healthy view
    const existing = this.getSessionView(sessionId)
    if (existing) {
      const managed = this.managedViews.get(existing)
      if (!preferredProfileId || !managed || managed.profileId === preferredProfileId) {
        if (managed && binding) {
          managed.sourceBinding = binding
        }
        return existing
      }

      log.info('browser:view-profile-rebind', {
        scope: 'session',
        sourceId: sessionId,
        previousViewId: existing,
        previousProfileId: managed.profileId,
        preferredProfileId,
      })
    }

    // Per-session mutex key
    const mutexKey = `session:${sessionId}`

    if (this.ensureViewMutexes.has(mutexKey)) {
      log.debug(`getOrCreateSessionView(${sessionId}): awaiting in-flight mutex`)
      return this.ensureViewMutexes.get(mutexKey)!
    }

    log.debug(`getOrCreateSessionView(${sessionId}): acquiring mutex`)
    const promise = this.doCreateSessionView(sessionId, getWindow, preferredProfileId, binding)
    this.ensureViewMutexes.set(mutexKey, promise)
    try {
      return await promise
    } finally {
      this.ensureViewMutexes.delete(mutexKey)
      log.debug(`getOrCreateSessionView(${sessionId}): mutex released`)
    }
  }

  private resolveRebindNavigationUrl(managed: ManagedView | null | undefined): string | null {
    if (!managed || managed.view.webContents.isDestroyed()) return null
    try {
      const currentUrl = managed.view.webContents.getURL()
      if (!currentUrl || currentUrl === 'about:blank') return null
      const parsed = new URL(currentUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
      return currentUrl
    } catch {
      return null
    }
  }

  private async primeReboundViewNavigation(viewId: string, url: string | null): Promise<void> {
    if (!url) return
    const managed = this.managedViews.get(viewId)
    if (!managed || managed.view.webContents.isDestroyed()) return

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Timed out after ${REBIND_NAVIGATION_TIMEOUT_MS}ms`))
      }, REBIND_NAVIGATION_TIMEOUT_MS)
    })

    try {
      await Promise.race([
        managed.view.webContents.loadURL(url),
        timeoutPromise,
      ])
    } catch (err) {
      log.warn('browser:view-rebind-load-url-failed', {
        viewId,
        url,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err instanceof Error ? err : new Error(String(err))
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }
  }

  /** Internal: create and register a new view for a session. */
  private async doCreateSessionView(
    sessionId: string,
    getWindow: () => Promise<BrowserWindow>,
    preferredProfileId?: string,
    binding?: BrowserStateBinding,
  ): Promise<string> {
    const existing = this.getSessionView(sessionId)
    const existingManaged = existing ? this.managedViews.get(existing) : null
    const needsRebind =
      !!existing &&
      !!existingManaged &&
      !!preferredProfileId &&
      existingManaged.profileId !== preferredProfileId
    const rebindNavigationUrl = needsRebind
      ? this.resolveRebindNavigationUrl(existingManaged)
      : null

    if (existing && !needsRebind) {
      return existing
    }

    const profileId = await this.resolveProfileId(preferredProfileId)
    const win = await getWindow()
    const viewId = await this.openView(profileId, win)

    const resolvedBinding: BrowserStateBinding = binding ?? {
      policy: preferredProfileId ? 'custom-profile' : 'isolated-session',
      profileId,
      reason: preferredProfileId
        ? `legacy:session:custom-profile:${preferredProfileId}`
        : 'legacy:session:isolated-session',
      sourceType: 'chat-session',
      projectId: null,
      issueId: null,
      sessionId,
    }
    const managed = this.managedViews.get(viewId)
    if (managed) {
      managed.sourceBinding = resolvedBinding
    }
    if (needsRebind) {
      try {
        await this.primeReboundViewNavigation(viewId, rebindNavigationUrl)
      } catch (error) {
        log.warn('browser:view-rebind-transaction-aborted', {
          scope: 'session',
          sourceId: sessionId,
          previousViewId: existing,
          newViewId: viewId,
          rebindNavigationUrl,
          error: error instanceof Error ? error.message : String(error),
        })
        await this.closeView(viewId)
        throw error
      }
    }

    // Register in session map
    this.sessionViews.set(sessionId, viewId)
    log.info('browser:view-created', {
      scope: 'session',
      sourceId: sessionId,
      viewId,
      profileId,
      preferredProfileId: preferredProfileId ?? null,
    })

    // Auto-display decision matrix:
    //
    //  _focusedSessionId  _focusedIssueId  this session  → display?
    //  -----------------  ---------------  ------------  ---------
    //  null               null             any (first)   YES  (autonomous: claim + display)
    //  <sessionId>        null             different     NO   (previous session already claimed)
    //  null               <issueId>        any           NO   (issue-standalone mode — guard!)
    //  <sessionId>        null             match         YES  (user's explicitly linked session)
    //
    // Key invariant: the first session to reach this path in autonomous mode claims
    // _focusedSessionId, preventing any concurrent session from stealing the display.
    // Ownership is released in releaseSessionView() so the next session can claim.
    const isAutonomousMode = this._focusedSessionId === null && this._focusedIssueId === null
    const isFocusedSession = this._focusedSessionId === sessionId
    if (isAutonomousMode || isFocusedSession) {
      if (isAutonomousMode) {
        // Claim display ownership so concurrent sessions cannot steal it.
        this._focusedSessionId = sessionId

        // Notify the browser renderer to link its chat panel to this session.
        // In autonomous mode the browser window was opened via ensureVisible()
        // which does NOT forward context — the renderer would otherwise remain
        // in standalone (empty) mode and never show the session's messages.
        this.dispatch({
          type: 'browser:context',
          payload: { linkedSessionId: sessionId },
        })
      }
      this.setDisplayedView(viewId, resolvedBinding)
    }

    // Profile switched for this session: close stale view after replacement.
    if (existing && existing !== viewId) {
      await this.closeView(existing)
    }

    return viewId
  }

  /**
   * Release (close) the view assigned to a session.
   *
   * Called by SessionOrchestrator when a session finishes, freeing
   * WebContentsView resources. Safe to call if the session has no view (no-op).
   *
   * @param sessionId      The session whose view should be released.
   * @param fallbackIssueId  When provided and the session's view was displayed,
   *   the Issue's standalone view is shown after the session view closes —
   *   preventing the browser window from going blank after an Issue session ends.
   *   Caller (SessionOrchestrator) derives this from `getOriginIssueId(session.origin)`.
   */
  async releaseSessionView(sessionId: string, fallbackIssueId?: string): Promise<void> {
    const viewId = this.sessionViews.get(sessionId)
    if (!viewId) return

    // Capture display state BEFORE closeView clears _displayedViewId
    const wasDisplayed = this._displayedViewId === viewId

    // Return display ownership when the owning session is released.
    // This restores autonomous mode so the next session that creates a view can claim.
    if (this._focusedSessionId === sessionId) {
      this._focusedSessionId = null
    }

    this.sessionViews.delete(sessionId)
    log.info(`releaseSessionView(${sessionId}): closing view "${viewId}"`)
    await this.closeView(viewId)

    // If the session's view was visible, fall back to the Issue's standalone view.
    // This gives the user a coherent browser context instead of a blank window.
    if (wasDisplayed && fallbackIssueId) {
      this.displayIssueView(fallbackIssueId)
      log.info(`releaseSessionView(${sessionId}): fell back to issue view for "${fallbackIssueId}"`)
    }
  }

  // ── Per-session view mutex map ───────────────────────────────────

  /** Mutexes keyed by "session:<sessionId>" to prevent concurrent view creation. */
  private readonly ensureViewMutexes = new Map<string, Promise<string>>()

  // ── Legacy: Ensure Active View (standalone browser-agent sessions) ──

  /**
   * Ensure a browser view is active for standalone use (no session context).
   *
   * Used by the standalone Browser Agent mode where no specific session context
   * is available. Prefer `getOrCreateSessionView()` whenever a session ID is known.
   *
   * Built-in mutex prevents concurrent calls from racing to create duplicate views.
   *
   * @param getWindow - Callback to obtain the BrowserWindow.
   */
  async ensureActiveView(
    getWindow: () => Promise<BrowserWindow>,
    preferredProfileId?: string,
    binding?: BrowserStateBinding,
  ): Promise<string> {
    // Fast path: already have a healthy displayed view
    const existing = this.activeViewId
    if (existing) {
      const managed = this.managedViews.get(existing)
      if (!preferredProfileId || !managed || managed.profileId === preferredProfileId) {
        if (managed && binding) {
          managed.sourceBinding = binding
        }
        if (binding) {
          this.setDisplayedView(existing, binding)
        }
        return existing
      }

      log.info('browser:view-profile-rebind', {
        scope: 'standalone',
        sourceId: 'standalone',
        previousViewId: existing,
        previousProfileId: managed.profileId,
        preferredProfileId,
      })
    }

    // Reopen-from-PiP path for standalone source:
    // if a detached standalone view with matching profile already exists,
    // reattach + display it instead of creating a new blank view.
    const reusable = this.findReusableStandaloneView(preferredProfileId)
    if (reusable) {
      const win = await getWindow()
      this.reattachView(reusable, win)
      const managed = this.managedViews.get(reusable)
      const resolvedBinding: BrowserStateBinding = binding ?? {
        policy: preferredProfileId ? 'custom-profile' : 'shared-global',
        profileId: managed?.profileId ?? (preferredProfileId ?? 'unknown'),
        reason: preferredProfileId
          ? `legacy:standalone:reopen-custom-profile:${preferredProfileId}`
          : 'legacy:standalone:reopen-shared-global',
        sourceType: 'standalone',
        projectId: null,
        issueId: null,
        sessionId: null,
      }
      if (managed) {
        managed.sourceBinding = resolvedBinding
      }
      this.setDisplayedView(reusable, resolvedBinding)
      return reusable
    }

    const mutexKey = 'standalone'
    if (this.ensureViewMutexes.has(mutexKey)) {
      log.debug('ensureActiveView(): awaiting in-flight mutex')
      return this.ensureViewMutexes.get(mutexKey)!
    }

    log.debug('ensureActiveView(): acquiring mutex')
    const promise = this.doEnsureActiveView(getWindow, preferredProfileId, binding)
    this.ensureViewMutexes.set(mutexKey, promise)
    try {
      return await promise
    } finally {
      this.ensureViewMutexes.delete(mutexKey)
      log.debug('ensureActiveView(): mutex released')
    }
  }

  /**
   * Internal: create a view with auto-created default profile if needed,
   * and set it as the displayed view.
   */
  private async doEnsureActiveView(
    getWindow: () => Promise<BrowserWindow>,
    preferredProfileId?: string,
    binding?: BrowserStateBinding,
  ): Promise<string> {
    const previousDisplayedViewId = this.activeViewId
    const previousDisplayedManaged = previousDisplayedViewId
      ? this.managedViews.get(previousDisplayedViewId)
      : null
    const profileId = await this.resolveProfileId(preferredProfileId)
    const rebindNavigationUrl =
      previousDisplayedViewId &&
      previousDisplayedManaged &&
      !this.isViewMappedToSessionOrIssue(previousDisplayedViewId) &&
      previousDisplayedManaged.profileId !== profileId
        ? this.resolveRebindNavigationUrl(previousDisplayedManaged)
        : null

    log.debug('doEnsureActiveView(): awaiting getWindow()...')
    const win = await getWindow()
    log.debug('doEnsureActiveView(): calling openView()...')
    const viewId = await this.openView(profileId, win)
    const resolvedBinding: BrowserStateBinding = binding ?? {
      policy: preferredProfileId ? 'custom-profile' : 'shared-global',
      profileId,
      reason: preferredProfileId
        ? `legacy:standalone:custom-profile:${preferredProfileId}`
        : 'legacy:standalone:shared-global',
      sourceType: 'standalone',
      projectId: null,
      issueId: null,
      sessionId: null,
    }
    const managed = this.managedViews.get(viewId)
    if (managed) {
      managed.sourceBinding = resolvedBinding
    }
    const shouldRebindStandalone =
      !!rebindNavigationUrl &&
      !!previousDisplayedViewId &&
      !!previousDisplayedManaged &&
      !this.isViewMappedToSessionOrIssue(previousDisplayedViewId) &&
      previousDisplayedManaged.profileId !== profileId
    if (shouldRebindStandalone) {
      try {
        await this.primeReboundViewNavigation(viewId, rebindNavigationUrl)
      } catch (error) {
        log.warn('browser:view-rebind-transaction-aborted', {
          scope: 'standalone',
          sourceId: 'standalone',
          previousViewId: previousDisplayedViewId,
          newViewId: viewId,
          rebindNavigationUrl,
          error: error instanceof Error ? error.message : String(error),
        })
        await this.closeView(viewId)
        throw error
      }
    }
    this.setDisplayedView(viewId, resolvedBinding)
    log.info('browser:view-created', {
      scope: 'standalone',
      sourceId: 'standalone',
      viewId,
      profileId,
      preferredProfileId: preferredProfileId ?? null,
    })

    // Standalone rebind path: retire previous standalone view to prevent
    // unbounded unmanaged view growth on repeated policy/profile switches.
    if (
      previousDisplayedViewId &&
      previousDisplayedViewId !== viewId &&
      !this.isViewMappedToSessionOrIssue(previousDisplayedViewId)
    ) {
      await this.closeView(previousDisplayedViewId)
    }

    return viewId
  }

  private isViewMappedToSessionOrIssue(viewId: string): boolean {
    for (const mappedViewId of this.sessionViews.values()) {
      if (mappedViewId === viewId) return true
    }
    for (const mappedViewId of this.issueViews.values()) {
      if (mappedViewId === viewId) return true
    }
    return false
  }

  private findReusableStandaloneView(preferredProfileId?: string): string | null {
    let fallback: string | null = null

    for (const [viewId, managed] of this.managedViews.entries()) {
      if (managed.view.webContents.isDestroyed()) continue
      if (this.isViewMappedToSessionOrIssue(viewId)) continue
      if (preferredProfileId && managed.profileId !== preferredProfileId) continue
      if (managed.sourceBinding && managed.sourceBinding.sourceType !== 'standalone') continue

      // Prefer the minimized/hidden standalone view that still has saved bounds.
      if (managed.savedBounds) return viewId
      if (!fallback) fallback = viewId
    }

    return fallback
  }

  /**
   * Resolve the profile to use for a new browser view.
   *
   * Selection order:
   * 1) Explicit preferred profile ID (if valid)
   * 2) Default profile fallback (first existing profile, or auto-create "Default")
   */
  private async resolveProfileId(preferredProfileId?: string): Promise<string> {
    if (preferredProfileId) {
      const preferred = await this.store.getById(preferredProfileId)
      if (preferred) {
        log.debug('browser:resolve-profile', {
          strategy: 'preferred',
          requestedProfileId: preferredProfileId,
          resolvedProfileId: preferred.id,
          resolvedProfileName: preferred.name,
        })
        return preferred.id
      }

      log.warn('browser:resolve-profile-fallback', {
        strategy: 'preferred',
        requestedProfileId: preferredProfileId,
        reason: 'profile_not_found',
        fallback: 'default',
      })
    }

    return this.resolveDefaultProfileId()
  }

  private defaultPolicyForSource(source: BrowserSource): BrowserStatePolicy {
    return defaultBrowserStatePolicyForSource(source)
  }

  private resolveSourceIdentity(request: BrowserSourceResolutionRequest): {
    issueId: string | null
    sessionId: string | null
    projectId: string | null
  } {
    const issueId =
      request.issueId ??
      (request.source.type === 'issue-session' || request.source.type === 'issue-standalone'
        ? request.source.issueId
        : null)
    const sessionId =
      request.sessionId ??
      (request.source.type === 'issue-session' || request.source.type === 'chat-session'
        ? request.source.sessionId
        : null)
    return {
      issueId,
      sessionId,
      projectId: request.projectId ?? null,
    }
  }

  private resolvePolicyForRequest(
    request: BrowserSourceResolutionRequest,
    sourceIdentity: { issueId: string | null; sessionId: string | null; projectId: string | null },
  ): BrowserStatePolicy {
    const requested = request.policy ?? this.defaultPolicyForSource(request.source)
    return normalizeBrowserStatePolicy({
      source: request.source,
      requestedPolicy: requested,
      projectId: sourceIdentity.projectId,
      issueId: sourceIdentity.issueId,
      sessionId: sourceIdentity.sessionId,
    })
  }

  private buildScopeKey(
    policy: BrowserStatePolicy,
    request: BrowserSourceResolutionRequest,
    sourceIdentity: { issueId: string | null; sessionId: string | null; projectId: string | null },
  ): string {
    const { issueId, sessionId, projectId } = sourceIdentity

    switch (policy) {
      case 'shared-global':
        return 'global'
      case 'shared-project':
        return `project:${projectId}`
      case 'isolated-issue':
        return `issue:${issueId}`
      case 'isolated-session':
        return `session:${sessionId}`
      case 'custom-profile':
        return `custom:${request.preferredProfileId ?? request.profileId ?? 'none'}`
    }
  }

  private async findOrCreateProfileByName(name: string): Promise<string> {
    const profiles = await this.listProfiles()
    const existing = profiles.find((profile) => profile.name === name)
    if (existing) return existing.id

    const created = await this.createProfile({
      name,
      cookiePersistence: true,
    })
    return created.id
  }

  /** Resolve the default profile ID, creating one if none exist. */
  private async resolveDefaultProfileId(): Promise<string> {
    const profiles = await this.listProfiles()
    if (profiles.length > 0) {
      log.debug(`resolveDefaultProfileId(): using existing profile "${profiles[0].id}" (${profiles[0].name})`)
      return profiles[0].id
    }

    log.debug('resolveDefaultProfileId(): no profiles found, creating "Default"')
    const created = await this.createProfile({ name: 'Default', cookiePersistence: true })
    log.debug(`resolveDefaultProfileId(): created Default profile "${created.id}"`)
    return created.id
  }

  private deriveSourceFromMaps(viewId: string): BrowserSource {
    for (const [sessionId, mappedViewId] of this.sessionViews.entries()) {
      if (mappedViewId === viewId) {
        return { type: 'chat-session', sessionId }
      }
    }

    for (const [issueId, mappedViewId] of this.issueViews.entries()) {
      if (mappedViewId === viewId) {
        return { type: 'issue-standalone', issueId }
      }
    }

    return { type: 'standalone' }
  }

  private bindingToSource(binding: BrowserStateBinding, fallback: BrowserSource): BrowserSource {
    switch (binding.sourceType) {
      case 'issue-session':
        if (binding.issueId && binding.sessionId) {
          return {
            type: 'issue-session',
            issueId: binding.issueId,
            sessionId: binding.sessionId,
          }
        }
        return fallback
      case 'chat-session':
        if (binding.sessionId) {
          return {
            type: 'chat-session',
            sessionId: binding.sessionId,
          }
        }
        return fallback
      case 'issue-standalone':
        if (binding.issueId) {
          return {
            type: 'issue-standalone',
            issueId: binding.issueId,
          }
        }
        return fallback
      case 'standalone':
        return { type: 'standalone' }
    }
  }

  // ── Profile CRUD ──────────────────────────────────────────────────

  async createProfile(input: CreateProfileInput): Promise<BrowserProfile> {
    const profile = this.store.createProfile(input)
    await this.store.add(profile)
    log.info(`Created browser profile: ${profile.name} (${profile.id})`)
    return profile
  }

  async listProfiles(): Promise<BrowserProfile[]> {
    return this.store.list()
  }

  /**
   * Delete a profile and close all associated views.
   *
   * Uses snapshot-then-iterate pattern to avoid modifying the Map during
   * iteration. Each closeView is wrapped in try-catch to ensure all views
   * are attempted even if one fails.
   */
  async deleteProfile(profileId: string): Promise<boolean> {
    // Snapshot view IDs first — closeView() mutates managedViews
    const viewIdsToClose = [...this.managedViews.entries()]
      .filter(([, managed]) => managed.profileId === profileId)
      .map(([viewId]) => viewId)

    const errors: Error[] = []
    for (const viewId of viewIdsToClose) {
      try {
        await this.closeView(viewId)
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)))
        log.error(`Failed to close view ${viewId} during profile deletion`, err)
      }
    }

    if (errors.length > 0) {
      log.warn(
        `${errors.length}/${viewIdsToClose.length} views failed to close ` +
        `during deletion of profile ${profileId}`,
      )
    }

    return this.store.delete(profileId)
  }

  // ── View Lifecycle ────────────────────────────────────────────────

  async openView(profileId: string, parentWindow: BrowserWindow): Promise<string> {
    const profile = await this.store.getById(profileId)
    if (!profile) {
      throw new Error(`Browser profile not found: ${profileId}`)
    }

    const ses = session.fromPartition(profile.partition)

    // Override User-Agent to match standard Chrome (remove Electron/OpenCow identifiers).
    // Some websites detect Electron and serve degraded content or block access.
    const defaultUA = ses.getUserAgent()
    const chromeUA = defaultUA
      .replace(/\s*OpenCow\/[\w.]+/g, '')
      .replace(/\s*Electron\/[\w.]+/g, '')
    ses.setUserAgent(chromeUA)

    const { nanoid } = await import('nanoid')
    const viewId = nanoid()

    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    })

    // Visual decorator — injects DOM overlays via CDP for click/scroll/screenshot feedback.
    // Created BEFORE the executor so it can be passed as an optional dependency.
    const decorator = new BrowserActionDecorator(view.webContents)

    // CDP Executor (explicit lifecycle)
    const executor = new BrowserActionExecutor(view.webContents, (state) => {
      this.dispatch({
        type: 'browser:executor:state-changed',
        payload: { viewId, state },
      })
    }, decorator)
    await executor.attach()

    // Cookie persistence interceptor
    const interceptor = new CookiePersistenceInterceptor(ses, {
      defaultTTL: DEFAULT_COOKIE_TTL,
      allowedDomains: profile.allowedDomains,
    })
    if (profile.cookiePersistence) {
      interceptor.start()
    }

    // Wire webContents navigation events → DataBus
    view.webContents.on('did-navigate', () => {
      this.dispatch({
        type: 'browser:navigated',
        payload: {
          viewId,
          url: view.webContents.getURL(),
          title: view.webContents.getTitle(),
        },
      })
    })

    view.webContents.on('did-navigate-in-page', () => {
      this.dispatch({
        type: 'browser:navigated',
        payload: {
          viewId,
          url: view.webContents.getURL(),
          title: view.webContents.getTitle(),
        },
      })
    })

    view.webContents.on('did-start-loading', () => {
      this.dispatch({
        type: 'browser:loading',
        payload: { viewId, isLoading: true },
      })
    })

    view.webContents.on('did-stop-loading', () => {
      this.dispatch({
        type: 'browser:loading',
        payload: { viewId, isLoading: false },
      })
      // Page fully loaded — best moment to capture a fresh thumbnail
      this.debouncedCaptureThumbnail(viewId)
    })

    // Page title update
    view.webContents.on('page-title-updated', (_event, title) => {
      this.dispatch({
        type: 'browser:navigated',
        payload: { viewId, url: view.webContents.getURL(), title },
      })
    })

    // Add to parent window
    log.debug(`openView(): adding child view to parent window, viewId="${viewId}"`)
    parentWindow.contentView.addChildView(view)

    const managed: ManagedView = {
      id: viewId,
      profileId,
      profileName: profile.name,
      view,
      session: ses,
      executor,
      decorator,
      interceptor,
    }
    this.managedViews.set(viewId, managed)
    log.debug(`openView(): registered viewId="${viewId}" in managedViews`)
    // NOTE: browser:view:opened is NOT dispatched here.
    // Display responsibility belongs exclusively to setDisplayedView(), which is called
    // by doCreateSessionView (focused session) or doEnsureActiveView (standalone).
    // This prevents multiple concurrent sessions from fighting over the displayed view.

    // Update last used timestamp
    await this.store.updateLastUsed(profileId)

    log.info(`Opened browser view: ${viewId} (profile: ${profile.name}), managedViews.size=${this.managedViews.size}`)
    return viewId
  }

  async closeView(viewId: string): Promise<void> {
    const managed = this.managedViews.get(viewId)
    if (!managed) return

    managed.interceptor.stop()
    managed.decorator.dispose()
    await managed.executor.detach()

    // Remove from parent window if still attached
    try {
      const parent = managed.view.webContents
      if (!parent.isDestroyed()) {
        // Find the parent BrowserWindow and remove the child view
        const { BrowserWindow: BW } = await import('electron')
        for (const win of BW.getAllWindows()) {
          try {
            win.contentView.removeChildView(managed.view)
          } catch {
            // View may not be a child of this window — ignore
          }
        }
        managed.view.webContents.close()
      }
    } catch {
      // Already destroyed — ignore
    }

    this.managedViews.delete(viewId)
    this.clearThumbnailTimer(viewId)

    // Clear displayed view if it was this one
    if (this._displayedViewId === viewId) {
      this._displayedViewId = null
    }

    // Clean up any session mapping pointing to this view
    for (const [sid, vid] of this.sessionViews) {
      if (vid === viewId) {
        this.sessionViews.delete(sid)
        log.debug(`closeView(): removed session mapping for session "${sid}"`)
        break
      }
    }

    // Clean up any issue mapping pointing to this view
    for (const [iid, vid] of this.issueViews) {
      if (vid === viewId) {
        this.issueViews.delete(iid)
        log.debug(`closeView(): removed issue mapping for issue "${iid}"`)
        break
      }
    }

    this.dispatch({ type: 'browser:view:closed', payload: { viewId } })
    log.info(`Closed browser view: ${viewId}`)
  }

  // ── Detach / Reattach (Overlay lifecycle — keep-alive without destroy) ──

  /**
   * Detach a view from the main window without destroying it (keep-alive).
   *
   * The view remains in `managedViews` and its webContents stays active
   * (login state, scroll position, form data preserved). Use `reattachView()`
   * to re-add it to the window later.
   */
  detachView(viewId: string): void {
    const managed = this.managedViews.get(viewId)
    if (!managed) return

    try {
      const { BrowserWindow: BW } = require('electron')
      for (const win of BW.getAllWindows()) {
        try {
          win.contentView.removeChildView(managed.view)
        } catch {
          // View may not be a child of this window — ignore
        }
      }
    } catch {
      // Already detached — ignore
    }

    // Clear display state so setDisplayedView() won't short-circuit on reopen.
    // Without this, ensure-source-view → setDisplayedView(sameId) would be a
    // no-op (id equality check), leaving the view detached despite the renderer
    // expecting it to be displayed.
    if (this._displayedViewId === viewId) {
      this._displayedViewId = null
    }

    log.debug(`detachView("${viewId}"): view detached (kept alive in managedViews)`)
  }

  /**
   * Re-attach a previously detached view to a window.
   *
   * Bounds will be re-established by NativeViewport's ResizeObserver via
   * browser:sync-bounds once the sheet mounts.
   */
  reattachView(viewId: string, parentWindow: BrowserWindow): void {
    const managed = this.managedViews.get(viewId)
    if (!managed) {
      log.warn(`reattachView("${viewId}"): not found in managedViews`)
      return
    }

    if (managed.view.webContents.isDestroyed()) {
      log.warn(`reattachView("${viewId}"): webContents is destroyed — cannot reattach`)
      this.managedViews.delete(viewId)
      return
    }

    parentWindow.contentView.addChildView(managed.view)
    log.debug(`reattachView("${viewId}"): view re-attached to parent window`)
  }

  // ── Bounds Sync ───────────────────────────────────────────────────

  syncBounds(viewId: string, bounds: ViewBounds): void {
    const managed = this.managedViews.get(viewId)
    if (!managed) return
    const rounded = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    }
    if (managed.savedBounds) {
      // View is hidden by the overlay guard — update the saved bounds so the
      // restored position reflects the latest layout (e.g. window resize or
      // panel drag that happened while a modal was open).
      managed.savedBounds = rounded
    } else {
      managed.view.setBounds(rounded)
    }
  }

  /**
   * Toggle native view visibility for z-index conflict resolution.
   *
   * Hide: saves current bounds, then moves the view offscreen.
   * Show: restores saved bounds so the view reappears in its original position.
   */
  setViewVisible(viewId: string, visible: boolean): void {
    const managed = this.managedViews.get(viewId)
    if (!managed) return
    if (visible) {
      if (managed.savedBounds) {
        managed.view.setBounds(managed.savedBounds)
        managed.savedBounds = undefined
      }
    } else {
      // Save current bounds before hiding (skip if already hidden)
      if (!managed.savedBounds) {
        managed.savedBounds = managed.view.getBounds()
      }
      managed.view.setBounds({ x: -9999, y: -9999, width: 0, height: 0 })
    }
  }

  // ── Thumbnail Capture ────────────────────────────────────────────

  /**
   * Debounced thumbnail capture for a view.
   *
   * Called after `did-stop-loading` to capture a page preview once the
   * content is stable. The thumbnail is resized to a small JPEG data URL
   * and dispatched via DataBus for the PiP trigger/panel to display.
   */
  private debouncedCaptureThumbnail(viewId: string): void {
    this.clearThumbnailTimer(viewId)
    const timer = setTimeout(() => {
      this.thumbnailTimers.delete(viewId)
      this.captureThumbnail(viewId).catch((err) => {
        log.debug(`captureThumbnail("${viewId}") failed: ${err}`)
      })
    }, THUMBNAIL_DEBOUNCE_MS)
    this.thumbnailTimers.set(viewId, timer)
  }

  private clearThumbnailTimer(viewId: string): void {
    const existing = this.thumbnailTimers.get(viewId)
    if (existing) {
      clearTimeout(existing)
      this.thumbnailTimers.delete(viewId)
    }
  }

  private async captureThumbnail(viewId: string): Promise<void> {
    const managed = this.managedViews.get(viewId)
    if (!managed || managed.view.webContents.isDestroyed()) return

    const image = await managed.view.webContents.capturePage()
    if (image.isEmpty()) return

    const size = image.getSize()
    if (size.width === 0 || size.height === 0) return

    // Resize maintaining aspect ratio, capped at THUMBNAIL_MAX_WIDTH
    const scale = Math.min(THUMBNAIL_MAX_WIDTH / size.width, 1)
    const thumb = image.resize({
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale),
      quality: 'good',
    })

    // JPEG for smaller payload (~10-20KB vs ~50-100KB PNG)
    const jpegBuffer = thumb.toJPEG(THUMBNAIL_JPEG_QUALITY)
    const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`

    this.dispatch({
      type: 'browser:thumbnail-updated',
      payload: { viewId, dataUrl },
    })
  }

  // ── Command Execution ─────────────────────────────────────────────

  async executeCommand(command: BrowserCommand, context: BrowserExecutionContext = {}): Promise<BrowserCommandResult> {
    const managed = this.managedViews.get(command.viewId)
    if (!managed) {
      return {
        status: 'error',
        error: { code: 'PAGE_CLOSED', message: `View ${command.viewId} not found` },
      }
    }

    // Domain allowlist check for navigate
    if (command.action === 'navigate') {
      const profile = await this.store.getById(managed.profileId)
      if (profile && profile.allowedDomains.length > 0) {
        try {
          const hostname = new URL(command.url).hostname
          if (!this.isDomainAllowed(hostname, profile.allowedDomains)) {
            return {
              status: 'error',
              error: {
                code: 'DOMAIN_BLOCKED',
                domain: hostname,
                allowedDomains: profile.allowedDomains,
                message: `Domain "${hostname}" is not in the allowlist`,
              },
            }
          }
        } catch {
          return {
            status: 'error',
            error: { code: 'NAVIGATION_FAILED', url: command.url, message: 'Invalid URL' },
          }
        }
      }
    }

    // Dispatch command lifecycle events so the renderer can show precise action state.
    this.dispatch({
      type: 'browser:command:started',
      payload: { viewId: command.viewId, action: command.action },
    })

    // Breathing border glow — visible while the agent is operating the browser.
    managed.decorator.startBorderGlow().catch(() => {})

    try {
      const data = await managed.executor.execute(command, context)

      managed.decorator.deferStopBorderGlow()
      this.dispatch({
        type: 'browser:command:completed',
        payload: { viewId: command.viewId, action: command.action, success: true },
      })

      return { status: 'success', data }
    } catch (err) {
      const error = this.normalizeBrowserError(err, command)

      managed.decorator.deferStopBorderGlow()
      this.dispatch({
        type: 'browser:command:completed',
        payload: { viewId: command.viewId, action: command.action, success: false },
      })

      return { status: 'error', error }
    }
  }

  // ── Page Info ─────────────────────────────────────────────────────

  getPageInfo(viewId: string): PageInfo | null {
    const managed = this.managedViews.get(viewId)
    if (!managed || managed.view.webContents.isDestroyed()) return null

    return {
      url: managed.view.webContents.getURL(),
      title: managed.view.webContents.getTitle(),
      isLoading: managed.view.webContents.isLoading(),
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    const viewIds = [...this.managedViews.keys()]
    for (const viewId of viewIds) {
      await this.closeView(viewId)
    }
  }

  // ── Private ───────────────────────────────────────────────────────

  private normalizeBrowserError(err: unknown, command: BrowserCommand): BrowserError {
    if (this.isBrowserError(err)) return err

    const rawMessage = this.stringifyUnknownError(err)
    log.warn('browser:command:error-normalized', {
      action: command.action,
      viewId: command.viewId,
      error: rawMessage,
    })

    return {
      code: 'CDP_ERROR',
      method: command.action,
      message: rawMessage,
    }
  }

  private isBrowserError(err: unknown): err is BrowserError {
    if (!this.isErrorRecord(err)) return false
    if (typeof err.code !== 'string' || typeof err.message !== 'string') return false

    switch (err.code) {
      case 'SELECTOR_NOT_FOUND':
      case 'ELEMENT_NOT_VISIBLE':
      case 'ELEMENT_NOT_INTERACTABLE':
        return typeof err.selector === 'string'
      case 'NAVIGATION_FAILED':
        return typeof err.url === 'string' && (err.httpStatus === undefined || typeof err.httpStatus === 'number')
      case 'DOMAIN_BLOCKED':
        return (
          typeof err.domain === 'string' &&
          Array.isArray(err.allowedDomains) &&
          err.allowedDomains.every((domain) => typeof domain === 'string')
        )
      case 'TIMEOUT':
        return typeof err.action === 'string' && typeof err.timeoutMs === 'number'
      case 'ABORTED':
        return typeof err.action === 'string'
      case 'PAGE_CRASHED':
      case 'PAGE_CLOSED':
      case 'DEBUGGER_ALREADY_ATTACHED':
      case 'SNAPSHOT_STALE':
      case 'AX_TREE_FAILED':
        return true
      case 'CDP_ERROR':
        return typeof err.method === 'string'
      case 'DEBUGGER_DETACHED':
        return typeof err.reason === 'string'
      case 'SENSITIVE_ACTION_DENIED':
        return typeof err.action === 'string'
      case 'UPLOAD_TARGET_INVALID':
        return typeof err.target === 'string'
      case 'FILE_NOT_FOUND':
        return typeof err.path === 'string'
      case 'FILE_NOT_ALLOWED':
        return typeof err.path === 'string' && typeof err.root === 'string'
      case 'UPLOAD_TOO_MANY_FILES':
        return typeof err.maxFiles === 'number' && typeof err.received === 'number'
      case 'UPLOAD_FILE_TOO_LARGE':
        return (
          typeof err.path === 'string' &&
          typeof err.sizeBytes === 'number' &&
          typeof err.maxBytes === 'number'
        )
      case 'UPLOAD_TOTAL_TOO_LARGE':
        return typeof err.totalBytes === 'number' && typeof err.maxBytes === 'number'
      case 'REF_NOT_FOUND':
        return typeof err.ref === 'string'
      default:
        return false
    }
  }

  private isErrorRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }

  private stringifyUnknownError(err: unknown): string {
    if (err instanceof Error) return err.message
    if (typeof err === 'string' && err.length > 0) return err
    if (this.isErrorRecord(err)) {
      if (typeof err.message === 'string' && err.message.length > 0) {
        const codePrefix = typeof err.code === 'string' && err.code.length > 0 ? `[${err.code}] ` : ''
        return `${codePrefix}${err.message}`
      }
      try {
        return JSON.stringify(err)
      } catch {
        return String(err)
      }
    }
    return String(err)
  }

  private isDomainAllowed(hostname: string, allowedDomains: string[]): boolean {
    return allowedDomains.some((pattern) => {
      if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1) // ".zhipin.com"
        return hostname.endsWith(suffix) || hostname === pattern.slice(2)
      }
      return hostname === pattern
    })
  }
}
