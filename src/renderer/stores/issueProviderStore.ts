// SPDX-License-Identifier: Apache-2.0

/**
 * issueProviderStore — Zustand store for Issue Provider (GitHub/GitLab) state.
 *
 * Manages the renderer-side list of connected issue providers for a project.
 * Data is fetched from the main process via IPC.
 */

import { create } from 'zustand'
import { createLogger } from '@/lib/logger'
import { getAppAPI } from '@/windowAPI'
import type {
  IssueProvider,
  CreateIssueProviderInput,
  UpdateIssueProviderInput,
  IssueProviderTestResult,
} from '@shared/types'

const log = createLogger('issueProviderStore')

// ─── Store Interface ──────────────────────────────────────────────────

export interface IssueProviderStoreState {
  providers: IssueProvider[]
  loading: boolean

  /** Load providers for a given project. */
  loadProviders(projectId: string): Promise<void>

  /** Create a new provider (GitHub/GitLab integration). */
  createProvider(input: CreateIssueProviderInput): Promise<IssueProvider>

  /** Update provider settings. */
  updateProvider(id: string, patch: UpdateIssueProviderInput): Promise<IssueProvider | null>

  /** Delete a provider. */
  deleteProvider(id: string): Promise<boolean>

  /** Test the connection of a provider. */
  testConnection(id: string): Promise<IssueProviderTestResult>

  /** Trigger an immediate sync for a provider. */
  triggerSync(id: string): Promise<void>

  /** Reset store to initial state. */
  reset(): void
}

// ─── Initial State ────────────────────────────────────────────────────

const initialState = {
  providers: [] as IssueProvider[],
  loading: false,
}

/** Monotonic sequence to discard stale loadProviders responses. */
let _loadProvidersSeq = 0

// ─── Store ────────────────────────────────────────────────────────────

export const useIssueProviderStore = create<IssueProviderStoreState>((set, get) => ({
  ...initialState,

  async loadProviders(projectId: string) {
    const seq = ++_loadProvidersSeq
    set({ loading: true })
    try {
      const providers = await getAppAPI()['issue-provider:list'](projectId)
      // Discard stale response if a newer loadProviders call was issued
      if (seq !== _loadProvidersSeq) return
      set({ providers, loading: false })
    } catch (err) {
      if (seq !== _loadProvidersSeq) return
      log.error('Failed to load issue providers', err)
      set({ loading: false })
    }
  },

  async createProvider(input: CreateIssueProviderInput) {
    const provider = await getAppAPI()['issue-provider:create'](input)
    set({ providers: [...get().providers, provider] })
    return provider
  },

  async updateProvider(id: string, patch: UpdateIssueProviderInput) {
    const updated = await getAppAPI()['issue-provider:update'](id, patch)
    if (updated) {
      set({
        providers: get().providers.map((p) => (p.id === id ? updated : p)),
      })
    }
    return updated
  },

  async deleteProvider(id: string) {
    const success = await getAppAPI()['issue-provider:delete'](id)
    if (success) {
      set({ providers: get().providers.filter((p) => p.id !== id) })
    }
    return success
  },

  async testConnection(id: string) {
    return getAppAPI()['issue-provider:test-connection'](id)
  },

  async triggerSync(id: string) {
    await getAppAPI()['issue-provider:sync-now'](id)
    // Refresh the provider to pick up updated lastSyncedAt from the backend
    try {
      const updated = await getAppAPI()['issue-provider:get'](id)
      if (updated) {
        set({ providers: get().providers.map((p) => (p.id === id ? updated : p)) })
      }
    } catch {
      // Non-critical — the data will refresh on next loadProviders call
    }
  },

  reset() {
    set(initialState)
  },
}))
