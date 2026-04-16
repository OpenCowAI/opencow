// SPDX-License-Identifier: Apache-2.0

/**
 * createServices — centralised factory for all database-dependent services.
 *
 * Encapsulates the entire Phase 0 → Phase 0.7 initialisation sequence:
 *   Phase 0:   SQLite database
 *   Phase 0.5: Core stores + services (inbox, issues, projects, browser, terminal)
 *   Phase 0.6: Schedule engine (triggers, pipeline, middlewares, resolvers)
 *   Phase 0.7: NativeCapabilities (browser, Evose, issue, project, HTML, interaction)
 *
 * Design:
 *   - All cross-service references are resolved locally (no module-level nullables).
 *   - Side-effects (capability watching, toggle migration, auto-import) fire-and-forget.
 *   - The returned `AppServices` object contains every service reference that the
 *     caller (main.ts) needs for IPC, event wiring, startup, and shutdown.
 */

import { dirname } from 'path'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { InboxService } from '../services/inboxService'
import { InboxStore } from '../services/inboxStore'
import { IssueService } from '../services/issueService'
import { IssueContextRefStore } from '../services/issueContextRefStore'
import { IssueStore } from '../services/issueStore'
import { IssueViewService } from '../services/issueViewService'
import { IssueViewStore } from '../services/issueViewStore'
import { SessionOrchestrator } from '../command/sessionOrchestrator'
import { ManagedSessionStore } from '../services/managedSessionStore'
import { CredentialStore } from '../services/provider/credentialStore'
import { ProviderService } from '../services/provider/providerService'
import { runProviderMigration } from '../services/provider/migration'
import { BrowserStore } from '../browser/browserStore'
import { BrowserService } from '../browser/browserService'
import { TerminalService } from '../terminal/terminalService'
import { resolveCwd as resolveTerminalCwd } from '../terminal/shellResolver'
import { ProjectStore } from '../services/projectStore'
import { ProjectService } from '../services/projectService'
import { ArtifactStore } from '../services/artifactStore'
import { ArtifactService } from '../services/artifactService'
import { NoteStore } from '../services/noteStore'
import { CapabilityCenter } from '../services/capabilityCenter'
import { PackageStore } from '../services/capabilityCenter/packageStore'
import { PackageRegistry } from '../services/capabilityCenter/packageRegistry'
import { PackageService } from '../services/capabilityCenter/packageService'
import { MarketplaceService } from '../services/marketplace'
import { RepoAnalyzer } from '../services/marketplace/agentAnalyzer'
import { RepoSourceRegistry } from '../services/marketplace/repoSourceRegistry'
import { GitService } from '../services/git/gitService'
import { IssueProviderStore } from '../services/issueProviderStore'
import { IssueProviderService } from '../services/issueProviderService'
import { AdapterRegistry } from '../services/issue-sync/adapterRegistry'
import { IssueSyncEngine } from '../services/issue-sync/syncEngine'
import { ChangeQueueStore } from '../services/issue-sync/changeQueueStore'
import { ChangeQueueService } from '../services/issue-sync/changeQueueService'
import { PushEngine } from '../services/issue-sync/pushEngine'
import { SyncLogStore } from '../services/issue-sync/syncLogStore'
import { IssueCommentStore } from '../services/issueCommentStore'
import { IssueCommentService } from '../services/issueCommentService'
import { SessionLifecycleOperationStore } from '../services/sessionLifecycleOperationStore'
import { LifecycleOperationCoordinator } from '../services/lifecycleOperations'
import { createMemoryStorage } from '../memory/storage'
import { MemoryService } from '../memory/memoryService'
import { MAX_SESSION_CONTENT_LENGTH } from '../memory/constants'
import { prepareExtractionContent } from '../memory/contentPreparer'
import { HeadlessLLMClientImpl } from '../llm/headlessLLMClient'
import { GitCommandExecutor } from '../services/git/gitCommandExecutor'
import { EvoseService } from '../services/evoseService'
import { ScheduleStore } from '../services/scheduleStore'
import { PipelineStore } from '../services/pipelineStore'
import { ExecutionStore } from '../services/executionStore'
import { ScheduleService } from '../services/schedule/scheduleService'
import { BiweeklyCalculator } from '../services/schedule/biweeklyCalculator'
import { ExecutionPipeline } from '../services/schedule/executionPipeline'
import { TriggerRegistry } from '../services/schedule/triggerRegistry'
import { TimeResolver } from '../services/schedule/timeResolver'
import { EventListener } from '../services/schedule/eventListener'
import { RetryScheduler } from '../services/schedule/retryScheduler'
import { ChainResolver } from '../services/schedule/chainResolver'
import { NotificationEmitter } from '../services/schedule/notificationEmitter'
import { ConcurrencyGuard } from '../services/schedule/middlewares/concurrencyGuard'
import { WorkModeGuard } from '../services/schedule/middlewares/workModeGuard'
import { ContextResolver } from '../services/schedule/middlewares/contextResolver'
import { ActionExecutor } from '../services/schedule/middlewares/actionExecutor'
import { ResultRecorder } from '../services/schedule/middlewares/resultRecorder'
import { GitDiffInjector } from '../services/schedule/contextInjectors/gitDiffInjector'
import { LastResultInjector } from '../services/schedule/contextInjectors/lastResultInjector'
import { IssuesInjector } from '../services/schedule/contextInjectors/issuesInjector'
import { StatsInjector } from '../services/schedule/contextInjectors/statsInjector'
import { HookEventMatcher } from '../services/schedule/matchers/hookEventMatcher'
import { IssueStatusMatcher } from '../services/schedule/matchers/issueStatusMatcher'
import { SessionErrorMatcher } from '../services/schedule/matchers/sessionErrorMatcher'
import { SessionIdleMatcher } from '../services/schedule/matchers/sessionIdleMatcher'
import { BrowserNativeCapability } from '../nativeCapabilities/browser/browserNativeCapability'
import { IssueNativeCapability } from '../nativeCapabilities/issueNativeCapability'
import { ProjectNativeCapability } from '../nativeCapabilities/projectNativeCapability'
import { HtmlNativeCapability } from '../nativeCapabilities/htmlNativeCapability'
import { InteractionNativeCapability } from '../nativeCapabilities/interaction/interactionNativeCapability'
import { EvoseNativeCapability } from '../nativeCapabilities/evose/evoseNativeCapability'
import { ScheduleNativeCapability } from '../nativeCapabilities/scheduleNativeCapability'
import { LifecycleOperationNativeCapability } from '../nativeCapabilities/lifecycleOperationNativeCapability'
import { initDatabase } from '../database/db'
import { focusMainWindow } from '../window/windowManager'
import { createLogger } from '../platform/logger'
import { buildEventSubscriptionPolicy } from '../events/eventSubscriptionPolicy'
import type { DataBus } from '../core/dataBus'
import type { SettingsService } from '../services/settingsService'
import type { OpenCowCapabilityRegistry } from '../nativeCapabilities/openCowCapabilityRegistry'
import type { PendingQuestionRegistry } from '../nativeCapabilities/interaction/pendingQuestionRegistry'
import type { ProxyFetchFactory } from '../network'
import type { DataPaths } from '../platform/dataPaths'
import type { DatabaseService } from '../database/db'
import type { AppSettings, ContextInjectionType, ContextInjector } from '../../src/shared/types'

