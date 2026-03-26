// SPDX-License-Identifier: Apache-2.0

import { app, BrowserWindow, dialog, nativeTheme, powerMonitor, session, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { DataBus } from './core/dataBus'
import { HookSource } from './sources/hookSource'
import { StatsSource } from './sources/statsSource'
import { TaskSource } from './sources/taskSource'
import { OnboardingStore } from './services/onboardingStore'
import { registerIPCHandlers, connectBusToIPC } from './ipc/channels'
import { TrayManager } from './tray'
import { NotificationService } from './services/notificationService'
import { createElectronNotificationSender } from './services/electronNotificationSender'
import { SettingsService } from './services/settingsService'
import { WebhookService } from './services/webhooks/webhookService'
import { TelegramBotManager } from './services/telegramBot/telegramBotManager'
import { TelegramAdapter } from './services/telegramBot/telegramAdapter'
import { FeishuBotManager } from './services/feishuBot/feishuBotManager'
import { FeishuAdapter } from './services/feishuBot/feishuAdapter'
import { DiscordBotManager } from './services/discordBot/discordBotManager'
import { DiscordAdapter } from './services/discordBot/discordAdapter'
import { WeixinBotManager } from './services/weixinBot/weixinBotManager'
import { WeixinAdapter } from './services/weixinBot/weixinAdapter'
import { IMBridgeManager } from './services/messaging'
import { setMainWindow, getMainWindow } from './window/windowManager'
import { NativeCapabilityRegistry } from './nativeCapabilities/registry'
import { PendingQuestionRegistry } from './nativeCapabilities/interaction/pendingQuestionRegistry'
import { initShellEnvironment } from './platform/shellPath'
import { dataPaths, isDev, ensureCapabilityDirs } from './platform/dataPaths'
import { initLogger, createLogger } from './platform/logger'
import { configureMarketplaceFetch } from './services/marketplace/utils/http'
import { setupApplicationMenu } from './menu'
import { resolveLocale } from '@shared/i18n'
import type { SupportedLocale } from '@shared/i18n'
import { getMenuLabels } from './i18n'
import { APP_NAME, APP_FS_NAME, IPC_EVENT_CHANNEL } from '@shared/appIdentity'
import { ProxyFetchFactory } from './network'
import { runPreDatabaseMigrations, runPostDatabaseMigrations } from './app/startupMigrations'
import { wireEventRoutes } from './app/appEventRouter'
import { executeShutdown } from './app/appShutdown'
import { cleanupOrphanedExecutions } from './app/scheduleStartupCleanup'
import { createAppServices } from './app/createServices'
import type { AppServices } from './app/createServices'
import { TrayIssueService } from './services/trayIssueService'
import type { ThemeConfig } from '../src/shared/types'
import type { SessionOrchestrator } from './command/sessionOrchestrator'
import { UpdateCheckerService } from './services/update'

function toThemeSource(theme: ThemeConfig): 'system' | 'light' | 'dark' {
  return theme.mode === 'system' ? 'system' : theme.mode
}

const devMode = isDev()
const hookEnv = devMode ? 'development' : 'production' as const
const appDisplayName = devMode ? `${APP_NAME} [DEV]` : APP_NAME
// BrowserWindow.icon requires .png (ignored on macOS; the Dock icon comes from .icns in the bundle).
const appIcon = devMode ? 'icon-dev.png' : 'icon.png'
const appUserDataDir = join(app.getPath('appData'), devMode ? `${APP_NAME}-dev` : APP_NAME)

function resolveResourceFile(fileName: string): string {
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, fileName),
        join(process.resourcesPath, 'resources', fileName),
        join(process.resourcesPath, 'app.asar', 'resources', fileName),
        join(process.resourcesPath, 'app.asar.unpacked', 'resources', fileName),
      ]
    : [
        join(process.cwd(), 'resources', fileName),
        join(__dirname, '../../resources', fileName),
      ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]
}

// Resolve shell environment (PATH + node location) before any service uses child_process.
initShellEnvironment()

// Set identity and profile directory before taking the single-instance lock.
// Electron scopes the lock to the app profile on desktop platforms; splitting
// dev/prod userData lets both versions run side by side.
app.setName(appDisplayName)
app.setPath('userData', appUserDataDir)

