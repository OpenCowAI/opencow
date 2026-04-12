// SPDX-License-Identifier: Apache-2.0

/**
 * Phase B.3b — ProviderService profile-aware API contract.
 *
 * Exercises the new `applyProfileCredentialMigration` + `*ForProfile`
 * methods end-to-end against an in-memory CredentialStore stand-in,
 * without touching the Electron keychain.
 */

import { describe, expect, it, vi } from 'vitest'
import { ProviderService } from '../../../electron/services/provider/providerService'
import type { ProviderSettings } from '../../../src/shared/types'
import type { ProviderProfile } from '../../../src/shared/providerProfile'
import { asProviderProfileId } from '../../../src/shared/providerProfile'

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  shell: { openExternal: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8'),
  },
}))

/** Minimal CredentialStore-compatible fake that matches the shape ProviderService calls. */
class FakeCredentialStore {
  private readonly state = new Map<string, unknown>()

  async get<K extends string>(key: K): Promise<unknown> {
    const value = this.state.get(key)
    return value !== undefined ? structuredClone(value) : undefined
  }
  async getAs<U>(key: string): Promise<U | undefined> {
    const value = this.state.get(key)
    return value !== undefined ? (structuredClone(value) as U) : undefined
  }
  async update<K extends string>(key: K, value: unknown): Promise<void> {
    this.state.set(key, value)
  }
  async updateAs<U>(key: string, value: U): Promise<void> {
    this.state.set(key, value as unknown)
  }
  async remove(key: string): Promise<void> {
    this.state.delete(key)
  }
  async removeAt(key: string): Promise<void> {
    this.state.delete(key)
  }

  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.state.entries())
  }
}

function buildService(params: {
  store: FakeCredentialStore
  settings: ProviderSettings
}): ProviderService {
  const store = params.store as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore
  return new ProviderService({
    dispatch: () => {},
    credentialStore: store,
    getProviderSettings: () => params.settings,
  })
}

const migratedApiKeyProfile: ProviderProfile = {
  id: asProviderProfileId('prof_migrated_api_key'),
  name: 'Anthropic API',
  credential: { type: 'anthropic-api' },
  createdAt: '2026-04-12T20:00:00.000Z',
  updatedAt: '2026-04-12T20:00:00.000Z',
}

const migratedSubscriptionProfile: ProviderProfile = {
  id: asProviderProfileId('prof_migrated_subscription'),
  name: 'Claude Pro/Max',
  credential: { type: 'claude-subscription' },
  createdAt: '2026-04-12T20:00:00.000Z',
  updatedAt: '2026-04-12T20:00:00.000Z',
}

describe('ProviderService.applyProfileCredentialMigration', () => {
  it('moves a legacy api_key credential to the profile-scoped slot', async () => {
    const store = new FakeCredentialStore()
    await store.updateAs('apiKey', 'sk-ant-legacy')
    const service = buildService({
      store,
      settings: {
        activeMode: 'api_key',
        profiles: [migratedApiKeyProfile],
        defaultProfileId: migratedApiKeyProfile.id,
      },
    })

    await service.applyProfileCredentialMigration()

    const after = store.snapshot()
    expect(after['apiKey']).toBeUndefined()
    expect(after[`credential:${migratedApiKeyProfile.id}`]).toBe('sk-ant-legacy')
  })

  it('is idempotent — second run is a no-op', async () => {
    const store = new FakeCredentialStore()
    await store.updateAs('apiKey', 'sk-ant-legacy')
    const service = buildService({
      store,
      settings: {
        activeMode: 'api_key',
        profiles: [migratedApiKeyProfile],
        defaultProfileId: migratedApiKeyProfile.id,
      },
    })

    await service.applyProfileCredentialMigration()
    const after1 = store.snapshot()
    await service.applyProfileCredentialMigration()
    const after2 = store.snapshot()
    expect(after1).toEqual(after2)
  })

  it('preserves a value at the new key when both exist and removes the legacy one', async () => {
    const store = new FakeCredentialStore()
    await store.updateAs('apiKey', 'sk-ant-stale')
    await store.updateAs(`credential:${migratedApiKeyProfile.id}`, 'sk-ant-fresh')

    const service = buildService({
      store,
      settings: {
        activeMode: 'api_key',
        profiles: [migratedApiKeyProfile],
        defaultProfileId: migratedApiKeyProfile.id,
      },
    })

    await service.applyProfileCredentialMigration()

    const after = store.snapshot()
    expect(after['apiKey']).toBeUndefined()
    expect(after[`credential:${migratedApiKeyProfile.id}`]).toBe('sk-ant-fresh')
  })

  it('skips profiles whose id is not a migrated prefix (user-created profiles)', async () => {
    const store = new FakeCredentialStore()
    await store.updateAs('apiKey', 'sk-ant-legacy')

    const userCreated: ProviderProfile = {
      ...migratedApiKeyProfile,
      id: asProviderProfileId('prof_userabcdef'),
    }
    const service = buildService({
      store,
      settings: {
        activeMode: null,
        profiles: [userCreated],
        defaultProfileId: userCreated.id,
      },
    })

    await service.applyProfileCredentialMigration()

    const after = store.snapshot()
    expect(after['apiKey']).toBe('sk-ant-legacy') // untouched
    expect(after[`credential:${userCreated.id}`]).toBeUndefined()
  })

  it('returns early when no profiles are configured', async () => {
    const store = new FakeCredentialStore()
    await store.updateAs('apiKey', 'sk-ant-legacy')
    const service = buildService({
      store,
      settings: { activeMode: 'api_key' },
    })
    await service.applyProfileCredentialMigration()
    expect(store.snapshot()['apiKey']).toBe('sk-ant-legacy')
  })
})

