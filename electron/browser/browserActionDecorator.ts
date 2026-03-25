// SPDX-License-Identifier: Apache-2.0

/**
 * BrowserActionDecorator — CDP-injected visual feedback for browser actions.
 *
 * When the AI agent performs browser actions (click, scroll, screenshot, type,
 * navigate), this class injects lightweight DOM overlays directly into the page
 * via CDP `Runtime.evaluate`. This is the ONLY way to render visual effects on
 * top of a WebContentsView — React DOM cannot pierce the native Electron layer.
 *
 * Design principles:
 * - **Fire-and-forget**: Every public method returns a Promise but callers should
 *   NOT await it. Visual effects must never block or delay tool execution.
 * - **Self-cleaning**: Each visual element has a built-in animation + auto-removal
 *   timer, preventing DOM pollution.
 * - **Lazy overlay**: The root overlay container is created on first use and reset
 *   on full-page navigation.
 * - **Resilient**: All CDP failures are silently caught — a failed decoration is
 *   invisible to the user and does not affect the underlying action.
 *
 * Visual effects:
 *   showClick(x, y)     → Agent cursor glides to (x,y) + dual-ring ripple
 *   showType()           → Typing-glow highlight at last cursor position
 *   showScroll(dir)      → Directional arrow + edge gradient
 *   showScreenshot()     → Camera-shutter flash + border glow
 *   showNavigate()       → Top-edge progress bar
 *   startBorderGlow()    → Breathing edge glow (while agent is operating)
 *   stopBorderGlow()     → Fade out and remove border glow
 */

import type { WebContents } from 'electron'
import { createLogger } from '../platform/logger'

const log = createLogger('BrowserDecorator')

// ─── Duration Constants (ms) ──────────────────────────────────────────────
// Deliberately unhurried — visual feedback should be noticed, not blinked past.

const CURSOR_TRAVEL_MS = 500
const CURSOR_LINGER_MS = 1500
const CURSOR_FADE_MS = 600
const CLICK_RIPPLE_MS = 800
const CLICK_RIPPLE_OUTER_MS = 1000
const SCROLL_INDICATOR_MS = 1000
const SCREENSHOT_FLASH_MS = 400
const SCREENSHOT_SHUTTER_MS = 700
const TYPE_GLOW_MS = 1200
const NAVIGATE_PROGRESS_MS = 1200
const BORDER_GLOW_FADE_MS = 800
/** How long to keep the glow alive after the last command finishes.
 *  If a new command starts within this window the timer is cancelled,
 *  making the glow persist through a rapid sequence of actions. */
const BORDER_GLOW_LINGER_MS = 2500

// ─── Overlay Container IDs ────────────────────────────────────────────────

const OVERLAY_ID = '__oc_decorator__'
const STYLE_ID = '__oc_decorator_styles__'
const CURSOR_ID = '__oc_cursor'
const BORDER_GLOW_ID = '__oc_border_glow'

// ─── Agent Cursor SVG ─────────────────────────────────────────────────────
// Indigo-500 pointer with white stroke for contrast on any page background.

const CURSOR_SVG = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 1L4 15.5L8.5 11.5L13 18L15.5 16.5L11 10L16.5 9.5L4 1Z" fill="rgba(99,102,241,0.9)" stroke="white" stroke-width="1.2" stroke-linejoin="round"/></svg>`

// ─── Injected CSS ─────────────────────────────────────────────────────────
// All keyframes + base classes for visual effects. Injected once per page load.

