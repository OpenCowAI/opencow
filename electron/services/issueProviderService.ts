// SPDX-License-Identifier: Apache-2.0

import { nanoid } from 'nanoid'
import type { IssueProviderStore } from './issueProviderStore'
import type { CredentialStore } from './provider/credentialStore'
import type { AdapterRegistry } from './issue-sync/adapterRegistry'
import type {
  IssueProvider,
  CreateIssueProviderInput,
  UpdateIssueProviderInput,
  IssueProviderTestResult,
  DataBusEvent,
} from '../src/shared/types'

/**
 * Business logic for Issue Provider CRUD + credential management.
 *
 * Pattern follows {@link IssueService}: constructor DI with store + dispatch.
 */
export class IssueProviderService {
  private readonly store: IssueProviderStore
  private readonly credentialStore: CredentialStore<Record<string, string>>
  private readonly adapterRegistry: AdapterRegistry
  private readonly dispatch: (event: DataBusEvent) => void

  constructor(deps: {
    store: IssueProviderStore
    credentialStore: CredentialStore<Record<string, string>>
    adapterRegistry: AdapterRegistry
    dispatch: (event: DataBusEvent) => void
  }) {
    this.store = deps.store
    this.credentialStore = deps.credentialStore
    this.adapterRegistry = deps.adapterRegistry
    this.dispatch = deps.dispatch
  }

  async createProvider(input: CreateIssueProviderInput): Promise<IssueProvider> {
    // Validate uniqueness
    const existing = await this.store.getByRepo(
      input.projectId,
      input.platform,
      input.repoOwner,
      input.repoName,
    )
    if (existing) {
      throw new Error(
        `A ${input.platform} integration for ${input.repoOwner}/${input.repoName} already exists in this project.`
      )
    }

    const id = nanoid()
    const credentialKey = `issue-provider:${id}`
    const now = Date.now()

    // Store token securely via CredentialStore (OS Keychain + disk encryption)
    await this.credentialStore.update(credentialKey, input.authToken)

    const provider: IssueProvider = {
      id,
      projectId: input.projectId,
      platform: input.platform,
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      apiBaseUrl: input.apiBaseUrl ?? null,
      authTokenRef: credentialKey,
      authStorage: 'keychain',
      syncEnabled: true,
      syncIntervalS: input.syncIntervalS ?? 300,
      lastSyncedAt: null,
      syncDirection: 'readonly',
      syncCursor: null,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    }

    await this.store.add(provider)
    this.dispatch({ type: 'issue-providers:changed', payload: { projectId: input.projectId } })

    return provider
  }

  async getProvider(id: string): Promise<IssueProvider | null> {
    return this.store.get(id)
  }

  async listProviders(projectId: string): Promise<IssueProvider[]> {
    return this.store.list(projectId)
  }

  async updateProvider(id: string, patch: UpdateIssueProviderInput): Promise<IssueProvider | null> {
    const existing = await this.store.get(id)
    if (!existing) return null

    // Handle token rotation — use !== undefined to distinguish "not updating" from "updating"
    if (patch.authToken !== undefined) {
      if (!patch.authToken) throw new Error('Auth token cannot be empty.')
      await this.credentialStore.update(existing.authTokenRef, patch.authToken)
    }

    // Build provider-level patch (exclude authToken which is stored separately)
    const providerPatch: Partial<IssueProvider> = {}
    if (patch.syncEnabled !== undefined) providerPatch.syncEnabled = patch.syncEnabled
    if (patch.syncIntervalS !== undefined) providerPatch.syncIntervalS = patch.syncIntervalS
    if (patch.syncDirection !== undefined) providerPatch.syncDirection = patch.syncDirection
    if (patch.apiBaseUrl !== undefined) providerPatch.apiBaseUrl = patch.apiBaseUrl

    const updated = await this.store.update(id, providerPatch)
    if (updated) {
      this.dispatch({ type: 'issue-providers:changed', payload: { projectId: existing.projectId } })
    }

    return updated
  }

  async deleteProvider(id: string): Promise<boolean> {
    const existing = await this.store.get(id)
    if (!existing) return false

    // Remove credential from secure storage
    await this.credentialStore.remove(existing.authTokenRef)

    const deleted = await this.store.delete(id)
    if (deleted) {
      this.dispatch({ type: 'issue-providers:changed', payload: { projectId: existing.projectId } })
    }

    return deleted
  }

  /**
   * Test connectivity to the remote repo.
   * Decrypts the stored token, creates an adapter, and calls testConnection().
   */
  async testConnection(id: string): Promise<IssueProviderTestResult> {
    const provider = await this.store.get(id)
    if (!provider) {
      return { ok: false, error: 'Provider not found.' }
    }

    const token = await this.credentialStore.get(provider.authTokenRef)
    if (!token) {
      return { ok: false, error: 'Authentication token not found in secure storage.' }
    }

    const adapter = this.adapterRegistry.createAdapter(provider, token)
    return adapter.testConnection()
  }

  /**
   * Retrieve the decrypted token for a provider.
   * Used by SyncEngine to create adapters.
   */
  async getToken(provider: IssueProvider): Promise<string | undefined> {
    return this.credentialStore.get(provider.authTokenRef)
  }
}