describe('ProviderService.getProviderEnvForProfile', () => {
  it('returns the adapter env for a migrated api_key profile after migration', async () => {
    const store = new FakeCredentialStore()
    await store.updateAs('apiKey', 'sk-ant-real')
    const service = buildService({
      store,
      settings: {
        activeMode: 'api_key',
        profiles: [migratedApiKeyProfile],
        defaultProfileId: migratedApiKeyProfile.id,
      },
    })

    await service.applyProfileCredentialMigration()
    const env = await service.getProviderEnvForProfile(migratedApiKeyProfile.id)
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-real')
  })

  it('returns empty env when the profile id does not exist', async () => {
    const store = new FakeCredentialStore()
    const service = buildService({
      store,
      settings: {
        activeMode: null,
        profiles: [],
        defaultProfileId: null,
      },
    })
    const env = await service.getProviderEnvForProfile(asProviderProfileId('prof_missing'))
    expect(env).toEqual({})
  })

  it('layers settings.defaultModel into ANTHROPIC_DEFAULT_SONNET_MODEL', async () => {
    const store = new FakeCredentialStore()
    await store.updateAs('apiKey', 'sk-ant-real')
    const service = buildService({
      store,
      settings: {
        activeMode: 'api_key',
        defaultModel: 'claude-opus-4-6',
        profiles: [migratedApiKeyProfile],
        defaultProfileId: migratedApiKeyProfile.id,
      },
    })

    await service.applyProfileCredentialMigration()
    const env = await service.getProviderEnvForProfile(migratedApiKeyProfile.id)
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-opus-4-6')
  })

  it('prefers profile.preferredModel over settings.defaultModel', async () => {
    const store = new FakeCredentialStore()
    await store.updateAs('apiKey', 'sk-ant-real')
    const profileWithPref: ProviderProfile = {
      ...migratedApiKeyProfile,
      preferredModel: 'claude-sonnet-4-5',
    }
    const service = buildService({
      store,
      settings: {
        activeMode: 'api_key',
        defaultModel: 'claude-opus-4-6',
        profiles: [profileWithPref],
        defaultProfileId: profileWithPref.id,
      },
    })
    await service.applyProfileCredentialMigration()
    const env = await service.getProviderEnvForProfile(profileWithPref.id)
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-4-5')
  })
})

describe('ProviderService.getStatusForProfile', () => {
  it('returns authenticated for a subscription profile with stored OAuth', async () => {
    const store = new FakeCredentialStore()
    await store.updateAs(`credential:${migratedSubscriptionProfile.id}`, {
      accessToken: 'token-abc',
      refreshToken: 'refresh-abc',
      expiresAt: Date.now() + 60 * 60 * 1000,
      scopes: ['user:inference'],
      subscriptionType: 'pro',
    })

    const service = buildService({
      store,
      settings: {
        activeMode: 'subscription',
        profiles: [migratedSubscriptionProfile],
        defaultProfileId: migratedSubscriptionProfile.id,
      },
    })

    const status = await service.getStatusForProfile(migratedSubscriptionProfile.id)
    expect(status.state).toBe('authenticated')
    expect(status.mode).toBe('subscription')
  })

  it('returns unauthenticated for an unknown profile id', async () => {
    const store = new FakeCredentialStore()
    const service = buildService({
      store,
      settings: { activeMode: null, profiles: [], defaultProfileId: null },
    })
    const status = await service.getStatusForProfile(asProviderProfileId('prof_missing'))
    expect(status.state).toBe('unauthenticated')
    expect(status.mode).toBeNull()
  })
})