const INJECTED_CSS = `
/* ── Agent cursor ── */
.__oc_cursor {
  position: absolute;
  width: 20px;
  height: 20px;
  pointer-events: none;
  transition: left ${CURSOR_TRAVEL_MS}ms cubic-bezier(0.4, 0, 0.2, 1),
              top ${CURSOR_TRAVEL_MS}ms cubic-bezier(0.4, 0, 0.2, 1),
              opacity ${CURSOR_FADE_MS}ms ease-out;
  z-index: 10;
  filter: drop-shadow(0 1px 3px rgba(0,0,0,0.25));
  will-change: left, top, opacity;
}
.__oc_cursor svg { width: 100%; height: 100%; }
.__oc_cursor--fading { opacity: 0 !important; }

/* ── Click ripple — inner ring ── */
@keyframes __oc_ripple {
  0%   { transform: translate(-50%, -50%) scale(0); opacity: 0.55; }
  100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
}
.__oc_ripple {
  position: absolute;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 2px solid rgba(99, 102, 241, 0.55);
  pointer-events: none;
  animation: __oc_ripple ${CLICK_RIPPLE_MS}ms cubic-bezier(0, 0, 0.2, 1) forwards;
}

/* ── Click ripple — outer ring (delayed, larger) ── */
.__oc_ripple--outer {
  width: 64px;
  height: 64px;
  border-width: 1.5px;
  border-color: rgba(99, 102, 241, 0.25);
  animation-delay: 100ms;
  animation-duration: ${CLICK_RIPPLE_OUTER_MS}ms;
}

/* ── Scroll direction arrow ── */
@keyframes __oc_scroll_in {
  0%   { opacity: 0; transform: translateX(-50%) scale(0.7); }
  25%  { opacity: 0.7; transform: translateX(-50%) scale(1); }
  100% { opacity: 0; transform: translateX(-50%) translateY(var(--oc-shift, 0)) scale(0.95); }
}
.__oc_scroll_arrow {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
  animation: __oc_scroll_in ${SCROLL_INDICATOR_MS}ms ease-out forwards;
}
.__oc_scroll_arrow svg {
  width: 32px;
  height: 32px;
  color: rgba(99, 102, 241, 0.6);
  filter: drop-shadow(0 0 10px rgba(99, 102, 241, 0.3));
}

/* ── Scroll edge gradient ── */
@keyframes __oc_gradient_fade {
  0%   { opacity: 0.7; }
  100% { opacity: 0; }
}
.__oc_scroll_grad {
  position: absolute;
  left: 0;
  right: 0;
  height: 80px;
  pointer-events: none;
  animation: __oc_gradient_fade ${SCROLL_INDICATOR_MS}ms ease-out forwards;
}
.__oc_scroll_grad--down {
  bottom: 0;
  background: linear-gradient(to top, rgba(99, 102, 241, 0.1), transparent);
}
.__oc_scroll_grad--up {
  top: 0;
  background: linear-gradient(to bottom, rgba(99, 102, 241, 0.1), transparent);
}

/* ── Screenshot flash ── */
@keyframes __oc_flash {
  0%   { opacity: 0; }
  12%  { opacity: 0.15; }
  100% { opacity: 0; }
}
.__oc_flash {
  position: absolute;
  inset: 0;
  background: white;
  pointer-events: none;
  animation: __oc_flash ${SCREENSHOT_FLASH_MS}ms ease-out forwards;
}

/* ── Screenshot shutter border ── */
@keyframes __oc_shutter {
  0%   { border-color: rgba(99, 102, 241, 0.5); opacity: 1; }
  100% { border-color: rgba(99, 102, 241, 0); opacity: 0; }
}
.__oc_shutter {
  position: absolute;
  inset: 4px;
  border: 2.5px solid rgba(99, 102, 241, 0.5);
  border-radius: 6px;
  pointer-events: none;
  animation: __oc_shutter ${SCREENSHOT_SHUTTER_MS}ms ease-out forwards;
}

/* ── Type glow ── */
@keyframes __oc_type_glow {
  0%   { box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.35), 0 0 16px rgba(99, 102, 241, 0.18); }
  100% { box-shadow: 0 0 0 3px rgba(99, 102, 241, 0),   0 0 16px rgba(99, 102, 241, 0); }
}
.__oc_type_glow {
  position: absolute;
  width: 28px;
  height: 22px;
  border-radius: 4px;
  pointer-events: none;
  animation: __oc_type_glow ${TYPE_GLOW_MS}ms ease-out forwards;
}

/* ── Navigate progress bar ── */
@keyframes __oc_nav_progress {
  0%   { width: 0; opacity: 1; }
  50%  { width: 55%; opacity: 1; }
  100% { width: 100%; opacity: 0; }
}
.__oc_nav_bar {
  position: absolute;
  top: 0;
  left: 0;
  height: 2.5px;
  background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.6), transparent);
  pointer-events: none;
  animation: __oc_nav_progress ${NAVIGATE_PROGRESS_MS}ms ease-out forwards;
}

/* ── Breathing border glow (active while agent is operating) ── */
@keyframes __oc_border_breathe {
  0%, 100% {
    box-shadow: inset 0 0 35px 8px rgba(99, 102, 241, 0.05);
  }
  50% {
    box-shadow: inset 0 0 55px 18px rgba(99, 102, 241, 0.1);
  }
}
.__oc_border_glow {
  position: absolute;
  inset: 0;
  border-radius: 2px;
  pointer-events: none;
  animation: __oc_border_breathe 2.8s ease-in-out infinite;
  transition: opacity ${BORDER_GLOW_FADE_MS}ms ease-out;
}
.__oc_border_glow--fading {
  animation: none !important;
  opacity: 0 !important;
}
`.trim()

