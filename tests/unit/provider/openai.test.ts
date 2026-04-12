// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import {
  OpenAICompatProxyProvider,
  OpenAIDirectProvider,
} from '../../../electron/services/provider/providers/openai'
import { GeminiProvider } from '../../../electron/services/provider/providers/gemini'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8'),
  },
}))

/** Minimal CredentialStore fake matching the API the adapters use. */
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

describe('OpenAIDirectProvider', () => {
  it('emits CLAUDE_CODE_USE_OPENAI + default api.openai.com base URL', async () => {
    const store = new FakeStore()
    const adapter = new OpenAIDirectProvider(
      store as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      'credential:test',
    )

    await adapter.authenticate({ apiKey: 'sk-real-openai' })
    const env = await adapter.getEnv()

    expect(env).toEqual({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: 'sk-real-openai',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    })
  })

  it('returns authenticated only when an API key is stored', async () => {
    const store = new FakeStore()
    const adapter = new OpenAIDirectProvider(
      store as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      'credential:test',
    )
    expect((await adapter.checkStatus()).authenticated).toBe(false)
    await adapter.authenticate({ apiKey: 'sk-x' })
    expect((await adapter.checkStatus()).authenticated).toBe(true)
  })

  it('returns empty env after logout', async () => {
    const store = new FakeStore()
    const adapter = new OpenAIDirectProvider(
      store as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      'credential:test',
    )
    await adapter.authenticate({ apiKey: 'sk-x' })
    await adapter.logout()
    expect(await adapter.getEnv()).toEqual({})
  })
})

describe('OpenAICompatProxyProvider', () => {
  it('requires user-provided baseUrl and preserves it in env', async () => {
    const store = new FakeStore()
    const adapter = new OpenAICompatProxyProvider(
      store as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      'credential:test',
    )

    await adapter.authenticate({
      apiKey: 'sk-deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
    })
    const env = await adapter.getEnv()

    expect(env).toEqual({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: 'sk-deepseek',
      OPENAI_BASE_URL: 'https://api.deepseek.com/v1',
    })
  })

  it('getHTTPAuth returns bearer-style auth result', async () => {
    const store = new FakeStore()
    const adapter = new OpenAICompatProxyProvider(
      store as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      'credential:test',
    )
    await adapter.authenticate({
      apiKey: 'sk-x',
      baseUrl: 'https://custom.example/v1',
    })

    const auth = await adapter.getHTTPAuth()
    expect(auth).toEqual({
      apiKey: 'sk-x',
      baseUrl: 'https://custom.example/v1',
      authStyle: 'bearer',
    })
  })

  it('rejects blank API keys', async () => {
    const store = new FakeStore()
    const adapter = new OpenAICompatProxyProvider(
      store as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      'credential:test',
    )
    const result = await adapter.authenticate({ apiKey: '   ' })
    expect(result.authenticated).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('GeminiProvider', () => {
  it('emits CLAUDE_CODE_USE_GEMINI + GEMINI_API_KEY', async () => {
    const store = new FakeStore()
    const adapter = new GeminiProvider(
      store as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      'credential:test',
    )
    await adapter.authenticate({ apiKey: 'AIzaSyFake' })

    expect(await adapter.getEnv()).toEqual({
      CLAUDE_CODE_USE_GEMINI: '1',
      GEMINI_API_KEY: 'AIzaSyFake',
    })
  })

  it('getCredential returns the stored key for form pre-fill', async () => {
    const store = new FakeStore()
    const adapter = new GeminiProvider(
      store as unknown as import('../../../electron/services/provider/credentialStore').CredentialStore,
      'credential:test',
    )
    await adapter.authenticate({ apiKey: 'AIzaX' })
    expect(await adapter.getCredential()).toEqual({ apiKey: 'AIzaX' })
  })
})
