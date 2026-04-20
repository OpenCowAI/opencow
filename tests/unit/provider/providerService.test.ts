// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { ProviderService } from '../../../electron/services/provider/providerService'
import type { ProviderSettings } from '../../../src/shared/types'
import {
  asProviderProfileId,
  credentialKeyFor,
  type ProviderProfile,
} from '../../../src/shared/providerProfile'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8'),
  },
}))

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
}

describe('ProviderService', () => {
  it('keeps OpenAI-compatible runtime baseUrl in sync when editing without a new API key', async () => {
    const profileId = asProviderProfileId('prof_openai_1')
    const profile: ProviderProfile = {
      id: profileId,
      name: 'OpenAI-compatible',
      credential: {
        type: 'openai-compat-proxy',
        baseUrl: 'https://api.example.test',
      },
      preferredModel: 'gpt-5.4',
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
    }
    let settings: ProviderSettings = {
      profiles: [profile],
      defaultProfileId: profileId,
    }
    const store = new FakeStore()
    await store.updateAs(credentialKeyFor(profileId), {
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.test',
    })
    const service = new ProviderService({
      dispatch: vi.fn(),
      credentialStore: store as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      getProviderSettings: () => settings,
      updateProviderSettings: async (patch) => {
        settings = { ...settings, ...patch }
        return settings
      },
    })

    await service.updateProfile(profileId, {
      credentialConfig: { baseUrl: 'https://api.example.test/v1' },
    })

    await expect(service.getProviderEnvForProfile(profileId)).resolves.toMatchObject({
      OPENAI_BASE_URL: 'https://api.example.test/v1',
    })
  })
})