// ── Logger (must be before any service creation) ─────────────────────
initLogger({
  logsDir: dataPaths.logs,
  level: devMode ? 'debug' : 'info',
  maxFileSize: 5 * 1024 * 1024,
  maxFiles: 3,
  console: devMode,
})
const log = createLogger('main')
log.info(`=== ${APP_NAME} ${app.getVersion()} | Electron ${process.versions.electron} | ${process.platform} ${process.arch} | ${devMode ? 'DEV' : 'PROD'} ===`)

// Enforce single-instance behavior in production and development.
// Without this, a second launch can race on local resources (DB, bot polling)
// and exit silently, which users perceive as "app cannot open".
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

// Log uncaught startup/runtime failures so packaged builds don't fail silently.
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception in main process', err)
})
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection in main process', reason)
})

// Core
const bus = new DataBus()
const onboarding = new OnboardingStore(dataPaths.onboarding)
const settingsService = new SettingsService(dataPaths.settings)

// ── Service container ───────────────────────────────────────────────
// Single nullable reference replaces 16 individual `let x: T | null = null`.
// Set once in whenReady(); thereafter all services are non-nullable via destructure.
let svc: AppServices | null = null

// Non-database services (available before whenReady)
const nativeCapabilityRegistry = new NativeCapabilityRegistry()
const pendingQuestionRegistry = new PendingQuestionRegistry()

// Sources — hookSource uses lazy `shouldSkip` predicate (orchestrator isn't created yet).
// At call-time the predicate fires, orchestrator is guaranteed to be initialised
// because hookSource.start() runs after orchestrator creation (Phase 2).
const hookSource = new HookSource((e) => bus.dispatch(e), {
  eventsLog: dataPaths.eventsLog,
  // Skip only managed sessions that already emit SDK hooks (Claude).
  // Codex managed sessions still rely on hook-log ingestion for Inbox/Webhook flows.
  shouldSkip: (event) => svc?.orchestrator?.shouldSkipHookSourceEvent(event.sessionId) ?? false,
})
const statsSource = new StatsSource((e) => bus.dispatch(e))
const taskSource = new TaskSource((e) => bus.dispatch(e))

// ── Double-press ⌘Q quit confirmation ─────────────────────────────
// First press shows a toast; second press within 2 s actually quits.
// If the main window is hidden (user already dismissed it), quit immediately.
let lastQuitAttemptTime = 0
let currentMenuLocale: SupportedLocale = 'en-US'
const QUIT_DOUBLE_PRESS_WINDOW_MS = 2_000

function requestQuit(): void {
  const now = Date.now()

  // Second press within window → actually quit
  if (now - lastQuitAttemptTime < QUIT_DOUBLE_PRESS_WINDOW_MS) {
    lastQuitAttemptTime = 0
    app.quit()
    return
  }

  lastQuitAttemptTime = now

  // Find the visible main window
  const mainWin = getMainWindow()

  if (mainWin && mainWin.isVisible()) {
    // Show confirmation toast in the renderer
    const labels = getMenuLabels(currentMenuLocale)
    mainWin.webContents.send(IPC_EVENT_CHANNEL, {
      type: 'ui:toast',
      payload: { message: labels.quitConfirm, duration: QUIT_DOUBLE_PRESS_WINDOW_MS },
    })
  } else {
    // Window is hidden / doesn't exist — quit immediately (no confirmation needed)
    app.quit()
  }
}

// ── Menu → About dialog bridge ──────────────────────────────────────
// Sends a DataBus event to the renderer so the custom About dialog opens
// instead of the native Electron About panel.
function requestAbout(): void {
  const mainWin = getMainWindow()
  if (mainWin) {
    mainWin.show()
    mainWin.focus()
    mainWin.webContents.send(IPC_EVENT_CHANNEL, { type: 'menu:about' })
  }
}

// Side effects
const trayManager = new TrayManager(bus, { appDisplayName, onQuit: requestQuit })
const notificationService = new NotificationService(
  createElectronNotificationSender(),
  () => settingsService.getEventSubscriptionSettings()
)

// ── Proxy-aware fetch factory ────────────────────────────────────────────────
// Provides two fetch variants via ProxyFetchFactory:
//   - getIMBotFetch():     strips grammy's polyfill AbortSignal (for IM bot SDKs)
//   - getStandardFetch():  preserves AbortSignal (for webhooks, marketplace, Evose)
// Both respect the user's proxy settings (HTTP/HTTPS/SOCKS4/SOCKS5) and cache
// the undici dispatcher per proxy URL.
const proxyFetchFactory = new ProxyFetchFactory({
  getProxyUrl: () => {
    const s = settingsService.getSettings()
    return s.proxy.httpsProxy || s.proxy.httpProxy || null
  },
})

