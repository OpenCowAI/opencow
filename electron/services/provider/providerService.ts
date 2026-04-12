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
 *   - Active provider stored in `provider.activeMode` (see §4 of
 *     docs/proposals/2026-04-12-provider-management-redesign.md)
 *   - Sensitive credentials in CredentialStore (encrypted)
 *   - Non-sensitive config in SettingsService (plaintext JSON)
 */

import type {
  ApiProvider,
  ProviderSettings,
  ProviderStatus,
  ProviderCredentialInfo,
  DataBusEvent,
} from '@shared/types'
import type { ProviderAdapter } from './types'
import type { LLMAuthConfig } from '../../llm/types'
import { CredentialStore } from './credentialStore'
import { SubscriptionProvider } from './providers/subscription'
import { AnthropicApiKeyProvider } from './providers/apiKey'
import { OpenRouterProvider } from './providers/openRouter'
import { CustomProvider } from './providers/custom'
import { createLogger } from '../../platform/logger'
import type {
  ProviderProfile,
  ProviderProfileId,
} from '../../../src/shared/providerProfile'
import {
  credentialKeyFor,
  legacyCredentialKey,
  migrateLegacyProviderSettings,
} from '../../../src/shared/providerProfile'

const log = createLogger('ProviderService')

export interface ProviderServiceDeps {
  dispatch: (event: DataBusEvent) => void
  credentialStore: CredentialStore
  /** Returns current provider settings (non-sensitive config). */
  getProviderSettings: () => ProviderSettings
  /** Bring the app window to the foreground (called after successful auth). */
  focusApp?: () => void
}

export class ProviderService {
  private readonly deps: ProviderServiceDeps
  private readonly providers: Map<ApiProvider, ProviderAdapter>

  constructor(deps: ProviderServiceDeps) {
    this.deps = deps
    this.providers = this.createProviders(deps.credentialStore)
  }

  private createProviders(store: CredentialStore): Map<ApiProvider, ProviderAdapter> {
    return new Map<ApiProvider, ProviderAdapter>([
      ['subscription', new SubscriptionProvider(store)],
      ['api_key', new AnthropicApiKeyProvider(store)],
      ['openrouter', new OpenRouterProvider(store)],
      ['custom', new CustomProvider(store)],
    ])
  }

