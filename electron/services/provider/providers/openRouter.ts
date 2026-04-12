// SPDX-License-Identifier: Apache-2.0

/**
 * OpenRouter Provider Adapter — third-party Anthropic API proxy.
 *
 * OpenRouter exposes a native Anthropic Messages API passthrough at
 * https://openrouter.ai/api, supporting streaming, tool use, and
 * thinking blocks. Authentication uses a bearer token (the OpenRouter
 * API key) injected via ANTHROPIC_AUTH_TOKEN.
 *
 * Key env var semantics:
 *   ANTHROPIC_BASE_URL  — redirects CLI to OpenRouter endpoint
 *   ANTHROPIC_AUTH_TOKEN — the OpenRouter API key (bearer auth)
 *   ANTHROPIC_API_KEY    — must be explicitly empty to prevent CLI fallback
 *
 * Note: Default model configuration is handled centrally by ProviderService
 * via ProviderSettings.defaultModel — individual adapters do not manage it.
 *
 * Reference: https://openrouter.ai/docs/guides/community/anthropic-agent-sdk
 */

import type {
  HTTPAuthResult,
  ProviderAdapter,
  ProviderAdapterStatus,
  OpenRouterCredential,
} from '../types'
import { CredentialStore } from '../credentialStore'
import { createLogger } from '../../../platform/logger'

const log = createLogger('Provider:OpenRouter')

/** OpenRouter's Anthropic-compatible API endpoint. */
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api'

export class OpenRouterProvider implements ProviderAdapter {
  private readonly store: CredentialStore
  private readonly credentialKey: string

  constructor(store: CredentialStore, credentialKey: string = 'openrouter') {
    this.store = store
    this.credentialKey = credentialKey
  }

  async checkStatus(): Promise<ProviderAdapterStatus> {
    const credential = await this.store.getAs<OpenRouterCredential>(this.credentialKey)
    if (!credential?.apiKey) {
      return { authenticated: false }
    }
    return { authenticated: true }
  }

  async getEnv(): Promise<Record<string, string>> {
    const credential = await this.store.getAs<OpenRouterCredential>(this.credentialKey)
    if (!credential?.apiKey) return {}

    const baseUrl = credential.baseUrl?.trim() || OPENROUTER_BASE_URL

    return {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: credential.apiKey,
      // Must be explicitly empty to prevent CLI from falling back
      // to default Anthropic authentication via ANTHROPIC_API_KEY.
      ANTHROPIC_API_KEY: '',
    }
  }

  async authenticate(params?: Record<string, unknown>): Promise<ProviderAdapterStatus> {
    const apiKey = params?.apiKey
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      return { authenticated: false, error: 'OpenRouter API key is required' }
    }

    const credential: OpenRouterCredential = { apiKey: apiKey.trim() }

    const baseUrl = params?.baseUrl
    if (typeof baseUrl === 'string' && baseUrl.trim()) {
      credential.baseUrl = baseUrl.trim()
    }

    await this.store.updateAs(this.credentialKey, credential)
    log.info('OpenRouter credentials saved', { hasCustomBaseUrl: !!credential.baseUrl })
    return { authenticated: true }
  }

  async getCredential(): Promise<import('@shared/types').ProviderCredentialInfo | null> {
    const credential = await this.store.getAs<OpenRouterCredential>(this.credentialKey)
    if (!credential?.apiKey) return null
    return { apiKey: credential.apiKey, baseUrl: credential.baseUrl }
  }

  async getHTTPAuth(): Promise<HTTPAuthResult | null> {
    const credential = await this.store.getAs<OpenRouterCredential>(this.credentialKey)
    if (!credential?.apiKey) return null
    return {
      apiKey: credential.apiKey,
      baseUrl: credential.baseUrl?.trim() || OPENROUTER_BASE_URL,
      authStyle: 'bearer',
    }
  }

  async logout(): Promise<void> {
    await this.store.removeAt(this.credentialKey)
    log.info('OpenRouter credentials cleared')
  }
}