// ─── Scroll Arrow SVGs ────────────────────────────────────────────────────

const ARROW_DOWN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12l7 7 7-7"/></svg>`
const ARROW_UP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`

// ─── Decorator Class ──────────────────────────────────────────────────────

export class BrowserActionDecorator {
  /** Last known cursor position (persists across actions within the same page). */
  private lastX = -1
  private lastY = -1

  /** Whether the overlay container has been injected into the current page. */
  private overlayReady = false

  /** Pending cursor-fade timer — cleared when a new action arrives. */
  private cursorFadeTimer: ReturnType<typeof setTimeout> | null = null

  /** Whether the border glow is currently visible. */
  private borderGlowActive = false

  /** Debounce timer — schedules the deferred stop after the last command. */
  private borderGlowLingerTimer: ReturnType<typeof setTimeout> | null = null

  /** Timer to auto-remove the border glow element after fade-out completes. */
  private borderGlowRemoveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly webContents: WebContents) {
    // Full navigation destroys the page DOM → reset overlay state.
    this.webContents.on('did-navigate', this.resetOverlay)
    // SPA hash/history navigations preserve the DOM — no reset needed.
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Click decoration: smooth cursor glide + dual-ring ripple.
   *
   * Called from BrowserActionExecutor.click() AFTER getBoxModel/boxCenter
   * computes (x, y) but BEFORE the actual Input.dispatchMouseEvent.
   */
  async showClick(x: number, y: number): Promise<void> {
    try {
      await this.ensureOverlay()
      await this.moveCursorTo(x, y)
      // Wait for cursor to arrive before ripple
      await this.sleep(CURSOR_TRAVEL_MS)
      await this.injectJS(`
        (function(){
          var c=document.getElementById('${OVERLAY_ID}');
          if(!c)return;
          var r1=document.createElement('div');
          r1.className='__oc_ripple';
          r1.style.left='${x}px';r1.style.top='${y}px';
          c.appendChild(r1);
          var r2=document.createElement('div');
          r2.className='__oc_ripple __oc_ripple--outer';
          r2.style.left='${x}px';r2.style.top='${y}px';
          c.appendChild(r2);
          setTimeout(function(){r1.remove();r2.remove()},${CLICK_RIPPLE_OUTER_MS + 200});
        })()
      `)
      this.scheduleCursorFade()
    } catch (err) {
      log.debug('showClick decoration failed (non-blocking):', err)
    }
  }

  /**
   * Type decoration: glow highlight at the current cursor position.
   *
   * Called from BrowserActionExecutor.type() AFTER the initial click()
   * (which already triggered showClick), so the cursor is already at
   * the target element. We simply add a typing-glow effect.
   */
  async showType(): Promise<void> {
    if (this.lastX === -1) return
    try {
      await this.ensureOverlay()
      // Cancel cursor fade — keep cursor visible during typing.
      this.cancelCursorFade()
      await this.injectJS(`
        (function(){
          var c=document.getElementById('${OVERLAY_ID}');
          if(!c)return;
          var g=document.createElement('div');
          g.className='__oc_type_glow';
          g.style.left='${this.lastX - 14}px';
          g.style.top='${this.lastY - 11}px';
          c.appendChild(g);
          setTimeout(function(){g.remove()},${TYPE_GLOW_MS + 100});
        })()
      `)
      this.scheduleCursorFade()
    } catch (err) {
      log.debug('showType decoration failed (non-blocking):', err)
    }
  }

  /**
   * Scroll decoration: directional arrow + edge gradient.
   */
  async showScroll(direction: 'up' | 'down'): Promise<void> {
    try {
      await this.ensureOverlay()
      const isDown = direction === 'down'
      const arrowSvg = isDown ? ARROW_DOWN_SVG : ARROW_UP_SVG
      const posStyle = isDown ? 'top:40%' : 'bottom:40%'
      const shiftVal = isDown ? '16px' : '-16px'

      await this.injectJS(`
        (function(){
          var c=document.getElementById('${OVERLAY_ID}');
          if(!c)return;
          var a=document.createElement('div');
          a.className='__oc_scroll_arrow';
          a.style.cssText='${posStyle}';
          a.style.setProperty('--oc-shift','${shiftVal}');
          a.innerHTML='${arrowSvg}';
          c.appendChild(a);
          var g=document.createElement('div');
          g.className='__oc_scroll_grad __oc_scroll_grad--${direction}';
          c.appendChild(g);
          setTimeout(function(){a.remove();g.remove()},${SCROLL_INDICATOR_MS + 150});
        })()
      `)
    } catch (err) {
      log.debug('showScroll decoration failed (non-blocking):', err)
    }
  }

  /**
   * Screenshot decoration: camera flash + shutter border.
   */
  async showScreenshot(): Promise<void> {
    try {
      await this.ensureOverlay()
      await this.injectJS(`
        (function(){
          var c=document.getElementById('${OVERLAY_ID}');
          if(!c)return;
          var f=document.createElement('div');
          f.className='__oc_flash';
          c.appendChild(f);
          var s=document.createElement('div');
          s.className='__oc_shutter';
          c.appendChild(s);
          setTimeout(function(){f.remove();s.remove()},${SCREENSHOT_SHUTTER_MS + 300});
        })()
      `)
    } catch (err) {
      log.debug('showScreenshot decoration failed (non-blocking):', err)
    }
  }

  /**
   * Navigate decoration: subtle top-edge progress bar.
   */
  async showNavigate(): Promise<void> {
    try {
      await this.ensureOverlay()
      await this.injectJS(`
        (function(){
          var c=document.getElementById('${OVERLAY_ID}');
          if(!c)return;
          var b=document.createElement('div');
          b.className='__oc_nav_bar';
          c.appendChild(b);
          setTimeout(function(){b.remove()},${NAVIGATE_PROGRESS_MS + 200});
        })()
      `)
    } catch (err) {
      log.debug('showNavigate decoration failed (non-blocking):', err)
    }
  }

  // ── Snapshot-Ref Decorations ─────────────────────────────────────────

  /**
   * Snapshot decoration: scan line + ref count badge.
   *
   * Called from BrowserActionExecutor.takeSnapshot() after a successful snapshot.
   * Shows a horizontal scan line sweeping across the page + a brief badge
   * in the top-right showing how many refs were found.
   */
  async showSnapshot(refCount: number): Promise<void> {
    try {
      await this.ensureOverlay()
      await this.injectJS(`
        (function(){
          var c=document.getElementById('${OVERLAY_ID}');
          if(!c)return;

          // Scan line
          var sl=document.createElement('div');
          sl.style.cssText='position:absolute;top:0;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,rgba(99,102,241,0.6),transparent);pointer-events:none;animation:__oc_nav_progress 600ms ease-out forwards;';
          c.appendChild(sl);

          // Badge
          var b=document.createElement('div');
          b.style.cssText='position:absolute;top:8px;right:8px;padding:4px 10px;border-radius:12px;background:rgba(99,102,241,0.9);color:#fff;font-size:12px;font-family:system-ui,sans-serif;font-weight:600;pointer-events:none;opacity:0;transform:translateY(-4px);transition:opacity 0.2s,transform 0.2s;';
          b.textContent='${refCount} refs';
          c.appendChild(b);

          requestAnimationFrame(function(){
            b.style.opacity='1';
            b.style.transform='translateY(0)';
          });

          setTimeout(function(){
            b.style.opacity='0';
            b.style.transform='translateY(-4px)';
            sl.style.opacity='0';
            setTimeout(function(){sl.remove();b.remove()},300);
          },1500);
        })()
      `)
    } catch (err) {
      log.debug('showSnapshot decoration failed (non-blocking):', err)
    }
  }

  /**
   * Ref-click decoration: cursor glide + ripple + floating ref label.
   *
   * Reuses the existing cursor + ripple system from showClick(),
   * then adds a floating label showing "[ref] name" near the click point.
   */
  async showRefClick(ref: string, name: string, x: number, y: number): Promise<void> {
    try {
      // Reuse existing cursor + ripple
      await this.showClick(x, y)

      // Additional: floating ref label
      // Use JSON.stringify for safe escaping of user-derived content (XSS prevention).
      const safeLabel = JSON.stringify(`[${ref}] ${name}`)
      await this.injectJS(`
        (function(){
          var c=document.getElementById('${OVERLAY_ID}');
          if(!c)return;
          var label=document.createElement('div');
          label.style.cssText='position:absolute;left:${x}px;top:${y - 24}px;padding:2px 8px;border-radius:6px;background:rgba(99,102,241,0.9);color:#fff;font-size:11px;font-family:system-ui,sans-serif;font-weight:600;white-space:nowrap;pointer-events:none;opacity:1;transform:translateY(0);transition:opacity 0.4s ease-out,transform 0.4s ease-out;';
          label.textContent=${safeLabel};
          c.appendChild(label);
          setTimeout(function(){
            label.style.opacity='0';
            label.style.transform='translateY(-8px)';
            setTimeout(function(){label.remove()},400);
          },1200);
        })()
      `)
    } catch (err) {
      log.debug('showRefClick decoration failed (non-blocking):', err)
    }
  }

  // ── Border Glow (breathing edge halo) ──────────────────────────────

  /**
   * Show a continuous breathing glow around the viewport edges.
   *
   * Called by BrowserService when a command starts executing. If the glow
   * is already active (or lingering from a previous command), this is a
   * no-op — the existing animation simply continues uninterrupted.
   *
   * Any pending linger/fade timer from `deferStopBorderGlow()` is cancelled
   * so the glow stays alive through rapid-fire command sequences.
   */
  async startBorderGlow(): Promise<void> {
    // Cancel any pending deferred stop — a new command arrived, keep breathing.
    this.clearBorderGlowTimers()

    if (this.borderGlowActive) return
    try {
      await this.ensureOverlay()
      await this.injectJS(`
        (function(){
          var c=document.getElementById('${OVERLAY_ID}');
          if(!c)return;
          var existing=document.getElementById('${BORDER_GLOW_ID}');
          if(existing){
            existing.classList.remove('__oc_border_glow--fading');
            return;
          }
          var g=document.createElement('div');
          g.id='${BORDER_GLOW_ID}';
          g.className='__oc_border_glow';
          c.appendChild(g);
        })()
      `)
      this.borderGlowActive = true
    } catch (err) {
      log.debug('startBorderGlow failed (non-blocking):', err)
    }
  }

  /**
   * Schedule the border glow to fade out after a linger period.
   *
   * Instead of stopping immediately when a command finishes, we wait
   * `BORDER_GLOW_LINGER_MS` (2.5 s). If another command starts within
   * that window, `startBorderGlow()` cancels the timer and the glow
   * continues seamlessly — giving a smooth, unbroken aura during a
   * rapid sequence of agent actions (navigate → extract → click → type).
   *
   * Timeline:
   *   cmd1 start → glow ON
   *   cmd1 end   → schedule fade (2.5 s)
   *   cmd2 start → cancel timer, glow stays ON
   *   cmd2 end   → schedule fade (2.5 s)
   *   ...no more commands...
   *   +2.5 s     → CSS fade out (800 ms)
   *   +3.3 s     → DOM element removed
   */
  deferStopBorderGlow(): void {
    // Cancel any previous linger timer (command rapid-fire).
    this.clearBorderGlowTimers()

    if (!this.borderGlowActive) return

    this.borderGlowLingerTimer = setTimeout(() => {
      this.borderGlowLingerTimer = null
      this.borderGlowActive = false

      // Start CSS fade
      this.injectJS(`
        (function(){
          var g=document.getElementById('${BORDER_GLOW_ID}');
          if(g)g.classList.add('__oc_border_glow--fading');
        })()
      `).catch(() => {})

      // Remove DOM element after CSS fade completes
      this.borderGlowRemoveTimer = setTimeout(() => {
        this.borderGlowRemoveTimer = null
        this.injectJS(`
          (function(){
            var g=document.getElementById('${BORDER_GLOW_ID}');
            if(g)g.remove();
          })()
        `).catch(() => {})
      }, BORDER_GLOW_FADE_MS + 100)
    }, BORDER_GLOW_LINGER_MS)
  }

  /** Cancel all pending border-glow timers. */
  private clearBorderGlowTimers(): void {
    if (this.borderGlowLingerTimer !== null) {
      clearTimeout(this.borderGlowLingerTimer)
      this.borderGlowLingerTimer = null
    }
    if (this.borderGlowRemoveTimer !== null) {
      clearTimeout(this.borderGlowRemoveTimer)
      this.borderGlowRemoveTimer = null
    }
  }

  /**
   * Clean up event listeners. Called when the view is closed.
   */
  dispose(): void {
    this.cancelCursorFade()
    this.clearBorderGlowTimers()
    this.webContents.removeListener('did-navigate', this.resetOverlay)
    this.overlayReady = false
    this.borderGlowActive = false
    this.lastX = -1
    this.lastY = -1
  }

  // ── Private ────────────────────────────────────────────────────────

  /**
   * Ensure the overlay container + stylesheet exist in the page.
   * Idempotent — safe to call repeatedly. The first call creates the
   * container; subsequent calls are a JS-side no-op check.
   */
  private async ensureOverlay(): Promise<void> {
    if (this.overlayReady) return

    await this.injectJS(`
      (function(){
        if(document.getElementById('${OVERLAY_ID}'))return;
        var el=document.createElement('div');
        el.id='${OVERLAY_ID}';
        el.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden;';
        document.documentElement.appendChild(el);
        if(!document.getElementById('${STYLE_ID}')){
          var s=document.createElement('style');
          s.id='${STYLE_ID}';
          s.textContent=${JSON.stringify(INJECTED_CSS)};
          document.head.appendChild(s);
        }
      })()
    `)
    this.overlayReady = true
  }

  /**
   * Move the agent cursor to (x, y) with a smooth CSS transition.
   * On first appearance the cursor slides in from a slight offset to
   * avoid a jarring "teleport" effect.
   */
  private async moveCursorTo(x: number, y: number): Promise<void> {
    const fromX = this.lastX === -1 ? x + 40 : this.lastX
    const fromY = this.lastY === -1 ? y - 30 : this.lastY

    this.cancelCursorFade()

    await this.injectJS(`
      (function(){
        var c=document.getElementById('${OVERLAY_ID}');
        if(!c)return;
        var cur=document.getElementById('${CURSOR_ID}');
        if(!cur){
          cur=document.createElement('div');
          cur.id='${CURSOR_ID}';
          cur.className='__oc_cursor';
          cur.innerHTML=${JSON.stringify(CURSOR_SVG)};
          cur.style.left='${fromX}px';
          cur.style.top='${fromY}px';
          cur.style.opacity='0';
          c.appendChild(cur);
          cur.offsetHeight;
        }
        cur.classList.remove('__oc_cursor--fading');
        cur.style.opacity='1';
        cur.style.left='${x}px';
        cur.style.top='${y}px';
      })()
    `)

    this.lastX = x
    this.lastY = y
  }

  /**
   * Schedule the cursor to fade out after the linger period.
   * Cancelled and re-scheduled on each new action.
   */
  private scheduleCursorFade(): void {
    this.cancelCursorFade()
    this.cursorFadeTimer = setTimeout(() => {
      this.injectJS(`
        (function(){
          var cur=document.getElementById('${CURSOR_ID}');
          if(cur)cur.classList.add('__oc_cursor--fading');
        })()
      `).catch(() => {})
    }, CURSOR_LINGER_MS)
  }

  private cancelCursorFade(): void {
    if (this.cursorFadeTimer !== null) {
      clearTimeout(this.cursorFadeTimer)
      this.cursorFadeTimer = null
    }
  }

  /**
   * Low-level CDP injection. Uses the existing debugger connection
   * (shared with BrowserActionExecutor).
   */
  private async injectJS(code: string): Promise<void> {
    if (this.webContents.isDestroyed()) return
    try {
      await this.webContents.debugger.sendCommand('Runtime.evaluate', {
        expression: code,
        returnByValue: false,
      })
    } catch {
      // CDP may fail if page navigated or debugger detached — non-blocking, ignore.
      this.overlayReady = false
    }
  }

  private readonly resetOverlay = (): void => {
    this.overlayReady = false
    this.borderGlowActive = false
    // Keep lastX/lastY — cursor will animate from its previous position
    // to the new target on the next page (smooth cross-navigation feel).
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
