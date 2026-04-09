// SPDX-License-Identifier: Apache-2.0

import { createLogger } from '@/lib/logger'
import { useAppStore } from '@/stores/appStore'
import { useIssueStore } from '@/stores/issueStore'
import { useCommandStore } from '@/stores/commandStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { useTasksStore } from '@/stores/tasksStore'
import { useStatsStore } from '@/stores/statsStore'
import { useInboxStore } from '@/stores/inboxStore'
import { useMessagingStore } from '@/stores/messagingStore'
import { getAppAPI } from '@/windowAPI'
import { resolveLocale } from '@shared/i18n'
import { applyLocale } from '@/i18n'
import { queryIssueSummaries } from '@/lib/query/issueQueryService'

const log = createLogger('BootstrapCoordinator')

type BootstrapPhase = 'idle' | 'running' | 'ready'

let phase: BootstrapPhase = 'idle'
let inFlightBootstrap: Promise<void> | null = null

function loadSupplementaryData(): void {
  const store = useAppStore.getState()

  void useScheduleStore.getState().loadSchedules().catch((error: unknown) => {
    log.error('Failed to load schedules during bootstrap', error)
  })

  void useScheduleStore.getState().loadPipelines().catch((error: unknown) => {
    log.error('Failed to load pipelines during bootstrap', error)
  })

  void getAppAPI()['command:list-managed-sessions']()
    .then((sessions) => {
      if (sessions.length > 0) {
        useCommandStore.getState().setManagedSessions(sessions)
      }
    })
    .catch((error: unknown) => {
      log.error('Failed to load managed sessions during bootstrap', error)
    })

  void queryIssueSummaries({ filter: {} })
    .then((issues) => {
      if (issues.length > 0) {
        useIssueStore.getState().setIssuesFromInitialLoad(issues)
      }
    })
    .catch((error: unknown) => {
      log.error('Failed to load issue summaries during bootstrap', error)
    })

  void useIssueStore.getState().loadCustomLabels().catch((error: unknown) => {
    log.error('Failed to load custom labels during bootstrap', error)
  })

  void useMessagingStore.getState().loadMessagingConnectionStatuses().catch((error: unknown) => {
    log.error('Failed to load messaging statuses during bootstrap', error)
  })
}

async function runCriticalBootstrapStage(): Promise<void> {
  const state = await getAppAPI()['get-initial-state']()
  const store = useAppStore.getState()

  store.setProjects(state.projects)
  store.setSessions(state.sessions)
  useTasksStore.getState().setAllTasks(state.tasks)
  if (state.stats) useStatsStore.getState().setStats(state.stats)
  store.setOnboarding(state.onboarding)
  useInboxStore.getState().setInboxState({
    messages: state.inboxMessages,
    unreadCount: state.inboxUnreadCount,
  })
  const settingsStore = useSettingsStore.getState()
  if (state.settings) settingsStore.setSettings(state.settings)
  if (state.providerStatus) settingsStore.setProviderStatus({ status: state.providerStatus })

  settingsStore.setSystemLocale(state.systemLocale)
  store.setRuntimeVersions(state.runtimeVersions)
  const locale = resolveLocale(state.settings?.language, state.systemLocale)
  applyLocale(locale)

  const providerEngine = state.settings?.command.defaultEngine ?? 'claude'
  void settingsStore.loadProviderStatus({ engineKind: providerEngine, syncGlobal: true })
    .catch((error: unknown) => {
      log.error('Failed to load provider status during bootstrap', error)
    })
}

/**
 * Ensure bootstrap data is loaded exactly once per renderer lifecycle.
 * StrictMode double-mounts share a single in-flight Promise.
 */
export function ensureBootstrapDataLoaded(): Promise<void> {
  if (phase === 'ready') return Promise.resolve()
  if (inFlightBootstrap) return inFlightBootstrap

  phase = 'running'

  inFlightBootstrap = runCriticalBootstrapStage()
    .catch((error: unknown) => {
      log.error('Failed to load critical bootstrap state', error)
      // Prevent false onboarding lock: when critical bootstrap fails, recover
      // onboarding state directly instead of leaving the default {completed:false}.
      return getAppAPI()['get-onboarding-state']()
        .then((onboarding) => {
          useAppStore.getState().setOnboarding(onboarding)
          log.warn('Recovered onboarding state from fallback IPC after bootstrap failure', {
            completed: onboarding.completed,
            hooksInstalled: onboarding.hooksInstalled,
          })
        })
        .catch((fallbackError: unknown) => {
          log.error('Failed to recover onboarding state after bootstrap failure', fallbackError)
        })
    })
    .finally(() => {
      loadSupplementaryData()
      useAppStore.getState().setAppReady(true)
      phase = 'ready'
      inFlightBootstrap = null
    })

  return inFlightBootstrap
}
