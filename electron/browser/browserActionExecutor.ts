// SPDX-License-Identifier: Apache-2.0

import type { WebContents } from 'electron'
import type {
  BrowserCommand,
  BrowserError,
  BrowserExecutionContext,
  ExecutorState,
  PageContent,
} from './types'
import type { BrowserActionDecorator } from './browserActionDecorator'
import { SnapshotService } from './snapshot'
import { SnapshotState } from './snapshot'
import type { SnapshotOptions, SnapshotResult } from './snapshot'
import { createLogger } from '../platform/logger'

const log = createLogger('BrowserAction')

// ─── Timeouts ────────────────────────────────────────────────────────────

/** Default timeout for individual CDP commands (ms). */
const DEFAULT_CDP_TIMEOUT = 15_000

/** Extended timeout for navigation-related CDP commands (ms). */
const NAVIGATION_TIMEOUT = 30_000

/** Default timeout for selector wait operations (ms). */
const DEFAULT_SELECTOR_TIMEOUT = 10_000

/** Default scroll amount in pixels. */
const DEFAULT_SCROLL_AMOUNT = 500

/**
 * BrowserActionExecutor — CDP-based browser action layer.
 *
 * Encapsulates Chrome DevTools Protocol commands via Electron's `webContents.debugger`.
 * Uses an explicit state machine (idle → attaching → ready → detached/error)
 * instead of coupling lifecycle to the constructor.
 *
 * Key design decisions:
 * - Every CDP call has a bounded timeout to prevent hanging the SDK session.
 * - `waitForLoad()` guards against the "lost wakeup" problem (page loads before listener registers).
 * - Error classification maps CDP failures → BrowserError union for exhaustive handling upstream.
 */
export class BrowserActionExecutor {
  private _state: ExecutorState = 'idle'

  /** Snapshot-Ref: Lazily initialized after debugger attach. */
  private snapshotService: SnapshotService | null = null

  /** Snapshot-Ref: Independent state container — holds refMap + staleness. */
  private readonly snapshotState = new SnapshotState()

  constructor(
    private readonly webContents: WebContents,
    private readonly onStateChange: (state: ExecutorState) => void,
    private readonly decorator?: BrowserActionDecorator,
  ) {}

