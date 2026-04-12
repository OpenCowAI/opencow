// SPDX-License-Identifier: Apache-2.0

/**
 * Custom Provider Adapter — user-defined Claude-compatible API endpoint.
 *
 * Supports any proxy or gateway that implements Anthropic's Messages API,
 * including services like AppleRouter, self-hosted proxies, or enterprise gateways.
 *
 * Two authentication styles are supported:
 *   - 'api_key'  → key sent via ANTHROPIC_API_KEY  (x-api-key header)
 *   - 'bearer'   → key sent via ANTHROPIC_AUTH_TOKEN (Authorization: Bearer header)
 *
 * Both Base URL and API Key are required fields.
 *
 * Note: Default model configuration is handled centrally by ProviderService
 * via ProviderSettings.defaultModel — individual adapters do not manage it.
 */

import type {
  HTTPAuthResult,
  ProviderAdapter,
  ProviderAdapterStatus,
  CustomCredential,
  CustomAuthStyle,
} from '../types'
import { CredentialStore } from '../credentialStore'
import { createLogger } from '../../../platform/logger'

const log = createLogger('Provider:Custom')

export class CustomProvider implements ProviderAdapter {
  private readonly store: CredentialStore
  private readonly credentialKey: string

  constructor(store: CredentialStore, credentialKey: string = 'custom') {
    this.store = store
    this.credentialKey = credentialKey
  }

  async checkStatus(): Promise<ProviderAdapterStatus> {
    const credential = await this.store.getAs<CustomCredential>(this.credentialKey)
    if (!credential?.apiKey || !credential?.baseUrl) {
      return { authenticated: false }
    }
    return { authenticated: true }
  }

  async getEnv(): Promise<Record<string, string>> {
    const credential = await this.store.getAs<CustomCredential>(this.credentialKey)
    if (!credential?.apiKey || !credential?.baseUrl) return {}

    const env: Record<string, string> = {
      ANTHROPIC_BASE_URL: credential.baseUrl,
      // Third-party proxies (UniAPI, OneAPI, etc.) may route to backends like
      // AWS Bedrock that reject unsupported beta flags. Suppress experimental
      // betas to maximise compatibility with unknown upstream providers.
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
      DISABLE_INTERLEAVED_THINKING: '1',
    }

    if (credential.authStyle === 'bearer') {
      // Bearer token style (e.g. OpenRouter-compatible)
      env.ANTHROPIC_AUTH_TOKEN = credential.apiKey
      env.ANTHROPIC_API_KEY = ''
    } else {
      // Standard x-api-key style (e.g. Anthropic-native, AppleRouter)
      env.ANTHROPIC_API_KEY = credential.apiKey
    }

    return env
  }

  async authenticate(params?: Record<string, unknown>): Promise<ProviderAdapterStatus> {
    const apiKey = params?.apiKey
    const baseUrl = params?.baseUrl

    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      return { authenticated: false, error: 'API key is required' }
    }
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
      return { authenticated: false, error: 'Base URL is required' }
    }

    const authStyle: CustomAuthStyle =
      params?.authStyle === 'bearer' ? 'bearer' : 'api_key'

    const credential: CustomCredential = {
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      authStyle,
    }

    await this.store.updateAs(this.credentialKey, credential)
    log.info('Custom provider credentials saved', {
      baseUrl: credential.baseUrl,
      authStyle,
    })
    return { authenticated: true }
  }

  async getCredential(): Promise<import('@shared/types').ProviderCredentialInfo | null> {
    const credential = await this.store.getAs<CustomCredential>(this.credentialKey)
    if (!credential?.apiKey || !credential?.baseUrl) return null
    return {
      apiKey: credential.apiKey,
      baseUrl: credential.baseUrl,
      authStyle: credential.authStyle,
    }
  }

  async getHTTPAuth(): Promise<HTTPAuthResult | null> {
    const credential = await this.store.getAs<CustomCredential>(this.credentialKey)
    if (!credential?.apiKey || !credential?.baseUrl) return null
    return {
      apiKey: credential.apiKey,
      baseUrl: credential.baseUrl,
      authStyle: credential.authStyle === 'bearer' ? 'bearer' : 'x-api-key',
    }
  }

  async logout(): Promise<void> {
    await this.store.removeAt(this.credentialKey)
    log.info('Custom provider credentials cleared')
  }
}
