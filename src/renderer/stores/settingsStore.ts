// SPDX-License-Identifier: Apache-2.0

/**
 * settingsStore — Application settings and AI provider status.
 *
 * Combines the former SettingsSlice and ProviderSlice into one store
 * because they share a mutual dependency: setSettings reads
 * providerStatusByEngine, and setProviderStatus reads settings
 * to resolve the default engine.
 *
 * Completely independent of all other stores — no cross-store reads
 * or writes.
 *
 * Populated by:
 *   - bootstrapCoordinator (setSettings, setProviderStatus, setSystemLocale)
 *   - DataBus settings:updated / provider:status events in useAppBootstrap
 *   - User interactions in Settings modal
 */

import { create } from 'zustand'
import { createLogger } from '@/lib/logger'
import type {
  AIEngineKind,
  AppSettings,
  ProviderStatus,
} from '@shared/types'
import { getAppAPI } from '@/windowAPI'
import {
  queryProviderStatus,
  primeProviderStatusCache,
} from '@/lib/query/providerStatusQueryService'

// ─── Types ────────────────────────────────────────────────────────────

export type SettingsTab = 'general' | 'provider' | 'network' | 'command' | 'notifications' | 'webhooks' | 'messaging' | 'evose' | 'updates'

interface SetProviderStatusInput {
  status: ProviderStatus | null
}

interface SetProviderStatusForEngineInput {
  engineKind: AIEngineKind
  status: ProviderStatus | null
  syncGlobal?: boolean
}

interface LoadProviderStatusInput {
  engineKind: AIEngineKind
  syncGlobal?: boolean
  force?: boolean
  maxAgeMs?: number
}

// ─── Store Interface ──────────────────────────────────────────────────

export interface SettingsStore {
  // Settings state
  settings: AppSettings | null
  settingsModalOpen: boolean
  settingsModalTab: SettingsTab | null
  /** System locale reported by Electron main process (e.g. 'zh-CN', 'en-US'). */
  systemLocale: string
  setSettings: (settings: AppSettings) => void
  setSystemLocale: (locale: string) => void
  openSettingsModal: (tab?: SettingsTab) => void
  closeSettingsModal: () => void
  updateSettings: (settings: AppSettings) => Promise<void>

  // Provider state
  providerStatus: ProviderStatus | null
  providerStatusByEngine: Record<AIEngineKind, ProviderStatus | null>
  setProviderStatus: (input: SetProviderStatusInput) => void
  setProviderStatusForEngine: (input: SetProviderStatusForEngineInput) => void
  loadProviderStatus: (input: LoadProviderStatusInput) => Promise<ProviderStatus | null>

  // Reset
  reset: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────

const log = createLogger('SettingsStore')

function resolveDefaultProviderEngine(settings: AppSettings | null): AIEngineKind {
  return settings?.command.defaultEngine ?? 'claude'
}

/**
 * Module-level mutable state for debounced settings persistence.
 * Lives outside Zustand to avoid render loops — the debounce timer and
 * pending write are implementation details of the persistence mechanism,
 * not observable UI state.
 */
let settingsPendingWrite: AppSettings | null = null
let settingsDebounceTimer: ReturnType<typeof setTimeout> | null = null

function persistSettings(settings: AppSettings): void {
  getAppAPI()['update-settings'](settings).catch((err: unknown) => {
    log.error('Failed to persist settings', err)
  })
}

function debouncedPersistSettings(settings: AppSettings): void {
  settingsPendingWrite = settings
  if (settingsDebounceTimer) clearTimeout(settingsDebounceTimer)
  settingsDebounceTimer = setTimeout(() => {
    settingsPendingWrite = null
    persistSettings(settings)
  }, 300)
}

function flushPendingSettings(): void {
  if (settingsPendingWrite) {
    if (settingsDebounceTimer) clearTimeout(settingsDebounceTimer)
    persistSettings(settingsPendingWrite)
    settingsPendingWrite = null
  }
}

// ─── Default State ────────────────────────────────────────────────────

const initialState = {
  settings: null as AppSettings | null,
  settingsModalOpen: false,
  settingsModalTab: null as SettingsTab | null,
  systemLocale: 'en-US',
  providerStatus: null as ProviderStatus | null,
  providerStatusByEngine: {
    claude: null,
    codex: null,
  } as Record<AIEngineKind, ProviderStatus | null>,
}

// ─── Store ────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  // Settings slice
  ...initialState,

  setSettings: (settings) =>
    set((s) => {
      const defaultEngine = resolveDefaultProviderEngine(settings)
      return {
        settings,
        providerStatus: s.providerStatusByEngine[defaultEngine] ?? null,
      }
    }),
  setSystemLocale: (locale) => set({ systemLocale: locale }),
  openSettingsModal: (tab) => set({ settingsModalOpen: true, settingsModalTab: tab ?? null }),
  closeSettingsModal: () => {
    flushPendingSettings()
    set({ settingsModalOpen: false, settingsModalTab: null })
  },
  updateSettings: async (settings) => {
    // Optimistic update — apply immediately to avoid theme flicker
    set((s) => {
      const defaultEngine = resolveDefaultProviderEngine(settings)
      return {
        settings,
        providerStatus: s.providerStatusByEngine[defaultEngine] ?? null,
      }
    })
    // Debounced IPC write to avoid excessive disk writes on rapid input
    debouncedPersistSettings(settings)
  },

  // Provider slice
  setProviderStatus: ({ status }) =>
    set((s) => {
      const defaultEngine = resolveDefaultProviderEngine(s.settings)
      primeProviderStatusCache({ engineKind: defaultEngine, status })
      return {
        providerStatus: status,
        providerStatusByEngine: {
          ...s.providerStatusByEngine,
          [defaultEngine]: status,
        },
      }
    }),
  setProviderStatusForEngine: ({ engineKind, status, syncGlobal }) =>
    set((s) => {
      const shouldSyncGlobal = syncGlobal ?? engineKind === resolveDefaultProviderEngine(s.settings)
      primeProviderStatusCache({ engineKind, status })
      return {
        providerStatusByEngine: {
          ...s.providerStatusByEngine,
          [engineKind]: status,
        },
        ...(shouldSyncGlobal ? { providerStatus: status } : {}),
      }
    }),
  loadProviderStatus: async ({ engineKind, syncGlobal, force = false, maxAgeMs }) => {
    try {
      const status = await queryProviderStatus({ engineKind, force, maxAgeMs })
      get().setProviderStatusForEngine({ engineKind, status, syncGlobal })
      return status
    } catch (error: unknown) {
      log.error('Failed to load provider status', { engineKind, error })
      return null
    }
  },

  // Reset
  reset: () => set(initialState),
}))