  /**
   * Build a per-profile adapter — same underlying CredentialStore, but keyed
   * by `credential:${profileId}` so each profile's secrets live at a
   * separate top-level entry. Called on demand by profile-aware methods.
   */
  private buildAdapterForProfile(profile: ProviderProfile): ProviderAdapter {
    const key = credentialKeyFor(profile.id)
    switch (profile.credential.type) {
      case 'claude-subscription':
        return new SubscriptionProvider(this.deps.credentialStore, key)
      case 'anthropic-api':
        return new AnthropicApiKeyProvider(this.deps.credentialStore, key)
      case 'anthropic-compat-proxy':
        // Phase B.3b: legacy `openrouter` and `custom` both map to this
        // profile type. The adapter distinguishes them via credential
        // shape at runtime — OpenRouter stores `{ apiKey, baseUrl? }`
        // while Custom stores `{ apiKey, baseUrl, authStyle }`. The
        // CustomProvider adapter handles both — Phase B.5 will
        // consolidate when the UI is rewritten.
        return new CustomProvider(this.deps.credentialStore, key)
      default:
        throw new Error(
          `ProviderService: profile type "${profile.credential.type}" is not yet supported in this build`,
        )
    }
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Get the current provider status for the active mode.
   * Returns `unauthenticated` if no mode is configured.
   */
  async getStatus(): Promise<ProviderStatus> {
    const mode = this.deps.getProviderSettings().activeMode
    if (!mode) {
      return { state: 'unauthenticated', mode: null }
    }

    const provider = this.providers.get(mode)
    if (!provider) {
      return { state: 'error', mode, error: `Unknown provider mode: ${mode}` }
    }

    const adapterStatus = await provider.checkStatus()

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
  async getProviderEnv(): Promise<Record<string, string>> {
    const settings = this.deps.getProviderSettings()
    const mode = settings.activeMode
    if (!mode) {
      log.warn('getProviderEnv: no activeMode configured — session will use system credentials')
      return {}
    }

    const provider = this.providers.get(mode)
    if (!provider) {
      log.warn(`getProviderEnv: no adapter for mode "${mode}" — returning empty env`)
      return {}
    }

    try {
      const env = await provider.getEnv()

      // Claude SDK default model is controlled via ANTHROPIC_DEFAULT_SONNET_MODEL.
      if (settings.defaultModel) {
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = settings.defaultModel
      }

      // Warn if the provider returned empty env — this almost certainly means
      // the session will fail with "Not Logged in" from the SDK.
      const hasAuthKey = Object.keys(env).some(
        (k) => k === 'CLAUDE_CODE_OAUTH_TOKEN' || k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN'
      )
      if (!hasAuthKey) {
        log.warn(`getProviderEnv: mode "${mode}" returned no auth credentials — session may fail`)
      }

      return env
    } catch (err) {
      log.error(`getProviderEnv: failed for mode "${mode}"`, err)
      return {}
    }
  }

  /**
   * Perform authentication for the given mode.
   *
   * For subscription: triggers the OAuth PKCE browser flow.
   * For api_key: validates and stores the provided key.
   * For openrouter: validates and stores the OpenRouter API key.
   */
  async login(mode: ApiProvider, params?: Record<string, unknown>): Promise<ProviderStatus> {
    const provider = this.providers.get(mode)
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
  async cancelLogin(mode: ApiProvider): Promise<void> {
    const provider = this.providers.get(mode)
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
  async logout(mode: ApiProvider): Promise<void> {
    const provider = this.providers.get(mode)
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
  async getCredential(mode: ApiProvider): Promise<ProviderCredentialInfo | null> {
    const provider = this.providers.get(mode)
    if (!provider?.getCredential) return null
    return provider.getCredential()
  }

  /**
   * Resolve structured HTTP auth for direct LLM API calls.
   *
   * Combines adapter-level credentials with settings-level config
   * (protocol, model) to produce a complete auth config suitable
   * for constructing HTTP headers in direct fetch() calls.
   *
   * @throws When no active provider, adapter not found, or credentials unavailable
   */
  async resolveHTTPAuth(): Promise<LLMAuthConfig> {
    const settings = this.deps.getProviderSettings()
    const mode = settings.activeMode

    if (!mode) {
      throw new Error('No active provider mode configured')
    }

    const provider = this.providers.get(mode)
    if (!provider) {
      throw new Error(`No adapter found for provider mode "${mode}"`)
    }

    const httpAuth = await provider.getHTTPAuth()
    if (!httpAuth) {
      throw new Error(`Provider mode "${mode}" returned no HTTP auth credentials`)
    }

    return {
      protocol: 'anthropic',
      apiKey: httpAuth.apiKey,
      baseUrl: httpAuth.baseUrl,
      authStyle: httpAuth.authStyle,
      model: settings.defaultModel ?? 'claude-sonnet-4-20250514',
    }
  }

  // ── Phase B.3b: Profile-aware public API ───────────────────────────
  //
  // These methods consume the new `profiles` / `defaultProfileId` fields
  // on ProviderSettings. They coexist with the Phase A activeMode-based
  // methods above — the orchestrator / UI switchover happens in Phase C
  // (per-session picker) and Phase B.5 (Settings list UI).

  /**
   * Apply credential renames produced by Phase B.1 migration.
   *
   * Idempotent: checks whether each legacy key still exists before
   * renaming, so re-running this after a successful migration is a
   * no-op. Safe to call on every bootstrap.
   *
   * The rename uses the pure `getAs`/`updateAs`/`removeAt` CredentialStore
   * API — it does not construct new credential objects, only moves the
   * value from `mode` → `credential:${profileId}`.
   */
  async applyProfileCredentialMigration(): Promise<void> {
    const settings = this.deps.getProviderSettings()
    const profiles = settings.profiles ?? []
    if (profiles.length === 0) return

    // Reconstruct the rename plan from current profiles: for each
    // migrated profile (id starts with `prof_migrated_`), derive the
    // legacy ApiProvider mode from the deterministic id suffix.
    for (const profile of profiles) {
      const legacyMode = parseLegacyModeFromMigratedId(profile.id)
      if (!legacyMode) continue

      const legacyKey = legacyCredentialKey(legacyMode)
      const newKey = credentialKeyFor(profile.id)

      const legacyValue = await this.deps.credentialStore.getAs<unknown>(legacyKey)
      if (legacyValue === undefined) continue // already migrated or never existed

      const existingAtNew = await this.deps.credentialStore.getAs<unknown>(newKey)
      if (existingAtNew !== undefined) {
        // New key already populated (e.g. user logged in via new UI before
        // rename ran). Preserve the newer value — just delete the legacy
        // one to keep the store clean.
        await this.deps.credentialStore.removeAt(legacyKey)
        log.info(`Credential migration: dropped stale legacy key "${legacyKey}" (new key already populated)`)
        continue
      }

      await this.deps.credentialStore.updateAs(newKey, legacyValue)
      await this.deps.credentialStore.removeAt(legacyKey)
      log.info(`Credential migration: moved "${legacyKey}" → "${newKey}"`)
    }
  }

  /**
   * Get environment variables for a specific profile.
   *
   * Phase C session orchestrator will call this with the session's
   * chosen profileId (or defaultProfileId). Returns an empty object if
   * the profile cannot be found or is of an unsupported type.
   */
  async getProviderEnvForProfile(profileId: ProviderProfileId): Promise<Record<string, string>> {
    const profile = this.findProfile(profileId)
    if (!profile) {
      log.warn(`getProviderEnvForProfile: profile "${profileId}" not found`)
      return {}
    }

    let adapter: ProviderAdapter
    try {
      adapter = this.buildAdapterForProfile(profile)
    } catch (err) {
      log.warn(`getProviderEnvForProfile: ${err instanceof Error ? err.message : String(err)}`)
      return {}
    }

    const env = await adapter.getEnv()
    const settings = this.deps.getProviderSettings()
    const preferred = profile.preferredModel ?? settings.defaultModel
    if (preferred) {
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = preferred
    }
    return env
  }

  /**
   * Get provider status for a specific profile. Returns unauthenticated
   * when credentials are missing or the type is not implemented.
   */
  async getStatusForProfile(profileId: ProviderProfileId): Promise<ProviderStatus> {
    const profile = this.findProfile(profileId)
    if (!profile) {
      return { state: 'unauthenticated', mode: null }
    }

    let adapter: ProviderAdapter
    try {
      adapter = this.buildAdapterForProfile(profile)
    } catch (err) {
      return { state: 'error', mode: null, error: err instanceof Error ? err.message : String(err) }
    }

    const adapterStatus = await adapter.checkStatus()
    return {
      state: adapterStatus.authenticated ? 'authenticated' : 'unauthenticated',
      // Temporary: until Phase B.5 rewrites the UI, expose the legacy mode
      // equivalent so the renderer's ProviderBanner keeps working.
      mode: legacyModeFromProfile(profile),
      detail: adapterStatus.detail,
      error: adapterStatus.error,
    }
  }

  private findProfile(profileId: ProviderProfileId): ProviderProfile | null {
    const profiles = this.deps.getProviderSettings().profiles ?? []
    return profiles.find((p) => p.id === profileId) ?? null
  }

  // ── Private ─────────────────────────────────────────────────────────

  private broadcastStatus(status: ProviderStatus): void {
    this.deps.dispatch({ type: 'provider:status', payload: status })
  }
}

// ── Phase B.3b helpers ────────────────────────────────────────────────

const MIGRATED_ID_PREFIX = 'prof_migrated_'

function parseLegacyModeFromMigratedId(id: ProviderProfileId): ApiProvider | null {
  if (!id.startsWith(MIGRATED_ID_PREFIX)) return null
  const suffix = id.slice(MIGRATED_ID_PREFIX.length)
  const valid: ReadonlySet<ApiProvider> = new Set(['subscription', 'api_key', 'openrouter', 'custom'])
  return valid.has(suffix as ApiProvider) ? (suffix as ApiProvider) : null
}

function legacyModeFromProfile(profile: ProviderProfile): ApiProvider | null {
  const legacy = parseLegacyModeFromMigratedId(profile.id)
  if (legacy) return legacy
  // Fallback: map credential type → ApiProvider when possible (new UI-
  // created profiles don't carry the `prof_migrated_` prefix).
  switch (profile.credential.type) {
    case 'claude-subscription':
      return 'subscription'
    case 'anthropic-api':
      return 'api_key'
    case 'anthropic-compat-proxy':
      return 'custom'
    default:
      return null
  }
}

// Suppress unused-import warning — retained for future UI helpers.
void migrateLegacyProviderSettings
