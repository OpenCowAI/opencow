// SPDX-License-Identifier: Apache-2.0

import { Tray, Menu, nativeImage, app, shell } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { DataBus } from './core/dataBus'
import type { SupportedLocale } from '@shared/i18n'
import { getMenuLabels } from './i18n'
import { TrayPopoverWindow } from './trayPopoverWindow'
import { focusMainWindow as focusMainWin } from './window/windowManager'
import type { TrayIssueService } from './services/trayIssueService'
import type { UpdateCheckerService } from './services/update'
import type { TrayIssueItem } from '@shared/types'
import { createLogger } from './platform/logger'

const log = createLogger('TrayManager')

function resolveTrayIconPath(): string | null {
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, 'tray.png'),
        join(process.resourcesPath, 'resources', 'tray.png'),
        join(process.resourcesPath, 'app.asar', 'resources', 'tray.png'),
        join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'tray.png'),
      ]
    : [
        join(process.cwd(), 'resources', 'tray.png'),
        join(__dirname, '../../resources/tray.png'),
      ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export interface TrayManagerOptions {
  appDisplayName: string
  /** Custom quit handler (e.g. double-press confirmation). Falls back to app.quit(). */
  onQuit?: () => void
}

export class TrayManager {
  private tray: Tray | null = null
  private popover: TrayPopoverWindow | null = null
  private bus: DataBus
  private unsubscribe: (() => void) | null = null
  private readonly appDisplayName: string
  private readonly onQuit: () => void
  private currentLocale: SupportedLocale = 'en-US'
  private trayIssueService: TrayIssueService | null = null
  private updateChecker: UpdateCheckerService | null = null
  /** URL to latest release page — set when an update is detected. */
  private latestReleaseUrl: string | null = null
  /** Cached tray items — updated on DataBus events, served to popover on demand. */
  private cachedTrayItems: TrayIssueItem[] = []
  /** Debounce timer for refreshTrayItems — coalesces rapid DataBus events. */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly REFRESH_DEBOUNCE_MS = 300

  constructor(bus: DataBus, options: TrayManagerOptions) {
    this.bus = bus
    this.appDisplayName = options.appDisplayName
    this.onQuit = options.onQuit ?? (() => app.quit())
  }

  /** Inject the TrayIssueService after construction (avoids circular deps). */
  setTrayIssueService(service: TrayIssueService): void {
    this.trayIssueService = service
  }

  /** Inject the UpdateCheckerService for tray menu integration. */
  setUpdateChecker(checker: UpdateCheckerService): void {
    this.updateChecker = checker
  }

  /** Returns the TrayPopoverWindow instance (for IPC handler wiring). */
  get popoverWindow(): TrayPopoverWindow | null {
    return this.popover
  }

  /** Get the cached tray issue items (for IPC initial load). */
  getTrayItems(): TrayIssueItem[] {
    return this.cachedTrayItems
  }

  /** Update locale in-place without destroying tray/popover/subscriptions. */
  updateLocale(locale: SupportedLocale): void {
    this.currentLocale = locale
    if (!this.tray) return
    const labels = getMenuLabels(locale)
    this.tray.setToolTip(`${this.appDisplayName} - ${labels.trayTooltip}`)
    // Right-click menu is built dynamically in tray.on('right-click'),
    // so it will automatically use the new locale on next right-click.
  }

  create(): void {
    const trayIconPath = resolveTrayIconPath()
    let icon = nativeImage.createEmpty()

    if (trayIconPath) {
      icon = nativeImage.createFromPath(trayIconPath)
      // Some packaged setups fail to decode PNG directly from asar paths.
      // Fall back to buffer loading, which works with Electron's asar fs shim.
      if (icon.isEmpty()) {
        try {
          icon = nativeImage.createFromBuffer(readFileSync(trayIconPath))
        } catch (error) {
          log.warn('Failed to load tray icon from file buffer', error)
        }
      }
    }

    if (icon.isEmpty()) {
      log.warn(`Tray icon load failed; path=${trayIconPath ?? 'not found'}`)
    }

    this.tray = new Tray(icon)
    this.tray.setTitle('CC')

    const labels = getMenuLabels(this.currentLocale)
    this.tray.setToolTip(`${this.appDisplayName} - ${labels.trayTooltip}`)

    // Create popover window (lazy — BrowserWindow created on first show)
    this.popover = new TrayPopoverWindow({
      tray: this.tray,
      width: 320,
      maxHeight: 480,
    })

    // Left click → toggle custom popover
    this.tray.on('click', () => {
      this.popover?.toggle()
    })

    // Right click → native fallback menu with update status (uses currentLocale dynamically)
    this.tray.on('right-click', () => {
      if (!this.tray) return
      const m = getMenuLabels(this.currentLocale)
      const template: Electron.MenuItemConstructorOptions[] = [
        { label: this.appDisplayName, enabled: false },
        { type: 'separator' },
      ]

      // Update items (dynamic based on state)
      if (this.latestReleaseUrl) {
        template.push({
          label: `↑ ${m.trayUpdateAvailable}`,
          click: () => { void shell.openExternal(this.latestReleaseUrl!) },
        })
        template.push({ type: 'separator' })
      }

      template.push(
        { label: m.trayOpen, click: () => this.focusMainWindow() },
        {
          label: m.trayCheckForUpdates,
          click: () => { void this.updateChecker?.checkNow() },
        },
        { type: 'separator' },
        { label: m.trayQuit, click: () => this.onQuit() },
      )

      const contextMenu = Menu.buildFromTemplate(template)
      this.tray.popUpContextMenu(contextMenu)
    })

    // Update tray title + issue items when state changes
    this.refreshTrayItems().catch((err) => log.error('Failed initial tray refresh', err))
    this.unsubscribe = this.bus.onBroadcast((event) => {
      // Track update availability for tray menu
      if (event.type === 'update:check-result') {
        this.latestReleaseUrl = event.payload.status === 'available'
          ? event.payload.releaseUrl
          : null
      }

      // Only recompute on events that can affect tray data.
      // Note: 'sessions:updated' is intentionally excluded — it reflects file-system
      // session scans, not managed session state changes.
      if (
        event.type === 'command:session:created' ||
        event.type === 'command:session:updated' ||
        event.type === 'command:session:idle' ||
        event.type === 'command:session:stopped' ||
        event.type === 'command:session:error' ||
        event.type === 'command:session:deleted' ||
        event.type === 'issues:invalidated'
      ) {
        this.scheduleRefresh()
      }
    })
  }

  /** Hide the popover (called from IPC or externally). */
  hidePopover(): void {
    this.popover?.hide()
  }

  /** Focus the main application window. */
  focusMainWindow(): void {
    this.hidePopover()
    focusMainWin()
  }

  /**
   * Navigate the main window to a specific Issue detail.
   * Hides the popover, focuses the main window, then dispatches
   * a DataBus event for the main renderer to handle.
   */
  navigateToIssue(issueId: string, projectId: string): void {
    this.focusMainWindow()
    this.bus.dispatch({
      type: 'tray:navigate-issue',
      payload: { issueId, projectId },
    })
  }

  /**
   * Debounce wrapper: coalesces rapid DataBus events into a single refresh.
   * Only the trailing edge fires — no redundant async computation.
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      this.refreshTrayItems().catch((err) => log.error('Failed to refresh tray items', err))
    }, TrayManager.REFRESH_DEBOUNCE_MS)
  }

  /** Update the tray title to show active/waiting issue counts. */
  private updateTrayTitle(): void {
    if (!this.tray) return

    // Use cached items for the badge — no async needed
    const items = this.cachedTrayItems
    const active = items.filter((i) => i.sessionStatus === 'active').length
    const waiting = items.filter((i) => i.sessionStatus === 'waiting').length

    this.tray.setTitle(`${active}A ${waiting}W`)
  }

  /** Recompute tray issue items and broadcast to tray popover. */
  private async refreshTrayItems(): Promise<void> {
    if (!this.trayIssueService) return

    const items = await this.trayIssueService.getItems()
    this.cachedTrayItems = items

    // Update the tray title with fresh data
    this.updateTrayTitle()

    // Broadcast to all windows (tray popover will pick this up)
    this.bus.dispatch({
      type: 'tray:issues-updated',
      payload: { items },
    })
  }

  destroy(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.unsubscribe?.()
    this.popover?.destroy()
    this.popover = null
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }
}