// ── UpdateChecker — GitHub Release version check ─────────────────────────────
const updateChecker = new UpdateCheckerService({
  bus,
  getFetch: () => proxyFetchFactory.getStandardFetch(),
  getUpdateSettings: () => settingsService.getSettings().updates,
})

// Webhook service — external event notifications (Lark, Telegram, custom)
// getProxyFetch is called lazily per-request so proxy settings changes take effect immediately.
const webhookService = new WebhookService({
  getEndpoints: () => settingsService.getWebhookEndpoints(),
  getProxyFetch: () => proxyFetchFactory.getStandardFetch(),
})

// ── Shared orchestrator deps (lazy — resolved after whenReady()) ──────────
function getOrchestratorDeps() {
  if (!svc) {
    throw new Error('Services not yet initialized — IM adapters must not be used before whenReady()')
  }
  const orch = svc.orchestrator
  return {
    startSession: (input: Parameters<SessionOrchestrator['startSession']>[0]) => orch.startSession(input),
    sendMessage: (id: string, content: Parameters<SessionOrchestrator['sendMessage']>[1]) => orch.sendMessage(id, content),
    resumeSession: (id: string, content: Parameters<SessionOrchestrator['resumeSession']>[1]) => orch.resumeSession(id, content),
    stopSession: (id: string) => orch.stopSession(id),
    listSessions: () => orch.listSessions(),
    getSession: (id: string) => orch.getSession(id),
  }
}

// Telegram Bot Manager — multi-bot bidirectional conversations (Long Polling, no server required)
const telegramBotManager = new TelegramBotManager({
  dispatch: (e) => bus.dispatch(e),
  get fetch() { return proxyFetchFactory.getIMBotFetch() },
  get orchestrator() { return getOrchestratorDeps() },
  // issueService and projectService are initialised in whenReady() before
  // telegramBotManager.startAll() is called — getters defer resolution safely.
  get issueService() { return svc!.issueService },
  get projectService() { return svc!.projectService },
})

// IM Bridge Manager — unified multi-platform IM management layer.
// Adapters register themselves; no hard-coded platform references.
const imBridgeManager = new IMBridgeManager({
  dispatch: (e) => bus.dispatch(e),
  getSettings: () => settingsService.getSettings(),
})

// Feishu Bot Manager — Feishu/Lark multi-bot bidirectional conversations (WebSocket long connection)
const feishuBotManager = new FeishuBotManager({
  dispatch: (e) => bus.dispatch(e),
  get fetch() { return proxyFetchFactory.getIMBotFetch() },
  get orchestrator() { return getOrchestratorDeps() },
  get issueService() { return svc!.issueService },
  get projectService() { return svc!.projectService },
})

// Discord Bot Manager — Discord multi-bot bidirectional conversations (Gateway WebSocket)
const discordBotManager = new DiscordBotManager({
  dispatch: (e) => bus.dispatch(e),
  get fetch() { return proxyFetchFactory.getIMBotFetch() },
  getProxyUrl: () => {
    const s = settingsService.getSettings()
    return s.proxy.httpsProxy || s.proxy.httpProxy || null
  },
  get orchestrator() { return getOrchestratorDeps() },
  get issueService() { return svc!.issueService },
  get projectService() { return svc!.projectService },
})

// WeChat Bot Manager — WeChat personal bot via iLink protocol (Long Polling, no server required)
const weixinBotManager = new WeixinBotManager({
  dispatch: (e) => bus.dispatch(e),
  get fetch() { return proxyFetchFactory.getIMBotFetch() },
  get orchestrator() { return getOrchestratorDeps() },
  get issueService() { return svc!.issueService },
  get projectService() { return svc!.projectService },
  async onTokenAcquired(connectionId, credentials) {
    // Persist the QR-login-acquired token to settings so it survives app restart.
    const settings = settingsService.getSettings()
    const conn = settings.messaging.connections.find((c) => c.id === connectionId)
    if (conn && conn.platform === 'weixin') {
      conn.botToken = credentials.botToken
      if (credentials.baseUrl) {
        conn.baseUrl = credentials.baseUrl
      }
      await settingsService.update(settings)
      bus.dispatch({ type: 'settings:updated', payload: settings })
    }
  },
})

