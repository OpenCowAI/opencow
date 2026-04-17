// SPDX-License-Identifier: Apache-2.0

/**
 * OpenAI-family provider adapters.
 *
 * OpenCow routes OpenAI-protocol traffic through opencow-agent-sdk's
 * built-in OpenAI shim (src/services/api/openaiShim.ts in the SDK),
 * which activates when these env vars are present at query time:
 *
 *   CLAUDE_CODE_USE_OPENAI=1          — enables OpenAI routing
 *   OPENAI_API_KEY=sk-...             — auth (optional for local models)
 *   OPENAI_BASE_URL=https://...       — endpoint (defaults to api.openai.com)
 *
 * Two concrete adapters share the logic:
 *   - `OpenAIDirectProvider`      — official OpenAI (api.openai.com)
 *   - `OpenAICompatProxyProvider` — any OpenAI-compatible gateway
 *     (DeepSeek / Moonshot / SiliconFlow / Ollama / OpenRouter / UniAPI)
 */

import type {
  HTTPAuthResult,
  ProbeResult,
  ProviderAdapter,
  ProviderAdapterStatus,
} from '../types'
import type { CredentialStore } from '../credentialStore'
import type { ProviderCredentialInfo } from '@shared/types'
import { createLogger } from '../../../platform/logger'
import { probeUpstream } from './probe'

const log = createLogger('Provider:OpenAI')

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'

/**
 * Stored shape for an OpenAI-family credential. The profile's non-
 * sensitive `credential.baseUrl` (when `openai-compat-proxy`) takes
 * precedence over this blob's baseUrl — this field is preserved only
 * so the adapter can report a single consistent HTTP auth object.
 */
interface OpenAICredentialBlob {
  apiKey: string
  baseUrl?: string
}

interface OpenAIAdapterConfig {
  store: CredentialStore
  credentialKey: string
  /**
   * Default base URL when the stored credential doesn't carry one.
   * Direct OpenAI uses the canonical endpoint; proxy adapters
   * substitute their user-provided URL (empty default forces explicit
   * configuration).
   */
  defaultBaseUrl: string
  /** Human-readable label for log lines. */
  logLabel: string
}

class OpenAIAdapter implements ProviderAdapter {
  protected readonly store: CredentialStore
  protected readonly credentialKey: string
  protected readonly defaultBaseUrl: string
  protected readonly logLabel: string

  constructor(config: OpenAIAdapterConfig) {
    this.store = config.store
    this.credentialKey = config.credentialKey
    this.defaultBaseUrl = config.defaultBaseUrl
    this.logLabel = config.logLabel
  }

  async checkStatus(): Promise<ProviderAdapterStatus> {
    const credential = await this.readCredential()
    if (!credential?.apiKey) return { authenticated: false }
    return { authenticated: true }
  }

  async authenticate(params?: Record<string, unknown>): Promise<ProviderAdapterStatus> {
    const apiKey = params?.apiKey
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      return { authenticated: false, error: 'API key is required' }
    }

    const baseUrlParam = params?.baseUrl
    const baseUrl =
      typeof baseUrlParam === 'string' && baseUrlParam.trim()
        ? baseUrlParam.trim()
        : this.defaultBaseUrl

    const credential: OpenAICredentialBlob = { apiKey: apiKey.trim(), baseUrl }
    await this.store.updateAs(this.credentialKey, credential)
    log.info(`${this.logLabel} credentials saved`, { baseUrl })
    return { authenticated: true }
  }

  async getEnv(): Promise<Record<string, string>> {
    const credential = await this.readCredential()
    if (!credential?.apiKey) return {}

    return {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: credential.apiKey,
      OPENAI_BASE_URL: this.resolveBaseUrl(credential),
    }
  }

  async getCredential(): Promise<ProviderCredentialInfo | null> {
    const credential = await this.readCredential()
    if (!credential?.apiKey) return null
    return {
      apiKey: credential.apiKey,
      baseUrl: this.resolveBaseUrl(credential),
    }
  }

  async getHTTPAuth(): Promise<HTTPAuthResult | null> {
    const credential = await this.readCredential()
    if (!credential?.apiKey) return null
    return {
      apiKey: credential.apiKey,
      baseUrl: this.resolveBaseUrl(credential),
      authStyle: 'bearer',
    }
  }

  async logout(): Promise<void> {
    await this.store.removeAt(this.credentialKey)
    log.info(`${this.logLabel} credentials cleared`)
  }

  async probe(): Promise<ProbeResult> {
    const credential = await this.readCredential()
    if (!credential?.apiKey) {
      return { ok: false, reason: 'unauthenticated', message: 'No API key stored' }
    }
    const baseUrl = this.resolveBaseUrl(credential)
    if (!baseUrl) {
      return { ok: false, reason: 'unauthenticated', message: 'Base URL is required' }
    }
    return probeUpstream({
      url: joinPath(baseUrl, 'models'),
      headers: { Authorization: `Bearer ${credential.apiKey}` },
      logLabel: `${this.logLabel} (${baseUrl})`,
    })
  }

  // ── private ─────────────────────────────────────────────────────────

  private async readCredential(): Promise<OpenAICredentialBlob | undefined> {
    return this.store.getAs<OpenAICredentialBlob>(this.credentialKey)
  }

  private resolveBaseUrl(credential: OpenAICredentialBlob): string {
    return credential.baseUrl?.trim() || this.defaultBaseUrl
  }
}

function joinPath(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.replace(/^\/+/, '')
  return `${b}/${p}`
}

/** Official OpenAI endpoint (api.openai.com). */
export class OpenAIDirectProvider extends OpenAIAdapter {
  constructor(store: CredentialStore, credentialKey: string = 'openai_direct') {
    super({
      store,
      credentialKey,
      defaultBaseUrl: OPENAI_DEFAULT_BASE_URL,
      logLabel: 'OpenAI',
    })
  }
}

/**
 * Any OpenAI-compatible gateway (DeepSeek, OpenRouter, Moonshot,
 * SiliconFlow, Ollama, UniAPI, Azure OpenAI, etc.). Base URL MUST be
 * provided by the user — empty default intentional.
 */
export class OpenAICompatProxyProvider extends OpenAIAdapter {
  constructor(store: CredentialStore, credentialKey: string = 'openai_compat') {
    super({
      store,
      credentialKey,
      defaultBaseUrl: '',
      logLabel: 'OpenAI-compatible',
    })
  }
}
