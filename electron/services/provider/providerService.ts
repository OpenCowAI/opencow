// SPDX-License-Identifier: Apache-2.0

/**
 * ProviderService — Central orchestrator for all API provider modes.
 *
 * Responsibilities:
 *   1. Maintain the active provider adapter based on user settings
 *   2. Provide `getProviderEnv()` for SessionOrchestrator to inject into SDK env
 *   3. Expose login/logout/status for the IPC layer and frontend
 *   4. Broadcast provider status changes via DataBus
 *
 * Architecture:
 *   - Strategy pattern: each ApiProvider maps to a ProviderAdapter implementation
 *   - Engine-scoped active provider (`provider.byEngine.{claude|codex}.activeMode`)
 *   - Sensitive credentials in CredentialStore (encrypted)
 *   - Non-sensitive config in SettingsService (plaintext JSON)
 */

import type {
  AIEngineKind,
  ApiProvider,
  ProviderSettings,
  ProviderStatus,
  ProviderCredentialInfo,
  DataBusEvent,
} from '@shared/types'
import type { CodexAuthConfig, ProviderAdapter } from './types'
import { CredentialStore } from './credentialStore'
import { SubscriptionProvider } from './providers/subscription'
import { ApiKeyProvider } from './providers/apiKey'
import { OpenRouterProvider } from './providers/openRouter'
import { CustomProvider } from './providers/custom'
import { createLogger } from '../../platform/logger'

const log = createLogger('ProviderService')

export interface ProviderServiceDeps {
  dispatch: (event: DataBusEvent) => void
  credentialStoreByEngine: Record<AIEngineKind, CredentialStore>
  /** Returns current provider settings (non-sensitive config). */
  getProviderSettings: () => ProviderSettings
  /** Bring the app window to the foreground (called after successful auth). */
  focusApp?: () => void
}

export class ProviderService {
  private readonly deps: ProviderServiceDeps
  private readonly providersByEngine: Map<AIEngineKind, Map<ApiProvider, ProviderAdapter>>

  constructor(deps: ProviderServiceDeps) {
    this.deps = deps
    this.providersByEngine = new Map<AIEngineKind, Map<ApiProvider, ProviderAdapter>>([
      ['claude', this.createProviders(deps.credentialStoreByEngine.claude)],
      ['codex', this.createProviders(deps.credentialStoreByEngine.codex)],
    ])
  }

  private createProviders(store: CredentialStore): Map<ApiProvider, ProviderAdapter> {
    return new Map<ApiProvider, ProviderAdapter>([
      ['subscription', new SubscriptionProvider(store)],
      ['api_key', new ApiKeyProvider(store)],
      ['openrouter', new OpenRouterProvider(store)],
      ['custom', new CustomProvider(store)],
    ])
  }

  private getEngineProviders(engineKind: AIEngineKind): Map<ApiProvider, ProviderAdapter> {
    return this.providersByEngine.get(engineKind) ?? this.providersByEngine.get('claude')!
  }

