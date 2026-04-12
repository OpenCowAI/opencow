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

describe('ProviderService.createProfile / updateProfile / removeProfile', () => {
  function buildMutableService() {
    const store = new FakeCredentialStore()
    const settings: ProviderSettings = {
      activeMode: null,
      profiles: [],
      defaultProfileId: null,
    }
    const svcStore = store as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore
    const service = new ProviderService({
      dispatch: () => {},
      credentialStore: svcStore,
      getProviderSettings: () => settings,
      updateProviderSettings: async (patch) => {
        Object.assign(settings, patch)
        return settings
      },
    })
    return { service, settings, store }
  }

  it('creates a profile, authenticates, and stores the credential', async () => {
    const { service, settings, store } = buildMutableService()

    const profile = await service.createProfile({
      name: 'Personal API',
      credential: { type: 'anthropic-api' },
      authParams: { apiKey: 'sk-ant-personal' },
    })

    expect(profile.id).toMatch(/^prof_[a-z0-9]{10}$/)
    expect(settings.profiles).toHaveLength(1)
    expect(settings.defaultProfileId).toBe(profile.id) // first profile becomes default
    expect(store.snapshot()[`credential:${profile.id}`]).toBe('sk-ant-personal')
  })

  it('rejects createProfile if adapter authenticate fails and leaves no orphan', async () => {
    const { service, settings, store } = buildMutableService()

    await expect(
      service.createProfile({
        name: 'Bad Key',
        credential: { type: 'anthropic-api' },
        authParams: { apiKey: 'not-a-valid-key' }, // wrong prefix
      }),
    ).rejects.toThrow(/Authentication failed/)

    expect(settings.profiles).toEqual([])
    expect(store.snapshot()).toEqual({})
  })

  it('setAsDefault=false keeps existing default when a second profile is created', async () => {
    const { service, settings } = buildMutableService()

    const first = await service.createProfile({
      name: 'First',
      credential: { type: 'anthropic-api' },
      authParams: { apiKey: 'sk-ant-first' },
    })
    await service.createProfile({
      name: 'Second',
      credential: { type: 'anthropic-api' },
      authParams: { apiKey: 'sk-ant-second' },
    })

    expect(settings.defaultProfileId).toBe(first.id)
    expect(settings.profiles).toHaveLength(2)
  })

  it('updateProfile renames without requiring re-authentication', async () => {
    const { service } = buildMutableService()
    const profile = await service.createProfile({
      name: 'Original',
      credential: { type: 'anthropic-api' },
      authParams: { apiKey: 'sk-ant-key' },
    })

    const updated = await service.updateProfile(profile.id, { name: '  New Name  ' })

    expect(updated.name).toBe('New Name')
    expect(updated.credential).toEqual(profile.credential)
  })

  it('updateProfile rejects re-authentication failure', async () => {
    const { service } = buildMutableService()
    const profile = await service.createProfile({
      name: 'P',
      credential: { type: 'anthropic-api' },
      authParams: { apiKey: 'sk-ant-key' },
    })

    await expect(
      service.updateProfile(profile.id, { authParams: { apiKey: 'bogus' } }),
    ).rejects.toThrow(/Re-authentication failed/)
  })

  it('removeProfile clears credentials and reassigns default when needed', async () => {
    const { service, settings, store } = buildMutableService()
    const first = await service.createProfile({
      name: 'First',
      credential: { type: 'anthropic-api' },
      authParams: { apiKey: 'sk-ant-first' },
    })
    const second = await service.createProfile({
      name: 'Second',
      credential: { type: 'anthropic-api' },
      authParams: { apiKey: 'sk-ant-second' },
    })

    const removed = await service.removeProfile(first.id)

    expect(removed).toBe(true)
    expect(settings.profiles.map((p) => p.id)).toEqual([second.id])
    expect(settings.defaultProfileId).toBe(second.id)
    expect(store.snapshot()[`credential:${first.id}`]).toBeUndefined()
  })

  it('removeProfile sets defaultProfileId to null when removing the last profile', async () => {
    const { service, settings } = buildMutableService()
    const only = await service.createProfile({
      name: 'Only',
      credential: { type: 'anthropic-api' },
      authParams: { apiKey: 'sk-ant-key' },
    })

    await service.removeProfile(only.id)

    expect(settings.profiles).toEqual([])
    expect(settings.defaultProfileId).toBeNull()
  })

  it('setDefaultProfile rejects an unknown id', async () => {
    const { service } = buildMutableService()
    await expect(
      service.setDefaultProfile(asProviderProfileId('prof_missing')),
    ).rejects.toThrow(/profile not found/)
  })

  it('throws when mutator is called without updateProviderSettings dep', async () => {
    const store = new FakeCredentialStore()
    const service = buildService({
      store,
      settings: { activeMode: null, profiles: [], defaultProfileId: null },
    })
    await expect(
      service.createProfile({
        name: 'X',
        credential: { type: 'anthropic-api' },
      }),
    ).rejects.toThrow(/updateProviderSettings dep is required/)
  })
})

describe('ProviderService.testProfile', () => {
  function buildWithStore(store: FakeCredentialStore, profile: ProviderProfile) {
    const svcStore = store as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore
    return new ProviderService({
      dispatch: () => {},
      credentialStore: svcStore,
      getProviderSettings: () => ({
        activeMode: null,
        profiles: [profile],
        defaultProfileId: profile.id,
      }),
    })
  }

  it('returns ok=true when the adapter reports authenticated', async () => {
    const store = new FakeCredentialStore()
    await store.updateAs(`credential:${migratedApiKeyProfile.id}`, 'sk-ant-key')
    const service = buildWithStore(store, migratedApiKeyProfile)

    const result = await service.testProfile(migratedApiKeyProfile.id)

    expect(result.outcome.ok).toBe(true)
    expect(result.profileId).toBe(migratedApiKeyProfile.id)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('returns ok=false with reason=unauthenticated when credentials are missing', async () => {
    const store = new FakeCredentialStore()
    const service = buildWithStore(store, migratedApiKeyProfile)

    const result = await service.testProfile(migratedApiKeyProfile.id)

    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) {
      expect(result.outcome.reason).toBe('unauthenticated')
    }
  })

  it('returns ok=false with reason=unsupported for types not yet implemented', async () => {
    const store = new FakeCredentialStore()
    const geminiProfile: ProviderProfile = {
      id: asProviderProfileId('prof_gemini123'),
      name: 'Gemini',
      credential: { type: 'gemini' },
      createdAt: '2026-04-12T20:00:00.000Z',
      updatedAt: '2026-04-12T20:00:00.000Z',
    }
    const service = buildWithStore(store, geminiProfile)

    const result = await service.testProfile(geminiProfile.id)

    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) {
      expect(result.outcome.reason).toBe('unsupported')
    }
  })

  it('returns ok=false with reason=error for unknown profile id', async () => {
    const store = new FakeCredentialStore()
    const service = buildWithStore(store, migratedApiKeyProfile)

    const result = await service.testProfile(asProviderProfileId('prof_missing'))

    expect(result.outcome.ok).toBe(false)
    if (!result.outcome.ok) {
      expect(result.outcome.reason).toBe('error')
    }
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