// Register platform adapters
imBridgeManager.registerAdapter(new TelegramAdapter(telegramBotManager))
imBridgeManager.registerAdapter(new FeishuAdapter(feishuBotManager))
imBridgeManager.registerAdapter(new DiscordAdapter(discordBotManager))
imBridgeManager.registerAdapter(new WeixinAdapter(weixinBotManager))

// Track whether we've already started the shutdown sequence to prevent
// the before-quit handler from re-entering when we call app.quit() below.
// Also used by the window 'close' handler to distinguish a user-initiated
// close (hide on macOS) from an app-quit-driven close (allow destruction).
let isShuttingDown = false

function createWindow(): BrowserWindow {
  // Determine background color from loaded settings to match splash screen.
  // Settings are loaded BEFORE createWindow() is called, so appSettings is available.
  const isDarkMode = (() => {
    const settings = settingsService.getSettings()
    const mode = settings.theme?.mode ?? 'system'
    if (mode === 'dark') return true
    if (mode === 'light') return false
    // 'system' → use nativeTheme
    return nativeTheme.shouldUseDarkColors
  })()

  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: isDarkMode ? '#09090b' : '#fafafa',
    title: appDisplayName,
    icon: resolveResourceFile(appIcon),
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // On macOS, clicking the red traffic-light close button should hide the
  // window instead of destroying it, keeping the process alive (standard
  // macOS behaviour).  When the app is actually quitting (Cmd+Q / menu),
  // `isShuttingDown` is already true so the close proceeds normally.
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !isShuttingDown) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Only allow http(s) URLs to prevent file:// or custom protocol abuse
    if (/^https?:\/\//i.test(details.url)) {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  setMainWindow(mainWindow)
  return mainWindow
}

function focusOrCreateMainWindow(): void {
  const mainWin = getMainWindow()
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.show()
    mainWin.focus()
    return
  }
  if (app.isReady()) {
    createWindow()
  }
}

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    focusOrCreateMainWindow()
  })
}

