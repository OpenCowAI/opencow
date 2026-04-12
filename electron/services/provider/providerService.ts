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
  CreateProviderProfileInput,
  UpdateProviderProfilePatch,
  ProviderTestResult,
} from '../../../src/shared/providerProfile'
import {
  credentialKeyFor,
  generateProviderProfileId,
  legacyCredentialKey,
  migrateLegacyProviderSettings,
} from '../../../src/shared/providerProfile'

const log = createLogger('ProviderService')

export interface ProviderServiceDeps {
  dispatch: (event: DataBusEvent) => void
  credentialStore: CredentialStore
  /** Returns current provider settings (non-sensitive config). */
  getProviderSettings: () => ProviderSettings
  /**
   * Persist a mutation to `settings.provider`. Invoked by profile CRUD
   * methods after validating the change. Returns the saved snapshot.
   */
  updateProviderSettings?: (patch: Partial<ProviderSettings>) => Promise<ProviderSettings>
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
   * Phase B.3c semantics (COPY, not MOVE):
   *
   * During Phase B transition, the legacy `getProviderEnv()` / `getStatus()`
   * paths (keyed by ApiProvider activeMode) coexist with the new
   * `*ForProfile()` paths (keyed by `credential:${profileId}`). Both must
   * succeed, so this method COPIES the legacy value into the profile-
   * scoped slot — leaving the legacy key intact.
   *
   * When Phase C lands and the orchestrator is switched fully to
   * `getProviderEnvForProfile()`, a follow-up bootstrap pass will delete
   * the legacy keys.
   *
   * Idempotent: if the profile-scoped slot is already populated (user
   * re-authenticated via the new UI), the legacy copy is skipped —
   * don't clobber fresher values.
   */
  async applyProfileCredentialMigration(): Promise<void> {
    const settings = this.deps.getProviderSettings()
    const profiles = settings.profiles ?? []
    if (profiles.length === 0) return

    for (const profile of profiles) {
      const legacyMode = parseLegacyModeFromMigratedId(profile.id)
      if (!legacyMode) continue

      const legacyKey = legacyCredentialKey(legacyMode)
      const newKey = credentialKeyFor(profile.id)

      const legacyValue = await this.deps.credentialStore.getAs<unknown>(legacyKey)
      if (legacyValue === undefined) continue // never existed

      const existingAtNew = await this.deps.credentialStore.getAs<unknown>(newKey)
      if (existingAtNew !== undefined) continue // new slot already populated

      await this.deps.credentialStore.updateAs(newKey, legacyValue)
      log.info(`Credential migration: copied "${legacyKey}" → "${newKey}" (legacy key retained)`)
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

  // ── Phase B.4: Profile CRUD ────────────────────────────────────────
  //
  // These methods mutate `settings.provider.profiles` via the injected
  // `updateProviderSettings` callback AND (for create/remove) touch
  // CredentialStore at `credential:${profileId}`. Surfaced via IPC for
  // the Settings UI rewrite landing in Phase B.5.

  listProfiles(): ProviderProfile[] {
    return [...(this.deps.getProviderSettings().profiles ?? [])]
  }

  async createProfile(input: CreateProviderProfileInput): Promise<ProviderProfile> {
    this.assertSettingsUpdatesWired('createProfile')

    const id = generateProviderProfileId()
    const timestamp = new Date().toISOString()
    const profile: ProviderProfile = {
      id,
      name: input.name.trim(),
      credential: input.credential,
      ...(input.preferredModel ? { preferredModel: input.preferredModel } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    // Authenticate first so a failure leaves no orphan profile on disk.
    if (input.authParams) {
      const adapter = this.buildAdapterForProfile(profile)
      const result = await adapter.authenticate(input.authParams)
      if (!result.authenticated) {
        throw new Error(
          `Authentication failed for new profile "${profile.name}": ${result.error ?? 'unknown reason'}`,
        )
      }
    }

    const current = this.deps.getProviderSettings()
    const nextProfiles = [...(current.profiles ?? []), profile]
    await this.deps.updateProviderSettings!({
      profiles: nextProfiles,
      ...(input.setAsDefault || !current.defaultProfileId
        ? { defaultProfileId: id }
        : {}),
    })

    log.info(`Profile created: ${profile.name} (${id}, ${profile.credential.type})`)
    return profile
  }

  async updateProfile(
    id: ProviderProfileId,
    patch: UpdateProviderProfilePatch,
  ): Promise<ProviderProfile> {
    this.assertSettingsUpdatesWired('updateProfile')

    const profile = this.findProfile(id)
    if (!profile) {
      throw new Error(`Profile not found: ${id}`)
    }

    const updated: ProviderProfile = {
      ...profile,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.preferredModel === null
        ? { preferredModel: undefined }
        : patch.preferredModel !== undefined
          ? { preferredModel: patch.preferredModel }
          : {}),
      credential: patch.credentialConfig
        ? this.mergeCredentialConfig(profile.credential, patch.credentialConfig)
        : profile.credential,
      updatedAt: new Date().toISOString(),
    }

    // Re-authenticate if the caller provided new auth params (key rotation).
    if (patch.authParams) {
      const adapter = this.buildAdapterForProfile(updated)
      const result = await adapter.authenticate(patch.authParams)
      if (!result.authenticated) {
        throw new Error(
          `Re-authentication failed for profile "${updated.name}": ${result.error ?? 'unknown reason'}`,
        )
      }
    }

    const current = this.deps.getProviderSettings()
    const nextProfiles = (current.profiles ?? []).map((p) => (p.id === id ? updated : p))
    await this.deps.updateProviderSettings!({ profiles: nextProfiles })

    log.info(`Profile updated: ${updated.name} (${id})`)
    return updated
  }

  async removeProfile(id: ProviderProfileId): Promise<boolean> {
    this.assertSettingsUpdatesWired('removeProfile')

    const profile = this.findProfile(id)
    if (!profile) return false

    // Clear credentials first — if the settings save fails, we at least
    // don't leave dangling secrets for a profile that's about to vanish.
    try {
      const adapter = this.buildAdapterForProfile(profile)
      await adapter.logout()
    } catch (err) {
      log.warn(`Failed to clear credentials for profile ${id}`, err)
    }
    await this.deps.credentialStore.removeAt(credentialKeyFor(id))

    const current = this.deps.getProviderSettings()
    const nextProfiles = (current.profiles ?? []).filter((p) => p.id !== id)
    const nextDefault =
      current.defaultProfileId === id
        ? nextProfiles[0]?.id ?? null
        : current.defaultProfileId ?? null
    await this.deps.updateProviderSettings!({
      profiles: nextProfiles,
      defaultProfileId: nextDefault,
    })

    log.info(`Profile removed: ${profile.name} (${id})`)
    return true
  }

  async setDefaultProfile(id: ProviderProfileId | null): Promise<boolean> {
    this.assertSettingsUpdatesWired('setDefaultProfile')

    if (id !== null && !this.findProfile(id)) {
      throw new Error(`Cannot set default: profile not found (${id})`)
    }
    await this.deps.updateProviderSettings!({ defaultProfileId: id })
    log.info(`Default profile set to ${id ?? '(none)'}`)
    return true
  }

  /**
   * Test a profile's credentials by asking its adapter to verify status.
   *
   * Phase B.4 stub — returns pass/fail based on `checkStatus()` outcome.
   * Phase B.6 will upgrade this to send a minimal real request and
   * classify network / auth / server errors distinctly.
   */
  async testProfile(id: ProviderProfileId): Promise<ProviderTestResult> {
    const started = Date.now()
    const profile = this.findProfile(id)
    if (!profile) {
      return {
        profileId: id,
        outcome: { ok: false, reason: 'error', message: `Profile not found: ${id}` },
        durationMs: Date.now() - started,
      }
    }

    let adapter: ProviderAdapter
    try {
      adapter = this.buildAdapterForProfile(profile)
    } catch (err) {
      return {
        profileId: id,
        outcome: {
          ok: false,
          reason: 'unsupported',
          message: err instanceof Error ? err.message : String(err),
        },
        durationMs: Date.now() - started,
      }
    }

    try {
      const status = await adapter.checkStatus()
      if (status.authenticated) {
        return {
          profileId: id,
          outcome: { ok: true, detail: status.detail?.subscriptionType },
          durationMs: Date.now() - started,
        }
      }
      return {
        profileId: id,
        outcome: {
          ok: false,
          reason: 'unauthenticated',
          message: status.error ?? 'No valid credentials',
        },
        durationMs: Date.now() - started,
      }
    } catch (err) {
      return {
        profileId: id,
        outcome: {
          ok: false,
          reason: 'error',
          message: err instanceof Error ? err.message : String(err),
        },
        durationMs: Date.now() - started,
      }
    }
  }

  private assertSettingsUpdatesWired(caller: string): void {
    if (!this.deps.updateProviderSettings) {
      throw new Error(
        `ProviderService.${caller}: updateProviderSettings dep is required but was not provided`,
      )
    }
  }

  private mergeCredentialConfig(
    current: ProviderProfile['credential'],
    patch: Partial<Omit<ProviderProfile['credential'], 'type'>>,
  ): ProviderProfile['credential'] {
    return { ...current, ...patch } as ProviderProfile['credential']
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