  private getEngineProviderSettings(engineKind: AIEngineKind): ProviderSettings['byEngine']['claude'] {
    const settings = this.deps.getProviderSettings()
    return settings.byEngine[engineKind] ?? { activeMode: null }
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Get the current provider status for the active mode.
   * Returns `unauthenticated` if no mode is configured.
   */
  async getStatus(engineKind: AIEngineKind = 'claude'): Promise<ProviderStatus> {
    const mode = this.getEngineProviderSettings(engineKind).activeMode
    if (!mode) {
      return { state: 'unauthenticated', mode: null }
    }

    const provider = this.getEngineProviders(engineKind).get(mode)
    if (!provider) {
      return { state: 'error', mode, error: `Unknown provider mode: ${mode}` }
    }

    const adapterStatus = await provider.checkStatus()

    // Codex readiness is stricter than generic credential existence:
    // we must be able to resolve OpenAI-compatible auth options (apiKey/baseUrl).
    // Otherwise UI can show "configured" while runtime cannot start Codex turns.
    if (engineKind === 'codex' && adapterStatus.authenticated) {
      if (!provider.getCodexAuthConfig) {
        return {
          state: 'unauthenticated',
          mode,
          error: `Provider mode "${mode}" does not expose Codex-compatible auth mapping`,
        }
      }
      const codexAuth = await provider.getCodexAuthConfig()
      if (!codexAuth?.apiKey) {
        return {
          state: 'unauthenticated',
          mode,
          error: `Provider mode "${mode}" has no usable Codex API key mapping`,
        }
      }
    }

    return {
      state: adapterStatus.authenticated ? 'authenticated' : 'unauthenticated',
      mode,
      detail: adapterStatus.detail,
      error: adapterStatus.error,
    }
  }

  /**
   * Get environment variables for the SDK subprocess.
   *
   * Called by SessionOrchestrator before spawning each SDK process.
   * Returns an empty object if no provider mode is configured (SDK falls back
   * to system-level credentials).
   */
  async getProviderEnv(engineKind: AIEngineKind): Promise<Record<string, string>> {
    const engineSettings = this.getEngineProviderSettings(engineKind)
    const mode = engineSettings.activeMode
    if (!mode) {
      if (engineKind === 'claude') {
        log.warn(`getProviderEnv(${engineKind}): no activeMode configured — session will use system credentials`)
      }
      return {}
    }

    const provider = this.getEngineProviders(engineKind).get(mode)
    if (!provider) {
      log.warn(`getProviderEnv: no adapter for mode "${mode}" — returning empty env`)
      return {}
    }

    try {
      const env = await provider.getEnv()

      // Claude SDK default model is controlled via ANTHROPIC_DEFAULT_SONNET_MODEL.
      if (engineKind === 'claude' && engineSettings.defaultModel) {
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = engineSettings.defaultModel
      }

      // Warn if the provider returned empty env — this almost certainly means
      // the session will fail with "Not Logged in" from the SDK.
      const hasAuthKey = Object.keys(env).some(
        (k) => k === 'CLAUDE_CODE_OAUTH_TOKEN' || k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN'
      )
      if (engineKind === 'claude' && !hasAuthKey) {
        log.warn(`getProviderEnv(${engineKind}): mode "${mode}" returned no auth credentials — session may fail`)
      }

      return env
    } catch (err) {
      log.error(`getProviderEnv(${engineKind}): failed for mode "${mode}"`, err)
      return {}
    }
  }

  /**
   * Resolve Codex SDK auth options from the current active provider mode.
   *
   * Returns null when:
   * - no active mode is configured
   * - the active provider does not expose Codex-compatible credentials
   * - credential lookup fails
   */
  async getCodexAuthConfig(engineKind: AIEngineKind): Promise<CodexAuthConfig | null> {
    const mode = this.getEngineProviderSettings(engineKind).activeMode
    if (!mode) return null

    const provider = this.getEngineProviders(engineKind).get(mode)
    if (!provider?.getCodexAuthConfig) return null

    try {
      const resolved = await provider.getCodexAuthConfig()
      if (!resolved?.apiKey) return null
      return resolved
    } catch (err) {
      log.error(`getCodexAuthConfig(${engineKind}): failed for mode "${mode}"`, err)
      return null
    }
  }

  /**
   * Perform authentication for the given mode.
   *
   * For subscription: triggers the OAuth PKCE browser flow.
   * For api_key: validates and stores the provided key.
   * For openrouter: validates and stores the OpenRouter API key.
   */
  async login(engineKind: AIEngineKind, mode: ApiProvider, params?: Record<string, unknown>): Promise<ProviderStatus> {
    const provider = this.getEngineProviders(engineKind).get(mode)
    if (!provider) {
      return { state: 'error', mode, error: `Unknown provider mode: ${mode}` }
    }

    // Broadcast authenticating state
    this.broadcastStatus({ state: 'authenticating', mode })

    try {
      const result = await provider.authenticate(params)

      const status: ProviderStatus = {
        state: result.authenticated ? 'authenticated' : 'error',
        mode,
        detail: result.detail,
        error: result.error,
      }

      this.broadcastStatus(status)
      log.info(`Login completed for mode "${mode}": ${status.state}`)

      // Restore app focus after authentication completes (especially important
      // for OAuth flows where the user was redirected to a browser).
      if (result.authenticated) {
        this.deps.focusApp?.()
      }

      return status
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const status: ProviderStatus = { state: 'error', mode, error: message }
      this.broadcastStatus(status)
      log.error(`Login failed for mode "${mode}"`, err)
      return status
    }
  }

  /**
   * Cancel an in-progress login flow for the given mode.
   * Delegates to the adapter's cancelLogin() if it supports cancellation.
   */
  async cancelLogin(engineKind: AIEngineKind, mode: ApiProvider): Promise<void> {
    const provider = this.getEngineProviders(engineKind).get(mode)
    if (provider?.cancelLogin) {
      await provider.cancelLogin()
      this.broadcastStatus({ state: 'unauthenticated', mode })
      log.info(`Login cancelled for mode "${mode}"`)
    }
  }

  /**
   * Logout from a specific provider mode.
   * Clears credentials and broadcasts unauthenticated status.
   */
  async logout(engineKind: AIEngineKind, mode: ApiProvider): Promise<void> {
    const provider = this.getEngineProviders(engineKind).get(mode)
    if (provider) {
      await provider.logout()
    }

    // Broadcast with the actual mode — the user is still IN this mode, just unauthenticated.
    // This ensures isStatusForActiveMode guard on the frontend works correctly by design,
    // not by coincidence (null !== activeMode).
    this.broadcastStatus({ state: 'unauthenticated', mode })
    log.info(`Logged out from mode "${mode}"`)
  }

  /**
   * Return stored credential fields for the given mode (for edit form pre-fill).
   * Returns null if the provider doesn't support it or no credential is stored.
   */
  async getCredential(engineKind: AIEngineKind, mode: ApiProvider): Promise<ProviderCredentialInfo | null> {
    const provider = this.getEngineProviders(engineKind).get(mode)
    if (!provider?.getCredential) return null
    return provider.getCredential()
  }

  // ── Private ─────────────────────────────────────────────────────────

  private broadcastStatus(status: ProviderStatus): void {
    this.deps.dispatch({ type: 'provider:status', payload: status })
  }
}