if (gotSingleInstanceLock) {
app.whenReady().then(async () => {
  try {
  const startupStartedAt = Date.now()
  log.info('Main startup sequence started')
  // ── Permission guard ──────────────────────────────────────────────────
  // Explicitly deny Chromium permission requests the app never uses.
  // This prevents macOS from showing spurious system dialogs (e.g.
  // "wants to access Apple Music" triggered by Chromium's media stack).
  // Only 'notifications' is allowed — used by NotificationService for
  // session status updates.
  const ALLOWED_PERMISSIONS = new Set(['notifications'])

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })

  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return ALLOWED_PERMISSIONS.has(permission)
  })

  // ── Phase -1 & -0.5: Pre-database migrations ────────────────────────
  // Brand migration (.ccboard → .opencow) + hook marker rewrite.
  // Must complete before database is opened.
  await runPreDatabaseMigrations({
    legacyDirName: '.ccboard',
    targetDirName: `.${APP_FS_NAME}`,
    dataPaths,
    hookEnv,
  })

  // Ensure data directory exists once — stores no longer mkdir individually
  await mkdir(dataPaths.root, { recursive: true })

  // Ensure capability store directory structure (6 category subdirs)
  await ensureCapabilityDirs(dataPaths.capabilities)

  log.info(`Data dir: ${dataPaths.root}`)

  // Set macOS application menu (use system locale before settings are loaded)
  currentMenuLocale = resolveLocale('system', app.getLocale())
  setupApplicationMenu(currentMenuLocale, { onQuit: requestQuit, onAbout: requestAbout })

  // Set dock icon explicitly in dev mode to avoid default Electron icon.
  // In packaged app, icon.icns in the bundle is used automatically — no override needed.
  if (process.platform === 'darwin' && app.dock && !app.isPackaged) {
    const dockIconPath = resolveResourceFile('icon-dev.png')

    if (existsSync(dockIconPath)) {
      app.dock.setIcon(dockIconPath)
    } else {
      log.warn(`Dock icon file not found: ${dockIconPath}`)
    }
  }

  // ── Load settings (needed before service factory) ───────────────────
  // Settings drive schedule engine config, marketplace proxy, and menu locale.
  // Must run before createAppServices() so appSettings is available.
  const appSettings = await settingsService.load()
  log.info('Settings loaded', {
    durationMs: Date.now() - startupStartedAt,
    language: appSettings.language,
    themeMode: appSettings.theme.mode,
  })

  // Inject proxy-aware fetch into marketplace networking layer.
  // Must run AFTER settingsService.load() so getSettings() is safe.
  configureMarketplaceFetch(proxyFetchFactory.getStandardFetch())

  // Re-setup menu with user's language preference (initial setup used system locale)
  currentMenuLocale = resolveLocale(appSettings.language, app.getLocale())
  setupApplicationMenu(currentMenuLocale, { onQuit: requestQuit, onAbout: requestAbout })

  // ── Phase 0–0.7: Create all database-dependent services ────────────
  // Single factory call replaces 300+ lines of inline service construction.
  // Returns a fully-typed AppServices object — no nullable indirection.
  svc = await createAppServices({
    bus,
    settingsService,
    proxyFetchFactory,
    dataPaths,
    appSettings,
    nativeCapabilityRegistry,
    pendingQuestionRegistry,
  })
  log.info('Database-dependent services created', {
    durationMs: Date.now() - startupStartedAt,
  })

  // Destructure for convenience — all non-nullable from here on
  const {
    database, inboxService, issueService, contextRefStore, issueViewService,
    orchestrator, projectService, artifactService, browserService, terminalService,
    capabilityCenter, packageService, scheduleService, timeResolver,
    eventListener, executionStore, noteStore, providerService,
    marketplaceService, repoSourceRegistry, gitService,
  } = svc

  // Wire up TrayIssueService for issue-centric tray popover data
  trayManager.setTrayIssueService(
    new TrayIssueService({ orchestrator, issueService, projectService })
  )

  // Load initial onboarding state + settings into bus
  const onboardState = await onboarding.load()
  bus.dispatch({ type: 'onboarding:status', payload: onboardState })
  bus.dispatch({ type: 'settings:updated', payload: appSettings })

  // Apply nativeTheme from settings
  nativeTheme.themeSource = toThemeSource(appSettings.theme)

  // Register IPC
  registerIPCHandlers({
    bus,
    onboarding,
    dataPaths,
    hookEnv,
    inbox: inboxService,
    issueService,
    issueViewService,
    orchestrator,
    settingsService,
    webhookService,
    imBridgeManager,
    weixinBotManager,
    projectService,
    artifactService,
    noteStore,
    providerService,
    browserService,
    terminalService,
    scheduleService,
    contextRefStore,
    trayManager,
    capabilityCenter,
    packageService,
    marketplaceService,
    repoSourceRegistry,
    gitService,
    getProxyFetch: () => proxyFetchFactory.getStandardFetch(),
    onQuit: requestQuit,
    updateChecker,
  })
  connectBusToIPC(bus)
  log.info('IPC handlers registered and DataBus bridge connected')

  // ═══════════════════════════════════════════════════════════════════════
  // EARLY WINDOW — show the window ASAP while backend loads in background.
  //
  // All IPC handlers are already registered above (services are optional in
  // IPCDeps). The renderer calls `get-initial-state` on mount — if sources
  // haven't run yet it receives empty arrays, which render as an empty state.
  // Once sources finish they dispatch DataBus events that fill the UI.
  // ═══════════════════════════════════════════════════════════════════════
  trayManager.updateLocale(resolveLocale(appSettings.language, app.getLocale()))
  trayManager.setUpdateChecker(updateChecker)
  trayManager.create()

  // Power Monitor: suspend/resume schedule engine
  powerMonitor.on('suspend', () => {
    log.info('System suspending — pausing schedule TimeResolver')
    timeResolver.markSuspended()
    timeResolver.stop()
  })
  powerMonitor.on('resume', () => {
    log.info('System resuming — restarting schedule TimeResolver')
    timeResolver.start()
    timeResolver.catchUpMissedExecutions().catch((err) => {
      log.error('Failed to catch up missed executions after resume', err)
    })
    // Re-check for updates after system resume
    updateChecker.onSystemResume()
  })

  createWindow()

  app.on('activate', () => {
    focusOrCreateMainWindow()
  })

  // ═══════════════════════════════════════════════════════════════════════
  // BACKGROUND LOADING — populate data while the renderer is mounting.
  // ═══════════════════════════════════════════════════════════════════════

  // ── Parallel service start ───────────────────────────────────────────
  // These services are independent: different DB tables, no cross-deps.
  // Promise.allSettled ensures one failure doesn't abort the others.
  const serviceResults = await Promise.allSettled([
    nativeCapabilityRegistry.startAll(),
    inboxService.start(),
    issueService.start(),
    orchestrator.start(),
  ])
  const serviceFailures = serviceResults.filter((result) => result.status === 'rejected').length
  for (const result of serviceResults) {
    if (result.status === 'rejected') {
      log.error('Service startup failed', result.reason)
    }
  }
  log.info('Core service startup completed', {
    total: serviceResults.length,
    failed: serviceFailures,
  })

  // ── Parallel data source start ───────────────────────────────────────
  // Sources are independent — each scans different paths and dispatches
  // different event types. hookSource.shouldSkip references orchestrator
  // which is guaranteed to be started above (Promise.allSettled resolved).
  const sourceResults = await Promise.allSettled([
    hookSource.start(),
    statsSource.start(),
    taskSource.start(),
  ])
  const sourceFailures = sourceResults.filter((result) => result.status === 'rejected').length
  for (const result of sourceResults) {
    if (result.status === 'rejected') {
      log.error('Data source startup failed', result.reason)
    }
  }
  log.info('Data source startup completed', {
    total: sourceResults.length,
    failed: sourceFailures,
  })

  // ── Phase 2.5 & 2.6: Post-database migrations ──────────────────────
  // Legacy project ID rewrite + preferences.json → projects table.
  // Best-effort — failures logged but never block startup.
  await runPostDatabaseMigrations({ database, projectService, dataPaths })

  // ── Phase 2.7: Start schedule engine ──────────────────────────────────
  timeResolver.start()
  log.info('Schedule engine: TimeResolver started')
  await timeResolver.catchUpMissedExecutions()

  // Batch-cancel executions orphaned by previous crashes (best-effort)
  await cleanupOrphanedExecutions({ executionStore, orchestrator, bus })

  // Phase 3: Wire side-effect pipelines — only LIVE events from here on.
  // StatusTransition listeners MUST be registered here (not before Phase 2)
  // to prevent historical hook-event replay from triggering webhooks/notifications.
  wireEventRoutes({
    bus,
    notificationService,
    webhookService,
    inboxService,
    orchestrator,
    artifactService,
    imBridgeManager,
    proxyFetchFactory,
    eventListener,
    gitService,
  })

  // Initialize and auto-start all enabled IM bots (Telegram, Feishu, Discord, etc.)
  // syncWithSettings handles init + startAll for all platforms uniformly,
  // no special initialization needed for individual platforms.
  imBridgeManager.syncWithSettings(appSettings).catch((err) => {
    log.error('Failed to auto-start IM bots', err)
  })

  // ── Start update checker (deferred 30s first check) ──────────────────
  updateChecker.start()

  // ── Fire-and-forget background tasks ─────────────────────────────────
  // Artifact backfill — extract artifacts from existing sessions (non-blocking)
  setImmediate(() => {
    artifactService.backfillFromExistingSessions(() => orchestrator.listFullSessions()).catch((err) => {
      log.error('Artifact backfill failed', err)
    })
  })
  log.info('Main startup sequence completed', {
    durationMs: Date.now() - startupStartedAt,
  })
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
    log.error('Fatal startup error in main process', err)
    dialog.showErrorBox('OpenCow failed to start', message)
    app.exit(1)
  }
}).catch((err) => {
  log.error('Failed before app.whenReady startup chain', err)
  app.exit(1)
})
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (isShuttingDown) return // already running — let Electron proceed

  event.preventDefault()
  isShuttingDown = true

  updateChecker.stop()

  executeShutdown({
    trayManager,
    hookSource,
    statsSource,
    taskSource,
    inboxService: svc?.inboxService ?? null,
    webhookService,
    telegramBotManager,
    timeResolver: svc?.timeResolver ?? null,
    retryScheduler: svc?.retryScheduler ?? null,
    gitService: svc?.gitService ?? null,
    nativeCapabilityRegistry,
    capabilityCenter: svc?.capabilityCenter ?? null,
    browserService: svc?.browserService ?? null,
    terminalService: svc?.terminalService ?? null,
    orchestrator: svc?.orchestrator ?? null,
    database: svc?.database ?? null,
  })
})