const log = createLogger('ServiceFactory')

// ── Types ────────────────────────────────────────────────────────────────────

export interface ServiceFactoryDeps {
  bus: DataBus
  settingsService: SettingsService
  proxyFetchFactory: ProxyFetchFactory
  dataPaths: DataPaths
  appSettings: AppSettings
  nativeCapabilityRegistry: OpenCowCapabilityRegistry
  pendingQuestionRegistry: PendingQuestionRegistry
}

/** All services created during Phase 0–0.7, returned for wiring in main.ts. */
export interface AppServices {
  database: DatabaseService
  inboxService: InboxService
  issueService: IssueService
  contextRefStore: IssueContextRefStore
  issueViewService: IssueViewService
  orchestrator: SessionOrchestrator
  projectService: ProjectService
  artifactService: ArtifactService
  browserService: BrowserService
  terminalService: TerminalService
  capabilityCenter: CapabilityCenter
  packageService: PackageService
  scheduleService: ScheduleService
  timeResolver: TimeResolver
  retryScheduler: RetryScheduler
  eventListener: EventListener
  executionStore: ExecutionStore
  noteStore: NoteStore
  providerService: ProviderService
  marketplaceService: MarketplaceService
  repoSourceRegistry: RepoSourceRegistry
  gitService: GitService
  memoryService: MemoryService
  issueProviderService: import('../services/issueProviderService').IssueProviderService
  issueSyncEngine: import('../services/issue-sync/syncEngine').IssueSyncEngine
  changeQueueStore: ChangeQueueStore
  changeQueueService: ChangeQueueService
  pushEngine: PushEngine
  issueCommentService: IssueCommentService
  syncLogStore: SyncLogStore
  lifecycleOperationCoordinator: LifecycleOperationCoordinator
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create and wire all database-dependent services.
 *
 * This is a "mostly-pure" factory: deterministic service creation with a few
 * fire-and-forget side-effects (capability watching, toggle migration, auto-import)
 * that are safe to run during startup.
 */
export async function createAppServices(deps: ServiceFactoryDeps): Promise<AppServices> {
  const {
    bus,
    settingsService,
    proxyFetchFactory,
    dataPaths,
    appSettings,
    nativeCapabilityRegistry,
    pendingQuestionRegistry,
  } = deps
  const startedAt = Date.now()
  log.info('Service factory started', {
    databasePath: dataPaths.database,
    capabilitiesPath: dataPaths.capabilities,
  })

  // ── Phase 0: Initialise SQLite database ──────────────────────────────
  await mkdir(dirname(dataPaths.database), { recursive: true })
  const database = await initDatabase(dataPaths.database)
  log.info('Service factory phase complete: database initialized', {
    durationMs: Date.now() - startedAt,
    databasePath: dataPaths.database,
  })

  // ── Phase 0.5: Create database-dependent services ────────────────────

  // Named store instances shared across services (enables ProjectService cascade delete)
  const inboxStore = new InboxStore(database.db)
  const issueStore = new IssueStore(database.db)
  const artifactStore = new ArtifactStore(database.db)
  const scheduleStore = new ScheduleStore(database.db)
  const pipelineStore = new PipelineStore(database.db)
  const executionStore = new ExecutionStore(database.db)
  const managedSessionStore = new ManagedSessionStore(database.db)
  const sessionLifecycleOperationStore = new SessionLifecycleOperationStore(database.db)
  const lifecycleOperationCoordinator = new LifecycleOperationCoordinator({
    store: sessionLifecycleOperationStore,
    dispatch: (e) => bus.dispatch(e),
  })

  // Forward-declare for circular references (schedule engine ↔ services)
  // eslint-disable-next-line prefer-const
  let projectService!: ProjectService
  // eslint-disable-next-line prefer-const
  let scheduleService!: ScheduleService
  // eslint-disable-next-line prefer-const
  let orchestrator!: SessionOrchestrator
  // eslint-disable-next-line prefer-const
  let memoryService!: MemoryService

  const inboxService = new InboxService({
    dispatch: (e) => bus.dispatch(e),
    getState: () => bus.getState(),
    store: inboxStore,
    getEventSubscriptionPolicy: () =>
      buildEventSubscriptionPolicy(settingsService.getEventSubscriptionSettings()),
    resolveManagedSession: async (sessionRefs) => {
      if (orchestrator) return orchestrator.getSessionByRefs(sessionRefs)
      return managedSessionStore.findBySessionRefs(sessionRefs)
    },
    resolveIssueBySessionRefs: (sessionIds) => issueStore.findLatestSummaryBySessionIds(sessionIds),
    resolveScheduleIdBySessionRefs: async (sessionIds) => {
      const execution = await executionStore.findLatestBySessionIds(sessionIds)
      return execution?.scheduleId ?? null
    },
  })

  const issueService = new IssueService({
    store: issueStore,
    dispatch: (e) => bus.dispatch(e),
  })
  const contextRefStore = new IssueContextRefStore(database.db)
  const issueViewService = new IssueViewService(new IssueViewStore(database.db))

  // ── Issue Providers (GitHub/GitLab integration) ─────────────────────
  const issueProviderStore = new IssueProviderStore(database.db)
  const issueProviderCredentialStore = new CredentialStore<Record<string, string>>(
    dataPaths.issueProviderCredentials
  )
  const adapterRegistry = new AdapterRegistry()
  const issueProviderService = new IssueProviderService({
    store: issueProviderStore,
    credentialStore: issueProviderCredentialStore,
    adapterRegistry,
    dispatch: (e) => bus.dispatch(e),
  })
  const issueSyncEngine = new IssueSyncEngine({
    issueStore,
    providerStore: issueProviderStore,
    providerService: issueProviderService,
    adapterRegistry,
    dispatch: (e) => bus.dispatch(e),
  })

  // ── Phase 2: Bidirectional sync modules ─────────────────────────────
  const changeQueueStore = new ChangeQueueStore(database.db)
  const changeQueueService = new ChangeQueueService({
    store: changeQueueStore,
    dispatch: (e) => bus.dispatch(e),
  })
  const pushEngine = new PushEngine({
    changeQueueStore,
    issueStore,
    providerStore: issueProviderStore,
    providerService: issueProviderService,
    adapterRegistry,
    dispatch: (e) => bus.dispatch(e),
  })
  const syncLogStore = new SyncLogStore(database.db)
  const issueCommentStore = new IssueCommentStore(database.db)
  const issueCommentService = new IssueCommentService({
    store: issueCommentStore,
    changeQueueService,
    dispatch: (e) => bus.dispatch(e),
  })

  // Late-bind ChangeQueueService → IssueService for push-on-update hooks.
  // Avoids circular dependency: IssueService is created before Phase 2 modules.
  issueService.setChangeQueueService(changeQueueService)

  const providerCredentialStore = new CredentialStore(dataPaths.credentials)

  // Phase B.7 cutover — silent one-shot migration. Detects any
  // pre-Phase-A / Phase A / Phase B-preview settings shape, moves
  // credentials into profile-scoped slots, deletes legacy files, and
  // stamps schemaVersion: 1. Runs every boot but short-circuits when
  // the stamp is present.
  const legacyCodexCredentialStore = existsSync(dataPaths.legacyCodexCredentials)
    ? new CredentialStore(dataPaths.legacyCodexCredentials)
    : null
  try {
    await runProviderMigration({
      settingsService,
      mainCredentialStore: providerCredentialStore,
      legacyCodexCredentialStore,
      legacyCodexCredentialsPath: dataPaths.legacyCodexCredentials,
    })
  } catch (err) {
    log.error('Provider migration failed — Settings UI may be empty until this resolves', err)
  }

  const providerService = new ProviderService({
    dispatch: (e) => bus.dispatch(e),
    credentialStore: providerCredentialStore,
    getProviderSettings: () => settingsService.getProviderSettings(),
    updateProviderSettings: async (patch) => {
      const current = await settingsService.load()
      const nextProvider = { ...current.provider, ...patch }
      const saved = await settingsService.update({ ...current, provider: nextProvider })
      bus.dispatch({ type: 'settings:updated', payload: saved })
      return nextProvider
    },
    focusApp: focusMainWindow,
  })

  // BrowserService is created before SessionOrchestrator so the orchestrator can
  // hold a reference and release per-session browser views when sessions stop.
  const browserService = new BrowserService({
    dispatch: (e) => bus.dispatch(e),
    store: new BrowserStore(database.db),
  })

  // TerminalService — PTY lifecycle management
  // Uses lazy projectService lookup so projects resolve at call-time (not creation-time).
  const terminalService = new TerminalService({
    dispatch: (e) => bus.dispatch(e),
    resolveCwd: (scope) =>
      resolveTerminalCwd(scope, (id) => {
        const project = bus.getState().projects.find((p) => p.id === id)
        return project?.path ?? null
      }),
  })

  // ── Project Store (needed by Capability Center for projectId resolution) ──
  const projectStore = new ProjectStore(database.db)

  // ── Package Service (DB-backed package lifecycle) ──────────────────────
  const resolveProjectPath = async (projectId: string) => {
    const project = await projectStore.getById(projectId)
    return project?.canonicalPath ?? null
  }
  const packageStore = new PackageStore(dataPaths.capabilities)
  const packageRegistry = new PackageRegistry(database.db)
  const packageService = new PackageService({
    packageStore,
    packageRegistry,
    dataBus: bus,
    resolveProjectPath,
  })
  // Reconcile filesystem ↔ DB on startup (clean stale staging dirs, backfill, prune orphans)
  packageService.startupReconcile()
    .catch((err) => log.warn('Package startup reconcile failed', err))

  // ── Capability Center (v3.1 M4) ────────────────────────────────────────
  // Manages Skills / Agents / Commands / Rules / Hooks / MCP Servers
  const capabilityCenter = new CapabilityCenter({
    globalCapabilitiesRoot: dataPaths.capabilities,
    db: database.db,
    dataBus: bus,
    resolveProjectPath,
    packageService,
    getEvoseSettings: () => settingsService.getSettings().evose,
  })
  capabilityCenter.startWatching()
  capabilityCenter.startDriftCheck()
  // Auto-import global Claude Code capabilities on startup (fire-and-forget).
  // Project-level auto-import is deferred to first getSnapshot(projectId) call.
  capabilityCenter.autoImport()
    .catch((err) => log.warn('Startup auto-import failed', err))
  // Backfill distribution records for previously imported Claude Code items
  // so they correctly show "Published · In sync" instead of "Not published".
  capabilityCenter.backfillDistributionRecords()
    .catch((err) => log.warn('Distribution backfill failed', err))

  // ── Marketplace Service ─────────────────────────────────────────────
  const repoAnalyzer = new RepoAnalyzer()

  const marketplaceService = new MarketplaceService({
    importer: {
      async importItems(items, target) {
        return capabilityCenter.importItems(
          items.map((item) => ({ ...item })),
          { scope: target.scope, projectId: target.projectId },
        )
      },
    },
    packageInstaller: {
      async installPackage(params) {
        return packageService.install(params)
      },
    },
    repoAnalyzer,
    dispatch: (e) => bus.dispatch(e),
  })

  // ── Repo Source Registry ───────────────────────────────────────────
  const repoCredentialStore = new CredentialStore<Record<string, string>>(deps.dataPaths.repoSourceCredentials)
  const repoSourceRegistry = new RepoSourceRegistry({
    db: database.db,
    credentialStore: repoCredentialStore,
    marketplaceService,
  })
  // Restore all registered repo sources as dynamic MarketplaceProviders
  repoSourceRegistry.restoreProviders()
    .catch((err) => log.warn('Failed to restore repo source providers', err))

  // M6-3: one-time toggle migration (best-effort, never blocks startup)
  import('../services/capabilityCenter/toggleMigration')
    .then((m) => m.runToggleMigration(database.db))
    .then((result) => {
      if (!result.skipped) {
        log.info(`Toggle migration complete: ${result.migrated} capabilities migrated`)
      }
    })
    .catch((err) => log.warn('Toggle migration skipped due to error', err))

  orchestrator = new SessionOrchestrator({
    dispatch: (e) => bus.dispatch(e),
    getProxyEnv: () => settingsService.getProxyEnv(),
    getProviderEnv: async (override) => {
      // ε.3c: session-bound profile (if any) wins over Settings default.
      // resolveProfileId already implements this override semantics.
      const profileId = providerService.resolveProfileId(override)
      if (!profileId) {
        log.warn('getProviderEnv: no profile resolved — session will fail auth', {
          override: override ?? '(none)',
        })
        return {}
      }
      try {
        return await providerService.getProviderEnvForProfile(profileId)
      } catch (err) {
        // ProfileMisconfiguredError and any downstream failure surfaces
        // here. Re-throw so the orchestrator's start-session path turns
        // it into a visible session error instead of spawning a broken
        // SDK that emits "API Error: fetch failed" as assistant text.
        const message = err instanceof Error ? err.message : String(err)
        log.error('getProviderEnv failed — session will not spawn', {
          profileId,
          error: message,
        })
        throw err
      }
    },
    getProviderDefaultModel: (override) => {
      // ε.3c: pinned session reads model preference from its bound profile.
      const profileId = providerService.resolveProfileId(override)
      if (!profileId) return undefined
      const profile = providerService.listProfiles().find((p) => p.id === profileId)
      return profile?.preferredModel
    },
    getActiveProviderProfileId: () =>
      providerService.resolveProfileId(),
    getCommandDefaults: () => settingsService.getCommandDefaults(),
    store: managedSessionStore,
    nativeCapabilityRegistry,
    browserService,
    pendingQuestionRegistry,
    capabilityCenter,
    gitCommandExecutor: new GitCommandExecutor(),
    resolveProjectById: async (projectId: string) => {
      const project = await projectStore.getById(projectId)
      if (!project) return null
      return { id: project.id, canonicalPath: project.canonicalPath }
    },
    getMemoryContext: async (projectId: string | null) => {
      try {
        return await memoryService.getContextForSession({ projectId })
      } catch {
        return null
      }
    },
  })

  // Late-bind orchestrator to marketplace service (marketplace is created before orchestrator)
  marketplaceService.setOrchestrator(orchestrator)

  // eslint-disable-next-line prefer-const
  projectService = new ProjectService({
    store: projectStore,
    issueStore,
    artifactStore,
    scheduleStore,
    pipelineStore,
    inboxStore,
    packageService,
  })

  const artifactService = new ArtifactService({
    store: artifactStore,
    dispatch: (e) => bus.dispatch(e),
    resolveProjectId: async (projectPath) => {
      const project = await projectStore.findByCanonicalPath(projectPath)
      return project?.id ?? null
    },
  })

  const noteStore = new NoteStore(database.db)

  // ── Phase 0.6: Schedule engine ──────────────────────────────────────
  const biweeklyCalculator = new BiweeklyCalculator()

  // Context injectors
  const contextInjectors = new Map<ContextInjectionType, ContextInjector>()
  contextInjectors.set('git_diff_24h', new GitDiffInjector({ projectStore }))
  contextInjectors.set('last_execution_result', new LastResultInjector(executionStore))
  contextInjectors.set('open_issues', new IssuesInjector({
    list: (filter) => issueService.listIssues(filter),
  }))
  contextInjectors.set('today_stats', new StatsInjector({
    getLatest: () => bus.getState().stats,
  }))

  // Middlewares
  const concurrencyGuard = new ConcurrencyGuard({
    executionStore,
    maxConcurrent: appSettings.schedule.maxConcurrentExecutions,
  })
  const workModeGuard = new WorkModeGuard({ calculator: biweeklyCalculator })
  const contextResolver = new ContextResolver({ injectors: contextInjectors, projectStore })
  const actionExecutor = new ActionExecutor({
    sessionOrchestrator: orchestrator,
    issueService,
    // webhookService and inboxService don't yet implement the *Like interfaces
    // (dispatchEvent / createScheduleNotification). Pass undefined; the executor
    // guards every call with `if (this.deps.*)`.
    webhookService: undefined,
    inboxService: undefined,
  })
  const resultRecorder = new ResultRecorder({
    scheduleStore,
    executionStore,
    dispatch: (e) => bus.dispatch(e),
    sessionOrchestrator: orchestrator,
  })

  // Execution pipeline
  const executionPipeline = new ExecutionPipeline()
  executionPipeline
    .use(concurrencyGuard)
    .use(workModeGuard)
    .use(contextResolver)
    .use(actionExecutor)
    .use(resultRecorder)

  // Trigger registry
  const triggerRegistry = new TriggerRegistry()
  triggerRegistry.register(new HookEventMatcher())
  triggerRegistry.register(new IssueStatusMatcher())
  triggerRegistry.register(new SessionErrorMatcher())
  triggerRegistry.register(new SessionIdleMatcher())
  log.info('Service factory phase complete: schedule engine wired', {
    maxConcurrentExecutions: appSettings.schedule.maxConcurrentExecutions,
    middlewares: [concurrencyGuard.name, workModeGuard.name, contextResolver.name, actionExecutor.name, resultRecorder.name],
    contextInjectors: [...contextInjectors.keys()],
    triggerMatchers: triggerRegistry.getAll().map((matcher) => matcher.type),
  })

  // Retry, chain, notification
  const retryScheduler = new RetryScheduler({
    scheduleStore,
    onTrigger: (event) => scheduleService.handleTrigger(event),
  })
  const chainResolver = new ChainResolver({
    pipelineStore,
    onTrigger: (event) => scheduleService.handleTrigger(event),
  })
  const notificationEmitter = new NotificationEmitter({
    // inboxService and webhookService don't yet implement *Like interfaces.
    // The emitter guards all calls with optional chaining (?.).
    inboxService: undefined,
    webhookService: undefined,
    dispatch: (e) => bus.dispatch(e),
  })

  // Time resolver & event listener
  const timeResolver = new TimeResolver({
    store: scheduleStore,
    onTrigger: (event) => scheduleService.handleTrigger(event),
  })
  const eventListener = new EventListener({
    registry: triggerRegistry,
    store: scheduleStore,
    onTrigger: (event) => scheduleService.handleTrigger(event),
  })

  // Schedule service (wires all sub-components)
  scheduleService = new ScheduleService({
    scheduleStore,
    pipelineStore,
    executionStore,
    pipeline: executionPipeline,
    retryScheduler,
    chainResolver,
    notificationEmitter,
    dispatch: (e) => bus.dispatch(e),
  })
  lifecycleOperationCoordinator.setScheduleService(scheduleService)

  // ── Phase 0.7: NativeCapabilities — OpenCow built-in abilities ──────────────
  nativeCapabilityRegistry.register(
    new BrowserNativeCapability({
      browserService,
      bus,
      resolveProjectBrowserStatePolicy: async (projectId) => {
        const project = await projectStore.getById(projectId)
        return project?.preferences.defaultBrowserStatePolicy ?? null
      },
    })
  )

  // Evose NativeCapability — exposes Evose Agents & Workflows as MCP tools to Claude.
  // settingsService.load() was called before factory invocation, so getSettings() is safe.
  // getProxyFetch is a lazy getter — called per-request so proxy changes take effect immediately.
  const evoseService = new EvoseService({
    settingsService,
    getProxyFetch: () => proxyFetchFactory.getStandardFetch(),
  })
  nativeCapabilityRegistry.register(new EvoseNativeCapability(evoseService, settingsService))

  // Issue NativeCapability — exposes Issue CRUD + remote issue tools as MCP tools to Claude.
  nativeCapabilityRegistry.register(new IssueNativeCapability({
    issueService,
    issueProviderService,
    adapterRegistry,
    lifecycleOperationCoordinator,
  }))

  // Project NativeCapability — exposes Project read-only queries as MCP tools to Claude.
  // Write operations (create/delete/archive) intentionally omitted — belong in UI.
  nativeCapabilityRegistry.register(new ProjectNativeCapability({
    projectService,
    issueService,
  }))

  // HTML NativeCapability — gen_html tool for browser-style HTML preview in session console.
  // Content stays in memory; download is optional via the preview dialog.
  nativeCapabilityRegistry.register(new HtmlNativeCapability())

  // Interaction NativeCapability — ask_user_question MCP tool (replaces SDK built-in AskUserQuestion).
  // The tool handler blocks until the user answers via the interactive card or direct input.
  nativeCapabilityRegistry.register(new InteractionNativeCapability({
    registry: pendingQuestionRegistry,
    dispatch: (e) => bus.dispatch(e),
    enterQuestionState: (sessionId) => orchestrator.enterQuestionState(sessionId),
    exitQuestionState: (sessionId) => orchestrator.exitQuestionState(sessionId),
  }))

  // Schedule NativeCapability — exposes Schedule CRUD + pause/resume as MCP tools to Claude.
  // Enables conversational schedule management: "Create a daily report at 9am".
  nativeCapabilityRegistry.register(new ScheduleNativeCapability({
    scheduleService,
    lifecycleOperationCoordinator,
  }))

  // Lifecycle NativeCapability — entity-agnostic apply/cancel tools that let
  // the model close the propose→confirm loop from chat ("确定" → apply_lifecycle_operation).
  // Without these the only path to commit a pending proposal is the UI's Confirm button.
  nativeCapabilityRegistry.register(new LifecycleOperationNativeCapability({
    lifecycleOperationCoordinator,
  }))
  log.info('Service factory phase complete: native capabilities registered', {
    capabilities: ['browser', 'evose', 'issue', 'project', 'html', 'interaction', 'schedule', 'lifecycle'],
  })

  const gitService = new GitService({
    dispatch: (event) => bus.dispatch(event),
  })
  log.info('Service factory completed', {
    durationMs: Date.now() - startedAt,
  })

  // ── Phase 0.8: Memory System ───────────────────────────────────────────

  const memoryStorage = createMemoryStorage({ type: 'sqlite', db: database.db })

  // HeadlessLLMClient: engine-agnostic single-turn text generation for memory extraction.
  // Uses Vercel AI SDK (@ai-sdk/anthropic, @ai-sdk/openai) — no SDK subprocess needed.
  const headlessClient = new HeadlessLLMClientImpl({
    resolveAuth: async () => {
      const profileId = providerService.resolveProfileId()
      if (!profileId) throw new Error('No default provider profile configured')
      return providerService.resolveHTTPAuthForProfile(profileId)
    },
    getFetch: () => proxyFetchFactory.getStandardFetch(),
  })

  memoryService = new MemoryService({
    bus,
    store: memoryStorage,
    extractorDeps: { llmClient: headlessClient },
    getSessionContext: async (sessionId: string) => {
      const session = await orchestrator.getFullSession(sessionId)
      if (!session?.messages?.length) return null

      // Full messages with turn-based recent-priority compression.
      // See docs/design/memory-extraction-content-strategy.md for rationale.
      const content = prepareExtractionContent(session.messages, MAX_SESSION_CONTENT_LENGTH)
      if (!content) return null

      return {
        content,
        projectId: session.projectId ?? undefined,
        projectName: session.projectPath?.split('/').pop() ?? undefined,
      }
    },
  })
  memoryService.initialize()

  return {
    database,
    inboxService,
    issueService,
    contextRefStore,
    issueViewService,
    orchestrator,
    projectService,
    artifactService,
    browserService,
    terminalService,
    capabilityCenter,
    packageService,
    scheduleService,
    timeResolver,
    retryScheduler,
    eventListener,
    executionStore,
    noteStore,
    providerService,
    marketplaceService,
    repoSourceRegistry,
    gitService,
    memoryService,
    issueProviderService,
    issueSyncEngine,
    changeQueueStore,
    changeQueueService,
    pushEngine,
    issueCommentService,
    syncLogStore,
    lifecycleOperationCoordinator,
  }
}
