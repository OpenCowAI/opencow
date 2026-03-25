// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { CustomProvider } from '../../../electron/services/provider/providers/custom'

type MockCustomCredential = {
  apiKey: string
  baseUrl: string
  authStyle?: 'api_key' | 'bearer'
}

type MockStoreState = {
  custom?: MockCustomCredential
}

class MockCredentialStore {
  constructor(private readonly state: MockStoreState) {}

  async get(key: 'custom'): Promise<MockCustomCredential | undefined> {
    return this.state[key]
  }
}

describe('CustomProvider.getCodexAuthConfig', () => {
  it('returns null when custom credential is incomplete', async () => {
    const store = new MockCredentialStore({})
    const provider = new CustomProvider(store as never)

    const codexAuth = await provider.getCodexAuthConfig()
    expect(codexAuth).toBeNull()
  })

  it('returns apiKey/baseUrl for bearer credential', async () => {
    const store = new MockCredentialStore({
      custom: {
        apiKey: 'sk-test-bearer',
        baseUrl: 'https://example.com/v1',
        authStyle: 'bearer',
      },
    })
    const provider = new CustomProvider(store as never)

    const codexAuth = await provider.getCodexAuthConfig()
    expect(codexAuth).toEqual({
      apiKey: 'sk-test-bearer',
      baseUrl: 'https://example.com/v1',
    })
  })

  it('keeps legacy api_key credential usable for codex auth mapping', async () => {
    const store = new MockCredentialStore({
      custom: {
        apiKey: 'sk-test-legacy',
        baseUrl: 'https://example.com/v1',
        authStyle: 'api_key',
      },
    })
    const provider = new CustomProvider(store as never)

    const codexAuth = await provider.getCodexAuthConfig()
    expect(codexAuth).toEqual({
      apiKey: 'sk-test-legacy',
      baseUrl: 'https://example.com/v1',
    })
  })
})