  get state(): ExecutorState {
    return this._state
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  async attach(): Promise<void> {
    if (this._state !== 'idle') return
    this.setState('attaching')

    try {
      this.webContents.debugger.attach('1.3')
      this.webContents.debugger.on('detach', this.handleDetach)
      this.setState('ready')

      // Initialize SnapshotService with CdpFn closure bridging
      this.snapshotService = new SnapshotService({
        cdp: (method, params, timeoutMs, ctx) => this.cdp(method, params, timeoutMs, ctx),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Another debugger is already attached')) {
        this.setState('error')
        throw this.createError({ code: 'DEBUGGER_ALREADY_ATTACHED', message: msg })
      }
      this.setState('error')
      throw err
    }
  }

  async detach(): Promise<void> {
    if (this._state !== 'ready') return
    try {
      this.webContents.debugger.removeAllListeners('detach')
      this.webContents.debugger.detach()
    } catch {
      // webContents may already be destroyed — ignore
    }
    this.setState('detached')
  }

  // ── Unified Execute ───────────────────────────────────────────────

  async execute(command: BrowserCommand, context: BrowserExecutionContext = {}): Promise<unknown> {
    this.assertReady()
    this.throwIfAborted(command.action, context)

    switch (command.action) {
      case 'navigate':
        return this.navigate(command.url, context)
      case 'go-back':
        return this.goBack(context)
      case 'go-forward':
        return this.goForward(context)
      case 'reload':
        return this.reload(context)
      case 'click':
        return this.click(command.selector, context)
      case 'type':
        return this.type(command.selector, command.text, context)
      case 'select':
        return this.selectOption(command.selector, command.value, context)
      case 'scroll':
        return this.scroll(command.direction, command.amount, context)
      case 'wait-for-selector':
        return this.waitForSelector(command.selector, command.timeout, context)
      case 'extract-text':
        return this.extractText(command.selector, context)
      case 'extract-page':
        return this.extractPage(context)
      case 'screenshot':
        return this.screenshot(context)
      case 'evaluate':
        return this.evaluate(command.expression, context)
      case 'download':
        return this.download(command.url, command.filename, context)
      // Snapshot-Ref commands
      case 'snapshot':
        return this.takeSnapshot(command.options, context)
      case 'ref-click':
        return this.refClick(command.ref, context)
      case 'ref-type':
        return this.refType(command.ref, command.text, context)
    }
  }

  // ── Navigation ────────────────────────────────────────────────────

  private async navigate(url: string, context: BrowserExecutionContext): Promise<void> {
    // Visual decoration (fire-and-forget — never delays tool execution)
    this.decorator?.showNavigate().catch(this.noop)

    try {
      await this.cdp('Page.navigate', { url }, NAVIGATION_TIMEOUT, context)
      await this.waitForLoad(NAVIGATION_TIMEOUT, context)
    } catch (err) {
      // Re-throw if already classified (e.g. from cdp's classifyError)
      if (this.isBrowserError(err)) throw err
      throw this.classifyError(err, 'navigate')
    }

    // Invalidate snapshot — refs are no longer valid after navigation
    this.invalidateSnapshot()
  }

  private async goBack(context: BrowserExecutionContext): Promise<void> {
    this.webContents.goBack()
    await this.waitForLoad(NAVIGATION_TIMEOUT, context)
    this.invalidateSnapshot()
  }

  private async goForward(context: BrowserExecutionContext): Promise<void> {
    this.webContents.goForward()
    await this.waitForLoad(NAVIGATION_TIMEOUT, context)
    this.invalidateSnapshot()
  }

  private async reload(context: BrowserExecutionContext): Promise<void> {
    this.webContents.reload()
    await this.waitForLoad(NAVIGATION_TIMEOUT, context)
    this.invalidateSnapshot()
  }

  // ── Element Interaction ───────────────────────────────────────────

  private async click(selector: string, context: BrowserExecutionContext): Promise<void> {
    const nodeId = await this.resolveSelector(selector, context)
    const box = await this.getBoxModel(nodeId, context)
    const { x, y } = this.boxCenter(box)

    // Visual decoration: cursor glide + click ripple (fire-and-forget)
    this.decorator?.showClick(x, y).catch(this.noop)

    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x, y,
      button: 'left',
      clickCount: 1,
    }, DEFAULT_CDP_TIMEOUT, context)
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x, y,
      button: 'left',
      clickCount: 1,
    }, DEFAULT_CDP_TIMEOUT, context)
  }

  private async type(selector: string, text: string, context: BrowserExecutionContext): Promise<void> {
    // click() already triggers decorator.showClick → cursor moves to element.
    await this.click(selector, context)
    // Small delay for focus
    await this.sleep(50, context, 'type')

    // Visual decoration: typing-glow at the current cursor position
    this.decorator?.showType().catch(this.noop)

    for (const char of text) {
      await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', text: char }, DEFAULT_CDP_TIMEOUT, context)
      await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', text: char }, DEFAULT_CDP_TIMEOUT, context)
    }
  }

  private async selectOption(selector: string, value: string, context: BrowserExecutionContext): Promise<void> {
    await this.evaluate(
      `document.querySelector(${JSON.stringify(selector)}).value = ${JSON.stringify(value)}; ` +
      `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change', { bubbles: true }))`,
      context,
    )
  }

  private async scroll(direction: 'up' | 'down', amount: number | undefined, context: BrowserExecutionContext): Promise<void> {
    // Visual decoration: directional arrow + edge gradient
    this.decorator?.showScroll(direction).catch(this.noop)

    // Resolve actual viewport height for default and sanity-clamping.
    let viewportHeight = DEFAULT_SCROLL_AMOUNT
    try {
      const { result } = await this.cdp(
        'Runtime.evaluate',
        { expression: 'window.innerHeight', returnByValue: true },
        DEFAULT_CDP_TIMEOUT,
        context,
      ) as { result: { value?: number } }
      if (typeof result.value === 'number' && result.value > 0) {
        viewportHeight = result.value
      }
    } catch {
      // Fallback to DEFAULT_SCROLL_AMOUNT if CDP call fails
    }

    // Models sometimes pass absurdly small pixel values (3, 5, 10) because they
    // misjudge the scale. Clamp to at least 20% of viewport height so every
    // scroll call produces a visibly meaningful page movement.
    const minScroll = Math.round(viewportHeight * 0.2)
    const scrollAmount = amount === undefined
      ? viewportHeight
      : Math.max(amount, minScroll)

    const deltaY = scrollAmount * (direction === 'down' ? 1 : -1)
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 100,
      y: 100,
      deltaX: 0,
      deltaY,
    }, DEFAULT_CDP_TIMEOUT, context)
  }

  // ── Wait ──────────────────────────────────────────────────────────

  private async waitForSelector(
    selector: string,
    timeout: number | undefined,
    context: BrowserExecutionContext,
  ): Promise<void> {
    const timeoutMs = this.resolveTimeoutMs(
      timeout ?? DEFAULT_SELECTOR_TIMEOUT,
      context,
      'wait-for-selector',
    )
    const start = Date.now()
    const interval = 200

    while (Date.now() - start < timeoutMs) {
      this.throwIfAborted('wait-for-selector', context)
      const result = await this.evaluate(
        `!!document.querySelector(${JSON.stringify(selector)})`,
        context,
      )
      if (result === true) return
      await this.sleep(interval, context, 'wait-for-selector')
    }

    throw this.createError({
      code: 'TIMEOUT',
      action: 'wait-for-selector',
      timeoutMs,
      message: `Selector "${selector}" not found within ${timeoutMs}ms`,
    })
  }

  // ── Extraction ────────────────────────────────────────────────────

  private async extractText(selector: string | undefined, context: BrowserExecutionContext): Promise<string> {
    if (selector) {
      const result = await this.evaluate(
        `(function() { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.innerText : null; })()`,
        context,
      )
      if (result === null) {
        throw this.createError({
          code: 'SELECTOR_NOT_FOUND',
          selector,
          message: `Element not found: ${selector}`,
        })
      }
      return result as string
    }
    return (await this.evaluate('document.body.innerText', context)) as string
  }

  private async extractPage(context: BrowserExecutionContext): Promise<PageContent> {
    const result = await this.evaluate(`(function() {
      const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map(a => ({
        text: (a.textContent || '').trim().slice(0, 200),
        href: a.href
      }));
      return {
        title: document.title,
        url: location.href,
        text: document.body.innerText.slice(0, 50000),
        links: links
      };
    })()`, context)

    return result as PageContent
  }

  private async screenshot(context: BrowserExecutionContext): Promise<string> {
    // Visual decoration: camera flash + shutter border
    this.decorator?.showScreenshot().catch(this.noop)

    const result = await this.cdp('Page.captureScreenshot', { format: 'png' }, DEFAULT_CDP_TIMEOUT, context)
    return (result as { data: string }).data
  }

  // ── Script Execution ──────────────────────────────────────────────

  private async evaluate(expression: string, context: BrowserExecutionContext): Promise<unknown> {
    try {
      const result = await this.cdp('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }, DEFAULT_CDP_TIMEOUT, context)
      const { result: evalResult, exceptionDetails } = result as {
        result: { value: unknown }
        exceptionDetails?: { text: string }
      }
      if (exceptionDetails) {
        throw new Error(`Evaluation error: ${exceptionDetails.text}`)
      }
      return evalResult.value
    } catch (err) {
      if (this.isBrowserError(err)) throw err
      throw this.classifyError(err, 'evaluate')
    }
  }

  // ── Download ──────────────────────────────────────────────────────

  private async download(url: string, _filename: string | undefined, context: BrowserExecutionContext): Promise<void> {
    // Trigger download via CDP — the Electron session's download handler
    // will manage the actual file save
    await this.cdp('Page.navigate', { url }, NAVIGATION_TIMEOUT, context)
  }

  // ── Snapshot-Ref ─────────────────────────────────────────────────

  /**
   * Take an accessibility snapshot of the current page.
   * Returns a compact text tree with ref-annotated elements.
   */
  private async takeSnapshot(
    options: SnapshotOptions | undefined,
    context: BrowserExecutionContext,
  ): Promise<SnapshotResult> {
    if (!this.snapshotService) {
      throw this.createError({
        code: 'AX_TREE_FAILED',
        message: 'Snapshot service not initialized — is debugger attached?',
      })
    }

    const result = await this.snapshotService.takeSnapshot(options, context)
    this.snapshotState.update(result)

    // Visual decoration: scan line + ref count badge (fire-and-forget)
    this.decorator?.showSnapshot?.(result.refCount).catch(this.noop)

    return result
  }

  /**
   * Click an element by its snapshot ref (e.g. "e1").
   * Automatically returns a fresh snapshot after clicking.
   */
  private async refClick(
    ref: string,
    context: BrowserExecutionContext,
  ): Promise<SnapshotResult> {
    const entry = this.snapshotState.resolveRef(ref)

    if (entry.backendNodeId === undefined) {
      throw this.createError({
        code: 'REF_NOT_FOUND',
        ref,
        message: `Ref "${ref}" has no backendNodeId — cannot locate element`,
      })
    }

    // Scroll into view
    await this.cdp(
      'DOM.scrollIntoViewIfNeeded',
      { backendNodeId: entry.backendNodeId },
      DEFAULT_CDP_TIMEOUT,
      context,
    )

    // Get box model by backendNodeId (NOT nodeId — critical distinction)
    const boxResult = await this.getBoxModelByBackendNodeId(entry.backendNodeId, context)
    const { x, y } = this.boxCenter(boxResult)

    // Visual decoration (fire-and-forget)
    this.decorator?.showRefClick?.(ref, entry.name, x, y).catch(this.noop)

    // Mouse click sequence
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    }, DEFAULT_CDP_TIMEOUT, context)
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    }, DEFAULT_CDP_TIMEOUT, context)

    // Auto re-snapshot — guides Agent to see the updated state
    await this.sleep(100, context, 'ref-click')
    return this.takeSnapshot(undefined, context)
  }

  /**
   * Type text into an element by its snapshot ref (e.g. "e3").
   * Clicks for focus, types character-by-character, returns fresh snapshot.
   */
  private async refType(
    ref: string,
    text: string,
    context: BrowserExecutionContext,
  ): Promise<SnapshotResult> {
    const entry = this.snapshotState.resolveRef(ref)

    if (entry.backendNodeId === undefined) {
      throw this.createError({
        code: 'REF_NOT_FOUND',
        ref,
        message: `Ref "${ref}" has no backendNodeId — cannot locate element`,
      })
    }

    // Scroll into view
    await this.cdp(
      'DOM.scrollIntoViewIfNeeded',
      { backendNodeId: entry.backendNodeId },
      DEFAULT_CDP_TIMEOUT,
      context,
    )

    // Click for focus
    const boxResult = await this.getBoxModelByBackendNodeId(entry.backendNodeId, context)
    const { x, y } = this.boxCenter(boxResult)

    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    }, DEFAULT_CDP_TIMEOUT, context)
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    }, DEFAULT_CDP_TIMEOUT, context)

    // Small delay for focus
    await this.sleep(50, context, 'ref-type')

    // Visual decoration
    this.decorator?.showType().catch(this.noop)

    // Type character-by-character
    for (const char of text) {
      await this.cdp('Input.dispatchKeyEvent', {
        type: 'keyDown', text: char,
      }, DEFAULT_CDP_TIMEOUT, context)
      await this.cdp('Input.dispatchKeyEvent', {
        type: 'keyUp', text: char,
      }, DEFAULT_CDP_TIMEOUT, context)
    }

    // Auto re-snapshot
    await this.sleep(100, context, 'ref-type')
    return this.takeSnapshot(undefined, context)
  }

  /**
   * Invalidate the current snapshot after navigation.
   * Also resets the ref counter so refs start fresh on new pages.
   */
  private invalidateSnapshot(): void {
    this.snapshotState.invalidate()
    this.snapshotService?.resetRefCounter()
  }

  /**
   * Get box model using backendNodeId (not nodeId).
   *
   * Critical: backendNodeId is persistent across AX tree refreshes,
   * while nodeId can change. This is the key advantage of Snapshot-Ref.
   */
  private async getBoxModelByBackendNodeId(
    backendNodeId: number,
    context: BrowserExecutionContext,
  ): Promise<{ content: number[] }> {
    const result = await this.cdp('DOM.getBoxModel', {
      backendNodeId,
    }, DEFAULT_CDP_TIMEOUT, context) as {
      model: { content: number[] }
    }
    return result.model
  }

  // ── CDP Helpers ───────────────────────────────────────────────────

  /**
   * Send a CDP command with a bounded timeout.
   *
   * Every CDP call MUST be bounded to prevent hanging the SDK session.
   * If the debugger.sendCommand hangs (page unresponsive, webContents destroyed
   * mid-flight, etc.), the timeout rejects with a classified TIMEOUT error.
   */
  private async cdp(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs: number = DEFAULT_CDP_TIMEOUT,
    context: BrowserExecutionContext = {},
  ): Promise<unknown> {
    this.throwIfAborted(method, context)
    const effectiveTimeoutMs = this.resolveTimeoutMs(timeoutMs, context, method)
    let timer: ReturnType<typeof setTimeout> | null = null
    const t0 = Date.now()
    let abortCleanup: (() => void) | null = null
    log.debug(`cdp(): sending "${method}" (timeout=${effectiveTimeoutMs}ms)`)

    try {
      const pending = [
        this.webContents.debugger.sendCommand(method, params),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            log.warn(`cdp(): "${method}" TIMED OUT after ${effectiveTimeoutMs}ms`)
            reject(this.createError({
              code: 'TIMEOUT',
              action: method,
              timeoutMs: effectiveTimeoutMs,
              message: `CDP command "${method}" timed out after ${effectiveTimeoutMs}ms`,
            }))
          }, effectiveTimeoutMs)
        }),
      ] as Array<Promise<unknown>>
      if (context.signal) {
        pending.push(
          new Promise<never>((_resolve, reject) => {
            const onAbort = () =>
              reject(this.createError({
                code: 'ABORTED',
                action: method,
                message: `CDP command "${method}" was aborted`,
              }))
            context.signal!.addEventListener('abort', onAbort, { once: true })
            abortCleanup = () => context.signal?.removeEventListener('abort', onAbort)
          }),
        )
      }

      const result = await Promise.race(pending)
      log.debug(`cdp(): "${method}" completed in ${Date.now() - t0}ms`)
      return result
    } catch (err) {
      if (this.isBrowserError(err)) throw err
      throw this.classifyError(err, method)
    } finally {
      if (timer !== null) clearTimeout(timer)
      if (abortCleanup) abortCleanup()
    }
  }

  private async resolveSelector(selector: string, context: BrowserExecutionContext): Promise<number> {
    const doc = await this.cdp('DOM.getDocument', {}, DEFAULT_CDP_TIMEOUT, context) as { root: { nodeId: number } }
    const result = await this.cdp('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector,
    }, DEFAULT_CDP_TIMEOUT, context) as { nodeId: number }

    if (!result.nodeId) {
      throw this.createError({
        code: 'SELECTOR_NOT_FOUND',
        selector,
        message: `Element not found: ${selector}`,
      })
    }

    return result.nodeId
  }

  private async getBoxModel(nodeId: number, context: BrowserExecutionContext): Promise<{ content: number[] }> {
    const result = await this.cdp('DOM.getBoxModel', { nodeId }, DEFAULT_CDP_TIMEOUT, context) as {
      model: { content: number[] }
    }
    return result.model
  }

  private boxCenter(box: { content: number[] }): { x: number; y: number } {
    // content quad: [x1,y1, x2,y2, x3,y3, x4,y4]
    const q = box.content
    return {
      x: (q[0] + q[2] + q[4] + q[6]) / 4,
      y: (q[1] + q[3] + q[5] + q[7]) / 4,
    }
  }

  /**
   * Wait for page load with protection against the "lost wakeup" problem.
   *
   * The classic bug: if navigation completes BEFORE we register event listeners
   * (e.g. SPA hash navigation, or very fast local pages), the event fires into
   * the void and we hang until the safety timeout.
   *
   * Fix: register listeners FIRST, then immediately check `isLoading()`.
   * If the page already finished loading, resolve synchronously.
   * The `resolved` flag ensures exactly-once resolution regardless of which
   * path triggers first (event, already-loaded check, or safety timeout).
   */
  private waitForLoad(timeoutMs: number = NAVIGATION_TIMEOUT, context: BrowserExecutionContext = {}): Promise<void> {
    this.throwIfAborted('wait-for-load', context)
    const effectiveTimeoutMs = this.resolveTimeoutMs(timeoutMs, context, 'wait-for-load')

    return new Promise<void>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      let abortCleanup: (() => void) | null = null

      const cleanup = (): void => {
        this.webContents.removeListener('did-finish-load', onFinish)
        this.webContents.removeListener('did-fail-load', onFail)
        if (timer !== null) clearTimeout(timer)
        if (abortCleanup) abortCleanup()
      }

      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        cleanup()
        fn()
      }

      const onFinish = (): void => settle(() => resolve())
      const onFail = (): void => settle(() => resolve())

      this.webContents.on('did-finish-load', onFinish)
      this.webContents.on('did-fail-load', onFail)

      timer = setTimeout(() => {
        settle(() =>
          reject(
            this.createError({
              code: 'TIMEOUT',
              action: 'wait-for-load',
              timeoutMs: effectiveTimeoutMs,
              message: `Page load did not complete within ${effectiveTimeoutMs}ms`,
            }),
          ),
        )
      }, effectiveTimeoutMs)

      if (context.signal) {
        const onAbort = () =>
          settle(() =>
            reject(
              this.createError({
                code: 'ABORTED',
                action: 'wait-for-load',
                message: 'Page load wait was aborted',
              }),
            ),
          )
        context.signal.addEventListener('abort', onAbort, { once: true })
        abortCleanup = () => context.signal?.removeEventListener('abort', onAbort)
      }

      if (!this.webContents.isLoading()) {
        settle(() => resolve())
      }
    })
  }

  private sleep(ms: number, context: BrowserExecutionContext = {}, action: string = 'sleep'): Promise<void> {
    this.throwIfAborted(action, context)
    const effectiveMs = this.resolveTimeoutMs(ms, context, action)
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      let abortCleanup: (() => void) | null = null

      const cleanup = (): void => {
        if (timer !== null) clearTimeout(timer)
        if (abortCleanup) abortCleanup()
      }

      timer = setTimeout(() => {
        cleanup()
        resolve()
      }, effectiveMs)

      if (context.signal) {
        const onAbort = () => {
          cleanup()
          reject(
            this.createError({
              code: 'ABORTED',
              action,
              message: `Sleep for action "${action}" was aborted`,
            }),
          )
        }
        context.signal.addEventListener('abort', onAbort, { once: true })
        abortCleanup = () => context.signal?.removeEventListener('abort', onAbort)
      }
    })
  }

  /** Shared no-op catch handler for fire-and-forget decorator calls. */
  private noop = (): void => {}

  // ── State Machine ─────────────────────────────────────────────────

  private setState(state: ExecutorState): void {
    this._state = state
    this.onStateChange(state)
    log.debug(`Executor state: ${state}`)
  }

  private assertReady(): void {
    if (this._state !== 'ready') {
      throw this.createError({
        code: 'DEBUGGER_DETACHED',
        reason: this._state,
        message: `Executor is in "${this._state}" state, expected "ready"`,
      })
    }
  }

  private handleDetach = (_event: Electron.Event, reason: string): void => {
    log.warn(`Debugger detached: ${reason}`)
    this.setState('detached')
  }

  // ── Error Helpers ─────────────────────────────────────────────────

  private createError(error: BrowserError): BrowserError {
    return error
  }

  /** Type guard: check if a value is an already-classified BrowserError. */
  private isBrowserError(err: unknown): err is BrowserError {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      'message' in err &&
      typeof (err as BrowserError).code === 'string'
    )
  }

  private classifyError(err: unknown, context: string): BrowserError {
    const message = err instanceof Error ? err.message : String(err)

    if (message.includes('No node found') || message.includes('Could not find node')) {
      return { code: 'SELECTOR_NOT_FOUND', selector: context, message }
    }
    if (message.includes('Target closed') || message.includes('destroyed')) {
      return { code: 'PAGE_CRASHED', message }
    }
    if (message.includes('Cannot find context') || message.includes('Execution context')) {
      return { code: 'PAGE_CRASHED', message: `Page context lost: ${message}` }
    }
    if (message.includes('net::ERR_')) {
      return { code: 'NAVIGATION_FAILED', url: context, message }
    }
    if (message.includes('Debugger is not attached')) {
      return { code: 'DEBUGGER_DETACHED', reason: 'not_attached', message }
    }

    return { code: 'CDP_ERROR', method: context, message }
  }

  private resolveTimeoutMs(defaultTimeoutMs: number, context: BrowserExecutionContext, action: string): number {
    if (context.deadlineAt === undefined) return defaultTimeoutMs
    const remaining = context.deadlineAt - Date.now()
    if (remaining <= 0) {
      throw this.createError({
        code: 'TIMEOUT',
        action,
        timeoutMs: 0,
        message: `Action "${action}" exceeded deadline before execution`,
      })
    }
    return Math.max(1, Math.min(defaultTimeoutMs, remaining))
  }

  private throwIfAborted(action: string, context: BrowserExecutionContext): void {
    if (context.signal?.aborted) {
      throw this.createError({
        code: 'ABORTED',
        action,
        message: `Action "${action}" was aborted before execution`,
      })
    }
  }
}
