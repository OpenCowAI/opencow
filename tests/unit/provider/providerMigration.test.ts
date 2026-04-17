// SPDX-License-Identifier: Apache-2.0

/**
 * Phase B.7 provider migration — end-to-end tests.
 *
 * Exercises the full runProviderMigration() entry point against an
 * in-memory fake SettingsService and two fake CredentialStores. Covers
 * every pre-v1 shape OpenCow has shipped:
 *
 *   0.3.21 (pre-A):    provider.byEngine.{claude,codex}.activeMode
 *   Phase A flat:      provider.activeMode
 *   Phase B preview:   provider.activeMode + profiles (re-derived)
 *   fresh install:     no provider field
 *   already migrated:  provider.schemaVersion === 1
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planProviderMigration } from '../../../electron/services/provider/migration/plan'
import { applyProviderMigration } from '../../../electron/services/provider/migration/apply'
import { runProviderMigration } from '../../../electron/services/provider/migration'
import type {
  AppSettings,
  ProviderSettings,
} from '../../../src/shared/types'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8'),
  },
}))

// Must mock fs/promises.unlink — apply.ts calls it during cleanup.
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises')
  return {
    ...actual,
    unlink: vi.fn(async () => {}),
  }
})

class FakeStore {
  private readonly state = new Map<string, unknown>()
  async get<K extends string>(key: K): Promise<unknown> {
    return this.state.get(key)
  }
  async getAs<U>(key: string): Promise<U | undefined> {
    const v = this.state.get(key)
    return v !== undefined ? (v as U) : undefined
  }
  async update<K extends string>(key: K, v: unknown): Promise<void> {
    this.state.set(key, v)
  }
  async updateAs<U>(key: string, v: U): Promise<void> {
    this.state.set(key, v as unknown)
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

class FakeSettingsService {
  private data: AppSettings
  constructor(initial: Partial<AppSettings>) {
    this.data = {
      theme: { mode: 'system', scheme: 'zinc', texture: 'plain' },
      proxy: { httpsProxy: '', httpProxy: '', noProxy: '' },
      command: { maxTurns: 10000, permissionMode: 'bypassPermissions' },
      eventSubscriptions: { enabled: true, onError: true, onComplete: true, onStatusChange: true },
      webhooks: { endpoints: [] },
      provider: { profiles: [], defaultProfileId: null },
      messaging: { connections: [] },
      schedule: {
        enabled: true,
        maxConcurrentExecutions: 3,
        quietHours: { enabled: false, start: '23:00', end: '07:00' },
      },
      evose: {
        apiKey: '',
        baseUrl: '',
        workspaceIds: [],
        apps: [],
      },
      language: 'system',
      updates: { autoCheckUpdates: true, updateCheckInterval: '4h' },
      ...initial,
    } as AppSettings
  }
  async load(): Promise<AppSettings> {
    return this.data
  }
  async update(next: AppSettings): Promise<AppSettings> {
    this.data = next
    return this.data
  }
  getProviderSettings(): ProviderSettings {
    return this.data.provider
  }
  getProxyEnv() {
    return {}
  }
}

// ─── Plan-level tests ────────────────────────────────────────────────

describe('planProviderMigration', () => {
  it('returns already-migrated when schemaVersion is 1', () => {
    const plan = planProviderMigration({
      rawProvider: { schemaVersion: 1, profiles: [], defaultProfileId: null },
      legacyCodexFilePresent: false,
    })
    expect(plan.reason).toBe('already-migrated')
    expect(plan.credentialMoves).toHaveLength(0)
  })

  it('returns fresh-install for empty provider object', () => {
    const plan = planProviderMigration({ rawProvider: {}, legacyCodexFilePresent: false })
    expect(plan.reason).toBe('fresh-install')
    expect(plan.targetSettings.schemaVersion).toBe(1)
    expect(plan.targetSettings.profiles).toEqual([])
  })

  it('migrates Phase A flat activeMode=api_key into a single Anthropic profile', () => {
    const plan = planProviderMigration({
      rawProvider: { activeMode: 'api_key', defaultModel: 'claude-opus-4-6' },
      legacyCodexFilePresent: false,
    })
    expect(plan.reason).toBe('upgrade')
    expect(plan.targetSettings.profiles).toHaveLength(1)
    expect(plan.targetSettings.profiles[0].credential.type).toBe('anthropic-api')
    expect(plan.targetSettings.defaultProfileId).toBe(plan.targetSettings.profiles[0].id)
    // Legacy top-level defaultModel folds into the migrated profile's
    // preferredModel — per-profile is the only shape that survives B.7.
    expect(plan.targetSettings.profiles[0].preferredModel).toBe('claude-opus-4-6')
    expect(plan.credentialMoves).toHaveLength(1)
    expect(plan.credentialMoves[0]).toMatchObject({
      source: 'main',
      fromKey: 'apiKey',
      toKey: `credential:${plan.targetSettings.profiles[0].id}`,
    })
  })

  it('migrates pre-Phase-A byEngine.{claude,codex} into two profiles', () => {
    const plan = planProviderMigration({
      rawProvider: {
        byEngine: {
          claude: { activeMode: 'subscription' },
          codex: { activeMode: 'custom' },
        },
      },
      legacyCodexFilePresent: true,
    })
    expect(plan.reason).toBe('upgrade')
    expect(plan.targetSettings.profiles).toHaveLength(2)
    const [first, second] = plan.targetSettings.profiles
    expect(first.credential.type).toBe('claude-subscription')
    expect(second.credential.type).toBe('openai-compat-proxy')
    // Default goes to Claude (Codex runtime mapped to OpenAI is a
    // behavioural change — auto-default would surprise the user).
    expect(plan.targetSettings.defaultProfileId).toBe(first.id)
    expect(plan.deleteLegacyCodexFile).toBe(true)
  })

  it('skips codex credential moves when the legacy file is missing', () => {
    const plan = planProviderMigration({
      rawProvider: {
        byEngine: { codex: { activeMode: 'custom' } },
      },
      legacyCodexFilePresent: false,
    })
    expect(plan.targetSettings.profiles).toHaveLength(1)
    // Profile is created so the user can re-authenticate, but no move.
    expect(plan.credentialMoves).toHaveLength(0)
    expect(plan.deleteLegacyCodexFile).toBe(false)
  })
})

// ─── End-to-end tests ────────────────────────────────────────────────

describe('runProviderMigration end-to-end', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('moves api_key credential, writes v1 schema, removes legacy key', async () => {
    const mainStore = new FakeStore()
    await mainStore.updateAs('apiKey', 'sk-ant-migrate')
    const settingsService = new FakeSettingsService({
      provider: { activeMode: 'api_key' } as unknown as ProviderSettings,
    })

    await runProviderMigration({
      settingsService: settingsService as unknown as import('../../../electron/services/settingsService').SettingsService,
      mainCredentialStore: mainStore as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      legacyCodexCredentialStore: null,
      legacyCodexCredentialsPath: '/tmp/credentials-codex.enc',
    })

    const saved = await settingsService.load()
    expect(saved.provider.schemaVersion).toBe(1)
    expect(saved.provider.profiles).toHaveLength(1)
    const profile = saved.provider.profiles[0]
    expect(profile.credential.type).toBe('anthropic-api')
    expect(mainStore.snapshot()[`credential:${profile.id}`]).toBe('sk-ant-migrate')
    // Legacy key cleaned up (MOVE semantics).
    expect(mainStore.snapshot()['apiKey']).toBeUndefined()
  })

  it('normalises openrouter blob + backfills profile baseUrl/authStyle', async () => {
    const mainStore = new FakeStore()
    await mainStore.updateAs('openrouter', {
      apiKey: 'sk-or-custom',
      baseUrl: 'https://custom.openrouter.test/v1',
    })
    const settingsService = new FakeSettingsService({
      provider: { activeMode: 'openrouter' } as unknown as ProviderSettings,
    })

    await runProviderMigration({
      settingsService: settingsService as unknown as import('../../../electron/services/settingsService').SettingsService,
      mainCredentialStore: mainStore as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      legacyCodexCredentialStore: null,
      legacyCodexCredentialsPath: '/tmp/credentials-codex.enc',
    })

    const saved = await settingsService.load()
    const profile = saved.provider.profiles[0]
    expect(profile.credential).toEqual({
      type: 'anthropic-compat-proxy',
      baseUrl: 'https://custom.openrouter.test/v1',
      authStyle: 'bearer',
    })
    expect(mainStore.snapshot()[`credential:${profile.id}`]).toEqual({
      apiKey: 'sk-or-custom',
      baseUrl: 'https://custom.openrouter.test/v1',
      authStyle: 'bearer',
    })
  })

  it('migrates legacy Codex config into a real OpenAI-compat profile', async () => {
    const mainStore = new FakeStore()
    const codexStore = new FakeStore()
    await codexStore.updateAs('custom', {
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
    })
    const settingsService = new FakeSettingsService({
      provider: {
        byEngine: { codex: { activeMode: 'custom' } },
      } as unknown as ProviderSettings,
    })

    await runProviderMigration({
      settingsService: settingsService as unknown as import('../../../electron/services/settingsService').SettingsService,
      mainCredentialStore: mainStore as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      legacyCodexCredentialStore: codexStore as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      legacyCodexCredentialsPath: '/tmp/credentials-codex.enc',
    })

    const saved = await settingsService.load()
    expect(saved.provider.schemaVersion).toBe(1)
    const profile = saved.provider.profiles[0]
    expect(profile.credential).toEqual({
      type: 'openai-compat-proxy',
      baseUrl: 'https://api.deepseek.com/v1',
    })
    // Credential moved into the main store at the profile-scoped key.
    expect(mainStore.snapshot()[`credential:${profile.id}`]).toEqual({
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
    })
  })

  it('is idempotent — second run short-circuits on schemaVersion', async () => {
    const mainStore = new FakeStore()
    await mainStore.updateAs('apiKey', 'sk-ant-x')
    const settingsService = new FakeSettingsService({
      provider: { activeMode: 'api_key' } as unknown as ProviderSettings,
    })

    const deps = {
      settingsService: settingsService as unknown as import('../../../electron/services/settingsService').SettingsService,
      mainCredentialStore: mainStore as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      legacyCodexCredentialStore: null,
      legacyCodexCredentialsPath: '/tmp/credentials-codex.enc',
    }

    await runProviderMigration(deps)
    const firstSnapshot = mainStore.snapshot()
    const firstSettings = (await settingsService.load()).provider

    await runProviderMigration(deps)
    const secondSnapshot = mainStore.snapshot()
    const secondSettings = (await settingsService.load()).provider

    expect(secondSnapshot).toEqual(firstSnapshot)
    expect(secondSettings).toEqual(firstSettings)
  })

  it('writes schemaVersion=1 on fresh install with no legacy data', async () => {
    const mainStore = new FakeStore()
    const settingsService = new FakeSettingsService({})

    await runProviderMigration({
      settingsService: settingsService as unknown as import('../../../electron/services/settingsService').SettingsService,
      mainCredentialStore: mainStore as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      legacyCodexCredentialStore: null,
      legacyCodexCredentialsPath: '/tmp/credentials-codex.enc',
    })

    const saved = await settingsService.load()
    expect(saved.provider.schemaVersion).toBe(1)
    expect(saved.provider.profiles).toEqual([])
  })
})

describe('applyProviderMigration safety ordering', () => {
  it('does not overwrite a target slot that is already populated (partial-completion recovery)', async () => {
    const mainStore = new FakeStore()
    await mainStore.updateAs('apiKey', 'sk-legacy')
    const settingsService = new FakeSettingsService({})

    // Simulate a prior partially-successful run that managed to move
    // the credential but didn't stamp schemaVersion. Re-running should
    // NOT overwrite the fresh-at-new-key value.
    const plan = planProviderMigration({
      rawProvider: { activeMode: 'api_key' },
      legacyCodexFilePresent: false,
    })
    const targetKey = plan.credentialMoves[0].toKey
    await mainStore.updateAs(targetKey, 'sk-fresh-already-there')

    await applyProviderMigration(
      {
        settingsService: settingsService as unknown as import('../../../electron/services/settingsService').SettingsService,
        mainCredentialStore: mainStore as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
        legacyCodexCredentialStore: null,
        legacyCodexCredentialsPath: '/tmp/codex.enc',
      },
      plan,
    )

    expect(mainStore.snapshot()[targetKey]).toBe('sk-fresh-already-there')
  })
})
