// SPDX-License-Identifier: Apache-2.0

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, ProviderStatus } from '../../../src/shared/types'

// ── Per-store mock types ────────────────────────────────────────────

type AppStoreMock = {
  setProjects: ReturnType<typeof vi.fn>
  setSessions: ReturnType<typeof vi.fn>
  setOnboarding: ReturnType<typeof vi.fn>
  setRuntimeVersions: ReturnType<typeof vi.fn>
  setAppReady: ReturnType<typeof vi.fn>
}

type IssueStoreMock = {
  setIssuesFromInitialLoad: ReturnType<typeof vi.fn>
  loadCustomLabels: ReturnType<typeof vi.fn>
}

type CommandStoreMock = {
  setManagedSessions: ReturnType<typeof vi.fn>
}

type SettingsStoreMock = {
  setSettings: ReturnType<typeof vi.fn>
  setProviderStatus: ReturnType<typeof vi.fn>
  setSystemLocale: ReturnType<typeof vi.fn>
  loadProviderStatus: ReturnType<typeof vi.fn>
}

type ScheduleStoreMock = {
  loadSchedules: ReturnType<typeof vi.fn>
  loadPipelines: ReturnType<typeof vi.fn>
}

type TasksStoreMock = {
  setAllTasks: ReturnType<typeof vi.fn>
}

type StatsStoreMock = {
  setStats: ReturnType<typeof vi.fn>
}

type InboxStoreMock = {
  setInboxState: ReturnType<typeof vi.fn>
}

type MessagingStoreMock = {
  loadMessagingConnectionStatuses: ReturnType<typeof vi.fn>
}

// ── Hoisted mock state ──────────────────────────────────────────────

const hoisted = vi.hoisted(() => ({
  appStore: null as AppStoreMock | null,
  issueStore: null as IssueStoreMock | null,
  commandStore: null as CommandStoreMock | null,
  settingsStore: null as SettingsStoreMock | null,
  scheduleStore: null as ScheduleStoreMock | null,
  tasksStore: null as TasksStoreMock | null,
  statsStore: null as StatsStoreMock | null,
  inboxStore: null as InboxStoreMock | null,
  messagingStore: null as MessagingStoreMock | null,
  api: {} as Record<string, unknown>,
  queryIssueSummaries: vi.fn(),
  applyLocale: vi.fn(),
  resolveLocale: vi.fn().mockReturnValue('en-US'),
}))

// ── Module mocks ────────────────────────────────────────────────────

vi.mock('@/stores/appStore', () => ({
  useAppStore: { getState: () => hoisted.appStore },
}))

vi.mock('@/stores/issueStore', () => ({
  useIssueStore: { getState: () => hoisted.issueStore },
}))

vi.mock('@/stores/commandStore', () => ({
  useCommandStore: { getState: () => hoisted.commandStore },
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => hoisted.settingsStore },
}))

vi.mock('@/stores/scheduleStore', () => ({
  useScheduleStore: { getState: () => hoisted.scheduleStore },
}))

vi.mock('@/stores/tasksStore', () => ({
  useTasksStore: { getState: () => hoisted.tasksStore },
}))

vi.mock('@/stores/statsStore', () => ({
  useStatsStore: { getState: () => hoisted.statsStore },
}))

vi.mock('@/stores/inboxStore', () => ({
  useInboxStore: { getState: () => hoisted.inboxStore },
}))

vi.mock('@/stores/messagingStore', () => ({
  useMessagingStore: { getState: () => hoisted.messagingStore },
}))

vi.mock('@/windowAPI', () => ({
  getAppAPI: () => hoisted.api,
}))

vi.mock('@/lib/query/issueQueryService', () => ({
  queryIssueSummaries: hoisted.queryIssueSummaries,
}))

vi.mock('@/i18n', () => ({
  applyLocale: hoisted.applyLocale,
}))

vi.mock('@shared/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/i18n')>()
  return {
    ...actual,
    resolveLocale: hoisted.resolveLocale,
  }
})

// ── Factory helpers ─────────────────────────────────────────────────

function createAppStoreMock(): AppStoreMock {
  return {
    setProjects: vi.fn(),
    setSessions: vi.fn(),
    setOnboarding: vi.fn(),
    setRuntimeVersions: vi.fn(),
    setAppReady: vi.fn(),
  }
}

function createIssueStoreMock(): IssueStoreMock {
  return {
    setIssuesFromInitialLoad: vi.fn(),
    loadCustomLabels: vi.fn().mockResolvedValue(undefined),
  }
}

function createCommandStoreMock(): CommandStoreMock {
  return {
    setManagedSessions: vi.fn(),
  }
}

function createSettingsStoreMock(): SettingsStoreMock {
  return {
    setSettings: vi.fn(),
    setProviderStatus: vi.fn(),
    setSystemLocale: vi.fn(),
    loadProviderStatus: vi.fn().mockResolvedValue({ state: 'authenticated', mode: 'subscription' }),
  }
}

function createScheduleStoreMock(): ScheduleStoreMock {
  return {
    loadSchedules: vi.fn().mockResolvedValue(undefined),
    loadPipelines: vi.fn().mockResolvedValue(undefined),
  }
}

