// SPDX-License-Identifier: Apache-2.0

import { BrowserWindow, Tray, screen } from 'electron'
import { join } from 'path'

export interface TrayPopoverConfig {
  /** Popover width in logical pixels */
  width: number
  /** Maximum popover height in logical pixels */
  maxHeight: number
  /** The Tray instance to anchor the popover to */
  tray: Tray
}

const DEFAULT_CONFIG: Omit<TrayPopoverConfig, 'tray'> = {
  width: 320,
  maxHeight: 480,
}

/** Duration of the popover exit animation (must match CSS `.popover-exit`). */
const EXIT_ANIMATION_MS = 120

/**
 * Manages a frameless, vibrancy-enabled BrowserWindow that acts as
 * a tray popover. Anchored below the macOS menu bar tray icon.
 *
 * Responsibilities:
 * - Window lifecycle (create / show / hide / destroy)
 * - Positioning relative to the tray icon
 * - Dynamic height via public `resize()` (called from IPC handler)
 * - Auto-hide on blur with exit animation
 */
export class TrayPopoverWindow {
  private win: BrowserWindow | null = null
  private readonly config: TrayPopoverConfig
  private currentHeight: number
  /** Timer for delayed hide after exit animation. Cleared on re-show to prevent race conditions. */
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  constructor(config: TrayPopoverConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.currentHeight = this.config.maxHeight
  }

  /** Create the BrowserWindow (idempotent — no-op if already exists). */
  create(): void {
    if (this.win) return

    this.win = new BrowserWindow({
      width: this.config.width,
      height: this.currentHeight,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      vibrancy: 'popover',
      visualEffectState: 'active',
      transparent: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    // Auto-hide when focus leaves
    this.win.on('blur', () => {
      this.hide()
    })

    // Load the popover renderer
    if (process.env.ELECTRON_RENDERER_URL) {
      this.win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/tray-popover.html`)
    } else {
      this.win.loadFile(join(__dirname, '../renderer/tray-popover.html'))
    }
  }

  /** Toggle visibility. */
  toggle(): void {
    if (!this.win) {
      this.create()
    }
    if (this.win!.isVisible()) {
      this.hide()
    } else {
      this.show()
    }
  }

  /** Show and reposition the popover below the tray icon. */
  show(): void {
    // Cancel any pending hide (e.g. user re-clicked tray during exit animation)
    this.cancelPendingHide()

    if (!this.win) this.create()
    this.reposition()
    this.win!.show()
    this.win!.focus()
  }

  /**
   * Hide the popover with exit animation.
   * Sends a `tray-popover:will-hide` event to the renderer, waits for the
   * exit animation to complete, then actually hides the window.
   */
  hide(): void {
    if (!this.win || this.win.isDestroyed() || !this.win.isVisible()) return
    if (this.hideTimer) return // already in exit animation

    // Notify renderer to start exit animation
    this.win.webContents.send('tray-popover:will-hide')

    // Actually hide after animation completes
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      if (this.win && !this.win.isDestroyed()) {
        this.win.hide()
      }
    }, EXIT_ANIMATION_MS)
  }

  /** Dynamically set the popover height (clamped to config bounds). */
  resize(height: number): void {
    if (!this.win || this.win.isDestroyed()) return
    const clamped = Math.min(Math.max(height, 100), this.config.maxHeight)
    this.currentHeight = clamped
    const bounds = this.win.getBounds()
    this.win.setBounds({ ...bounds, height: clamped })
  }

  /** Returns true if the popover window exists and is visible. */
  get isVisible(): boolean {
    return this.win !== null && !this.win.isDestroyed() && this.win.isVisible()
  }

  /** Returns the BrowserWindow instance (or null). */
  get window(): BrowserWindow | null {
    return this.win
  }

  /**
   * Reposition the popover centered below the tray icon,
   * clamped to the display bounds.
   */
  private reposition(): void {
    if (!this.win) return

    const trayBounds = this.config.tray.getBounds()
    const display = screen.getDisplayNearestPoint({
      x: trayBounds.x + trayBounds.width / 2,
      y: trayBounds.y + trayBounds.height / 2,
    })

    const { width, height } = this.win.getBounds()
    const { x: workX, width: workW } = display.workArea

    // Center horizontally on tray icon
    let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2)
    // Directly below tray icon
    const y = Math.round(trayBounds.y + trayBounds.height + 4)

    // Clamp to display work area
    if (x + width > workX + workW) {
      x = workX + workW - width - 8
    }
    if (x < workX) {
      x = workX + 8
    }

    this.win.setBounds({ x, y, width, height })
  }

  /** Cancel a pending animated hide (e.g. when re-showing during exit animation). */
  private cancelPendingHide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }

  /** Destroy the popover window. */
  destroy(): void {
    this.cancelPendingHide()
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy()
    }
    this.win = null
  }
}
