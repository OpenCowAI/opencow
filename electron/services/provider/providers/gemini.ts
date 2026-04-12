// SPDX-License-Identifier: Apache-2.0

/**
 * Gemini provider adapter.
 *
 * Routes through opencow-agent-sdk's Gemini shim via:
 *   CLAUDE_CODE_USE_GEMINI=1
 *   GEMINI_API_KEY=...
 *
 * Gemini uses Google's OpenAI-compatible endpoint at
 * `https://generativelanguage.googleapis.com/v1beta/openai/` — the SDK
 * auto-resolves this, so we only surface the key.
 */

import type {
  HTTPAuthResult,
  ProviderAdapter,
  ProviderAdapterStatus,
} from '../types'
import type { CredentialStore } from '../credentialStore'
import type { ProviderCredentialInfo } from '@shared/types'
import { createLogger } from '../../../platform/logger'

const log = createLogger('Provider:Gemini')

const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'

export class GeminiProvider implements ProviderAdapter {
  private readonly store: CredentialStore
  private readonly credentialKey: string

  constructor(store: CredentialStore, credentialKey: string = 'gemini') {
    this.store = store
    this.credentialKey = credentialKey
  }

  async checkStatus(): Promise<ProviderAdapterStatus> {
    const key = await this.store.getAs<string>(this.credentialKey)
    return { authenticated: Boolean(key) }
  }

  async authenticate(params?: Record<string, unknown>): Promise<ProviderAdapterStatus> {
    const apiKey = params?.apiKey
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      return { authenticated: false, error: 'Gemini API key is required' }
    }
    await this.store.updateAs(this.credentialKey, apiKey.trim())
    log.info('Gemini credentials saved')
    return { authenticated: true }
  }

  async getEnv(): Promise<Record<string, string>> {
    const key = await this.store.getAs<string>(this.credentialKey)
    if (!key) return {}
    return {
      CLAUDE_CODE_USE_GEMINI: '1',
      GEMINI_API_KEY: key,
    }
  }

  async getCredential(): Promise<ProviderCredentialInfo | null> {
    const key = await this.store.getAs<string>(this.credentialKey)
    return key ? { apiKey: key } : null
  }

  async getHTTPAuth(): Promise<HTTPAuthResult | null> {
    const key = await this.store.getAs<string>(this.credentialKey)
    if (!key) return null
    return {
      apiKey: key,
      baseUrl: GEMINI_DEFAULT_BASE_URL,
      authStyle: 'bearer',
    }
  }

  async logout(): Promise<void> {
    await this.store.removeAt(this.credentialKey)
    log.info('Gemini credentials cleared')
  }
}