function createTasksStoreMock(): TasksStoreMock {
  return { setAllTasks: vi.fn() }
}

function createStatsStoreMock(): StatsStoreMock {
  return { setStats: vi.fn() }
}

function createInboxStoreMock(): InboxStoreMock {
  return { setInboxState: vi.fn() }
}

function createMessagingStoreMock(): MessagingStoreMock {
  return {
    loadMessagingConnectionStatuses: vi.fn().mockResolvedValue(undefined),
  }
}

function createSettings(): AppSettings {
  return {
    command: { defaultEngine: 'claude' },
    provider: {
      byEngine: {
        claude: { activeMode: 'subscription' },
        codex: { activeMode: null },
      },
    },
    language: 'system',
  } as AppSettings
}

function createProviderStatus(): ProviderStatus {
  return {
    state: 'authenticated',
    mode: 'subscription',
  }
}

function createInitialState() {
  return {
    projects: [],
    sessions: [],
    tasks: {},
    stats: null,
    onboarding: { completed: true, hooksInstalled: true },
    inboxMessages: [],
    inboxUnreadCount: 0,
    settings: createSettings(),
    providerStatus: createProviderStatus(),
    systemLocale: 'en-US',
  }
}

// ── Tests ───────────────────────────────────────────────────────────

describe('bootstrapCoordinator', () => {
  beforeEach(() => {
    vi.resetModules()
    hoisted.appStore = createAppStoreMock()
    hoisted.issueStore = createIssueStoreMock()
    hoisted.commandStore = createCommandStoreMock()
    hoisted.settingsStore = createSettingsStoreMock()
    hoisted.scheduleStore = createScheduleStoreMock()
    hoisted.tasksStore = createTasksStoreMock()
    hoisted.statsStore = createStatsStoreMock()
    hoisted.inboxStore = createInboxStoreMock()
    hoisted.messagingStore = createMessagingStoreMock()
    hoisted.api = {
      'get-initial-state': vi.fn().mockResolvedValue(createInitialState()),
      'command:list-managed-sessions': vi.fn().mockResolvedValue([]),
    }
    hoisted.queryIssueSummaries.mockReset()
    hoisted.queryIssueSummaries.mockResolvedValue([])
    hoisted.applyLocale.mockReset()
    hoisted.resolveLocale.mockReset()
    hoisted.resolveLocale.mockReturnValue('en-US')
  })

  it('runs critical + supplementary bootstrap only once for concurrent callers', async () => {
    const module = await import('../../../src/renderer/lib/bootstrap/bootstrapCoordinator')

    const p1 = module.ensureBootstrapDataLoaded()
    const p2 = module.ensureBootstrapDataLoaded()
    await Promise.all([p1, p2])
    await Promise.resolve()

    const api = hoisted.api as Record<string, ReturnType<typeof vi.fn>>

    // Critical stage — called once despite concurrent callers
    expect(api['get-initial-state']).toHaveBeenCalledTimes(1)
    expect(api['command:list-managed-sessions']).toHaveBeenCalledTimes(1)
    expect(hoisted.queryIssueSummaries).toHaveBeenCalledTimes(1)

    // Supplementary stage — each domain store called once
    expect(hoisted.settingsStore!.loadProviderStatus).toHaveBeenCalledTimes(1)
    expect(hoisted.scheduleStore!.loadSchedules).toHaveBeenCalledTimes(1)
    expect(hoisted.scheduleStore!.loadPipelines).toHaveBeenCalledTimes(1)
    expect(hoisted.issueStore!.loadCustomLabels).toHaveBeenCalledTimes(1)
    expect(hoisted.messagingStore!.loadMessagingConnectionStatuses).toHaveBeenCalledTimes(1)
    expect(hoisted.appStore!.setAppReady).toHaveBeenCalledTimes(1)
  })

  it('returns immediately after coordinator reaches ready phase', async () => {
    const module = await import('../../../src/renderer/lib/bootstrap/bootstrapCoordinator')

    await module.ensureBootstrapDataLoaded()
    await module.ensureBootstrapDataLoaded()

    const api = hoisted.api as Record<string, ReturnType<typeof vi.fn>>

    // IPC called only once (idempotent guard)
    expect(api['get-initial-state']).toHaveBeenCalledTimes(1)
    expect(api['command:list-managed-sessions']).toHaveBeenCalledTimes(1)
    expect(hoisted.queryIssueSummaries).toHaveBeenCalledTimes(1)

    // Each domain store's supplementary loader called once
    expect(hoisted.scheduleStore!.loadSchedules).toHaveBeenCalledTimes(1)
    expect(hoisted.scheduleStore!.loadPipelines).toHaveBeenCalledTimes(1)
    expect(hoisted.issueStore!.loadCustomLabels).toHaveBeenCalledTimes(1)
    expect(hoisted.messagingStore!.loadMessagingConnectionStatuses).toHaveBeenCalledTimes(1)
    expect(hoisted.appStore!.setAppReady).toHaveBeenCalledTimes(1)
  })
})
