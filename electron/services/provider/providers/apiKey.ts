// SPDX-License-Identifier: Apache-2.0

/**
 * API Key Auth Providers — engine-specific API key authentication.
 *
 * Base class handles credential storage, status checks, and logout.
 * Engine-specific subclasses define key validation, auth style, base URL,
 * and SDK compatibility:
 *
 * - AnthropicApiKeyProvider: `sk-ant-*` keys, `x-api-key` header, api.anthropic.com
 * - OpenAIApiKeyProvider:    `sk-*` keys, `Authorization: Bearer`, api.openai.com
 */

import type { HTTPAuthResult, ProviderAdapter, ProviderAdapterStatus } from '../types'
import type { CredentialStore } from '../credentialStore'
import { createLogger } from '../../../platform/logger'

const log = createLogger('Auth:ApiKey')

// ─── Base ───────────────────────────────────────────────────────────

/**
 * Shared API key provider logic — credential CRUD and status checks.
 *
 * Subclasses override:
 * - `validateKey()` — engine-specific format validation
 * - `getEnv()` — engine-specific env var mapping
 * - `getHTTPAuth()` — structured HTTP auth with correct base URL and auth style
 */
abstract class BaseApiKeyProvider implements ProviderAdapter {
  protected readonly store: CredentialStore

  constructor(store: CredentialStore) {
    this.store = store
  }

  async checkStatus(): Promise<ProviderAdapterStatus> {
    const key = await this.store.get('apiKey')
    if (!key) return { authenticated: false }
    return { authenticated: true }
  }

  async authenticate(params?: Record<string, unknown>): Promise<ProviderAdapterStatus> {
    const apiKey = params?.apiKey
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      return { authenticated: false, error: 'API key is required' }
    }

    const trimmed = apiKey.trim()
    const validationError = this.validateKey(trimmed)
    if (validationError) {
      return { authenticated: false, error: validationError }
    }

    await this.store.update('apiKey', trimmed)
    log.info('API key saved')
    return { authenticated: true }
  }

  async getCredential(): Promise<import('@shared/types').ProviderCredentialInfo | null> {
    const key = await this.store.get('apiKey')
    if (!key) return null
    return { apiKey: key }
  }

  async logout(): Promise<void> {
    await this.store.remove('apiKey')
    log.info('API key cleared')
  }

  /** Validate the API key format. Return an error message, or null if valid. */
  protected abstract validateKey(key: string): string | null

  abstract getEnv(): Promise<Record<string, string>>
  abstract getHTTPAuth(): Promise<HTTPAuthResult | null>
}

// ─── Anthropic (Claude engine) ──────────────────────────────────────

const ANTHROPIC_API_KEY_PREFIX = 'sk-ant-'
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'

/**
 * Anthropic Console API key provider.
 *
 * Validates `sk-ant-*` key format,
 * sends credentials via `x-api-key` header to api.anthropic.com.
 */
export class AnthropicApiKeyProvider extends BaseApiKeyProvider {
  protected validateKey(key: string): string | null {
    if (!key.startsWith(ANTHROPIC_API_KEY_PREFIX)) {
      return `Invalid API key format (expected prefix "${ANTHROPIC_API_KEY_PREFIX}")`
    }
    return null
  }

  async getEnv(): Promise<Record<string, string>> {
    const key = await this.store.get('apiKey')
    if (!key) return {}
    return { ANTHROPIC_API_KEY: key }
  }

  async getHTTPAuth(): Promise<HTTPAuthResult | null> {
    const key = await this.store.get('apiKey')
    if (!key) return null
    return {
      apiKey: key,
      baseUrl: ANTHROPIC_BASE_URL,
      authStyle: 'x-api-key',
    }
  }

}

