// SPDX-License-Identifier: Apache-2.0

/**
 * API Key Auth Provider — Anthropic Console API key authentication.
 *
 * The simplest provider: stores the user's ANTHROPIC_API_KEY in the
 * encrypted CredentialStore and injects it into the SDK subprocess env.
 *
 * This is the officially recommended auth method for Agent SDK usage.
 */

import type { CodexAuthConfig, ProviderAdapter, ProviderAdapterStatus } from '../types'
import { CredentialStore } from '../credentialStore'
import { createLogger } from '../../../platform/logger'

const log = createLogger('Auth:ApiKey')

/** Minimal prefix check for Anthropic API keys. */
const API_KEY_PREFIX = 'sk-ant-'

export class ApiKeyProvider implements ProviderAdapter {
  private readonly store: CredentialStore

  constructor(store: CredentialStore) {
    this.store = store
  }

  async checkStatus(): Promise<ProviderAdapterStatus> {
    const key = await this.store.get('apiKey')
    if (!key) {
      return { authenticated: false }
    }
    return { authenticated: true }
  }

  async getEnv(): Promise<Record<string, string>> {
    const key = await this.store.get('apiKey')
    if (!key) return {}
    return { ANTHROPIC_API_KEY: key }
  }

  async authenticate(params?: Record<string, unknown>): Promise<ProviderAdapterStatus> {
    const apiKey = params?.apiKey
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      return { authenticated: false, error: 'API key is required' }
    }

    const trimmed = apiKey.trim()

    if (!trimmed.startsWith(API_KEY_PREFIX)) {
      return {
        authenticated: false,
        error: `Invalid API key format (expected prefix "${API_KEY_PREFIX}")`,
      }
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

  async getCodexAuthConfig(): Promise<CodexAuthConfig | null> {
    // Anthropic API keys are not compatible with Codex/OpenAI auth.
    return null
  }

  async logout(): Promise<void> {
    await this.store.remove('apiKey')
    log.info('API key cleared')
  }
}
