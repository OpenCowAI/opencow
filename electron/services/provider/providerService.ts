// SPDX-License-Identifier: Apache-2.0

/**
 * ProviderService — profile-aware (Phase B.7 cutover).
 *
 * Responsibilities:
 *   1. Create / read / update / remove user-owned provider profiles.
 *   2. Emit SDK env vars + HTTP auth for a given profile.
 *   3. Test a profile's credentials.
 *   4. Broadcast status changes via DataBus.
 *
 * Architecture:
 *   - Every profile has its own adapter instance keyed by
 *     `credential:${profileId}`. Adapters are constructed on demand
 *     (cheap — each holds only a CredentialStore reference + a string
 *     key).
 *   - Non-sensitive config in `settings.provider.profiles[]`.
 *   - Secrets in CredentialStore, encrypted via OS keychain.
 *   - Historical migration (pre-Phase-A `byEngine.*`, Phase A flat
 *     activeMode, Phase B.0-B.6 preview shapes) is the sole
 *     responsibility of `electron/services/provider/migration/`.
 */

import type {
  ProviderSettings,
  ProviderStatus,
  DataBusEvent,
} from '@shared/types'
import type { ProviderAdapter } from './types'
import type { LLMAuthConfig } from '../../llm/types'
import { CredentialStore } from './credentialStore'
import { SubscriptionProvider } from './providers/subscription'
import { AnthropicApiKeyProvider } from './providers/apiKey'
import { CustomProvider } from './providers/custom'
import {
  OpenAIDirectProvider,
  OpenAICompatProxyProvider,
} from './providers/openai'
import { GeminiProvider } from './providers/gemini'
import { createLogger } from '../../platform/logger'
import type { ProviderCredentialInfo } from '@shared/types'
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
} from '../../../src/shared/providerProfile'

const log = createLogger('ProviderService')

export interface ProviderServiceDeps {
  dispatch: (event: DataBusEvent) => void
  credentialStore: CredentialStore
  /** Returns current provider settings. Always the v1 shape post-migration. */
  getProviderSettings: () => ProviderSettings
  /** Persist a patch to `settings.provider`; returns the saved snapshot. */
  updateProviderSettings: (patch: Partial<ProviderSettings>) => Promise<ProviderSettings>
  /** Bring the app window to the foreground (called after OAuth success). */
  focusApp?: () => void
}

export class ProviderService {
  private readonly deps: ProviderServiceDeps

  constructor(deps: ProviderServiceDeps) {
    this.deps = deps
  }

  // ── Profile CRUD ────────────────────────────────────────────────────

  listProfiles(): ProviderProfile[] {
    return [...(this.deps.getProviderSettings().profiles ?? [])]
  }

  async createProfile(input: CreateProviderProfileInput): Promise<ProviderProfile> {
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

    if (input.authParams) {
      const adapter = this.buildAdapterForProfile(profile)
      const result = await adapter.authenticate(input.authParams)
      if (!result.authenticated) {
        throw new Error(
          `Authentication failed for "${profile.name}": ${result.error ?? 'unknown reason'}`,
        )
      }
    }

    const current = this.deps.getProviderSettings()
    const nextProfiles = [...(current.profiles ?? []), profile]
    await this.deps.updateProviderSettings({
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
    const profile = this.requireProfile(id)

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

    if (patch.authParams) {
      const adapter = this.buildAdapterForProfile(updated)
      const result = await adapter.authenticate(patch.authParams)
      if (!result.authenticated) {
        throw new Error(
          `Re-authentication failed for "${updated.name}": ${result.error ?? 'unknown reason'}`,
        )
      }
    } else if (patch.credentialConfig) {
      await this.syncStoredCredentialConfig(updated)
    }

    const current = this.deps.getProviderSettings()
    const nextProfiles = (current.profiles ?? []).map((p) => (p.id === id ? updated : p))
    await this.deps.updateProviderSettings({ profiles: nextProfiles })

    log.info(`Profile updated: ${updated.name} (${id})`)
    return updated
  }

  async removeProfile(id: ProviderProfileId): Promise<boolean> {
    const profile = this.findProfile(id)
    if (!profile) return false

    // Clear credentials before removing the profile record so a failure
    // mid-op doesn't leave orphaned secrets in the store.
    try {
      await this.buildAdapterForProfile(profile).logout()
    } catch (err) {
      log.warn(`Profile logout failed (${id}) — proceeding with removal`, err)
    }
    await this.deps.credentialStore.removeAt(credentialKeyFor(id))

    const current = this.deps.getProviderSettings()
    const nextProfiles = (current.profiles ?? []).filter((p) => p.id !== id)
    const nextDefault =
      current.defaultProfileId === id
        ? nextProfiles[0]?.id ?? null
        : current.defaultProfileId ?? null
    await this.deps.updateProviderSettings({
      profiles: nextProfiles,
      defaultProfileId: nextDefault,
    })

    log.info(`Profile removed: ${profile.name} (${id})`)
    return true
  }

  async setDefaultProfile(id: ProviderProfileId | null): Promise<boolean> {
    if (id !== null && !this.findProfile(id)) {
      throw new Error(`Cannot set default: profile not found (${id})`)
    }
    await this.deps.updateProviderSettings({ defaultProfileId: id })
    log.info(`Default profile set to ${id ?? '(none)'}`)
    return true
  }

  // ── Env + status resolution for the orchestrator ───────────────────

  /**
   * SDK env vars for a profile. Returns `{}` when the profile is
   * absent or has no credentials — the orchestrator treats that as
   * "not configured" and surfaces an auth error.
   */
  async getProviderEnvForProfile(profileId: ProviderProfileId): Promise<Record<string, string>> {
    const profile = this.findProfile(profileId)
    if (!profile) {
      log.warn(`getProviderEnvForProfile: profile "${profileId}" not found`)
      return {}
    }

    // Non-Claude profiles MUST specify a model. The SDK's built-in
    // defaults target Anthropic endpoints only; letting a session
    // spawn without a model against an OpenAI-compat / Gemini endpoint
    // causes the SDK to emit malformed requests that upstream returns
    // as error text — which the SDK then surfaces as assistant content
    // ("API Error: fetch failed"). Fail fast here so the user gets a
    // clear error immediately instead of a confusing fake reply.
    if (profileRequiresExplicitModel(profile) && !profile.preferredModel) {
      throw new ProfileMisconfiguredError(
        profile,
        `Profile "${profile.name}" (${profile.credential.type}) requires an explicit Model — open Settings → Providers, edit this profile, and set a Model (e.g. ${suggestedModelFor(profile)}).`,
      )
    }

    const adapter = this.tryBuildAdapter(profile)
    if (!adapter) return {}

    const env = await adapter.getEnv()
    // Protocol-aware model injection. Setting OPENAI_MODEL to a Claude
    // model name (or vice-versa) would break upstream routing — each
    // profile's preferredModel only makes sense for its own protocol.
    const preferred = profile.preferredModel
    if (preferred) {
      switch (this.resolveProtocol(profile)) {
        case 'anthropic':
          env.ANTHROPIC_DEFAULT_SONNET_MODEL = preferred
          break
        case 'openai':
          env.OPENAI_MODEL = preferred
          break
        case 'gemini':
          env.GEMINI_MODEL = preferred
          break
      }
    }
    log.info('getProviderEnvForProfile', {
      profile: profile.name,
      type: profile.credential.type,
      model: preferred ?? '(none — SDK default)',
      envKeys: Object.keys(env).sort(),
    })
    return env
  }

  /**
   * Resolve the default profile id, honouring an optional override.
   * Used by the orchestrator when starting sessions.
   */
  resolveProfileId(override?: ProviderProfileId | null): ProviderProfileId | null {
    if (override) return override
    return this.deps.getProviderSettings().defaultProfileId ?? null
  }

  async getStatusForProfile(profileId: ProviderProfileId): Promise<ProviderStatus> {
    const profile = this.findProfile(profileId)
    if (!profile) return { state: 'unauthenticated', profileId: null }

    const adapter = this.tryBuildAdapter(profile)
    if (!adapter) {
      return {
        state: 'error',
        profileId,
        error: `Profile type "${profile.credential.type}" is not yet supported in this build`,
      }
    }

    const adapterStatus = await adapter.checkStatus()
    return {
      state: adapterStatus.authenticated ? 'authenticated' : 'unauthenticated',
      profileId,
      detail: adapterStatus.detail,
      error: adapterStatus.error,
    }
  }

  async getCredentialForProfile(
    profileId: ProviderProfileId,
  ): Promise<ProviderCredentialInfo | null> {
    const profile = this.findProfile(profileId)
    if (!profile) return null
    const adapter = this.tryBuildAdapter(profile)
    if (!adapter?.getCredential) return null
    return adapter.getCredential()
  }

  async resolveHTTPAuthForProfile(profileId: ProviderProfileId): Promise<LLMAuthConfig> {
    const profile = this.requireProfile(profileId)
    const adapter = this.tryBuildAdapter(profile)
    if (!adapter) {
      throw new Error(`Profile type "${profile.credential.type}" is not yet supported`)
    }
    const httpAuth = await adapter.getHTTPAuth()
    if (!httpAuth) {
      throw new Error(`Profile "${profile.name}" has no stored HTTP credentials`)
    }
    if (!profile.preferredModel) {
      throw new Error(
        `Profile "${profile.name}" has no preferredModel set — direct HTTP calls require an explicit model`,
      )
    }
    return {
      protocol: this.resolveProtocol(profile),
      apiKey: httpAuth.apiKey,
      baseUrl: httpAuth.baseUrl,
      authStyle: httpAuth.authStyle,
      model: profile.preferredModel,
    }
  }

  // ── Test Connection ────────────────────────────────────────────────

  async testProfile(id: ProviderProfileId): Promise<ProviderTestResult> {
    const started = Date.now()
    const profile = this.findProfile(id)
    if (!profile) {
      log.warn(`testProfile: profile not found (${id})`)
      return {
        profileId: id,
        outcome: { ok: false, reason: 'error', message: `Profile not found: ${id}` },
        durationMs: Date.now() - started,
      }
    }

    log.info(`testProfile started`, {
      profile: profile.name,
      type: profile.credential.type,
    })

    try {
      const adapter = this.buildAdapterForProfile(profile)
      const result = await adapter.probe()
      const durationMs = Date.now() - started

      if (result.ok) {
        log.info(`testProfile OK`, {
          profile: profile.name,
          type: profile.credential.type,
          durationMs,
          detail: result.detail,
        })
      } else {
        log.warn(`testProfile FAIL`, {
          profile: profile.name,
          type: profile.credential.type,
          reason: result.reason,
          message: result.message,
          durationMs,
        })
      }

      return { profileId: id, outcome: result, durationMs }
    } catch (err) {
      const durationMs = Date.now() - started
      const message = err instanceof Error ? err.message : String(err)
      log.error(`testProfile threw`, {
        profile: profile.name,
        type: profile.credential.type,
        error: message,
        durationMs,
      })
      return {
        profileId: id,
        outcome: { ok: false, reason: 'error', message },
        durationMs,
      }
    }
  }

  // ── Internals ──────────────────────────────────────────────────────

  private findProfile(id: ProviderProfileId): ProviderProfile | null {
    const profiles = this.deps.getProviderSettings().profiles ?? []
    return profiles.find((p) => p.id === id) ?? null
  }

  private requireProfile(id: ProviderProfileId): ProviderProfile {
    const profile = this.findProfile(id)
    if (!profile) throw new Error(`Profile not found: ${id}`)
    return profile
  }

  /** Build adapter or return null for types that aren't yet implemented. */
  private tryBuildAdapter(profile: ProviderProfile): ProviderAdapter | null {
    try {
      return this.buildAdapterForProfile(profile)
    } catch {
      return null
    }
  }

  private buildAdapterForProfile(profile: ProviderProfile): ProviderAdapter {
    const key = credentialKeyFor(profile.id)
    const store = this.deps.credentialStore
    switch (profile.credential.type) {
      case 'claude-subscription':
        return new SubscriptionProvider(store, key)
      case 'anthropic-api':
        return new AnthropicApiKeyProvider(store, key)
      case 'anthropic-compat-proxy':
        return new CustomProvider(store, key)
      case 'openai-direct':
        return new OpenAIDirectProvider(store, key)
      case 'openai-compat-proxy':
        return new OpenAICompatProxyProvider(store, key)
      case 'gemini':
        return new GeminiProvider(store, key)
      default: {
        const exhaustive: never = profile.credential
        throw new Error(`Unhandled profile credential: ${JSON.stringify(exhaustive)}`)
      }
    }
  }

  private mergeCredentialConfig(
    current: ProviderProfile['credential'],
    patch: Partial<Omit<ProviderProfile['credential'], 'type'>>,
  ): ProviderProfile['credential'] {
    return { ...current, ...patch } as ProviderProfile['credential']
  }

  private async syncStoredCredentialConfig(profile: ProviderProfile): Promise<void> {
    const adapter = this.tryBuildAdapter(profile)
    if (!adapter?.getCredential) return

    const current = await adapter.getCredential()
    const apiKey = current?.apiKey?.trim()
    if (!apiKey) return

    let authParams: Record<string, unknown> | null = null
    switch (profile.credential.type) {
      case 'anthropic-compat-proxy':
        authParams = {
          apiKey,
          baseUrl: profile.credential.baseUrl,
          authStyle: profile.credential.authStyle,
        }
        break
      case 'openai-compat-proxy':
        authParams = {
          apiKey,
          baseUrl: profile.credential.baseUrl,
        }
        break
      case 'claude-subscription':
      case 'anthropic-api':
      case 'openai-direct':
      case 'gemini':
        return
    }

    const result = await adapter.authenticate(authParams)
    if (!result.authenticated) {
      throw new Error(
        `Credential configuration update failed for "${profile.name}": ${result.error ?? 'unknown reason'}`,
      )
    }
  }

  private resolveProtocol(profile: ProviderProfile): 'anthropic' | 'openai' | 'gemini' {
    switch (profile.credential.type) {
      case 'claude-subscription':
      case 'anthropic-api':
      case 'anthropic-compat-proxy':
        return 'anthropic'
      case 'openai-direct':
      case 'openai-compat-proxy':
        return 'openai'
      case 'gemini':
        return 'gemini'
    }
  }

  // ── Internal: status broadcast ─────────────────────────────────────

  broadcastProfileStatus(status: ProviderStatus): void {
    this.deps.dispatch({ type: 'provider:status', payload: status })
  }

  /** Drive the app focus hook after OAuth completion. */
  focusAppWindow(): void {
    this.deps.focusApp?.()
  }
}

/**
 * Thrown when a profile is selected for use but lacks mandatory
 * configuration (today: `preferredModel` on non-Claude profiles).
 * Callers SHOULD catch this at the orchestrator boundary and surface
 * the message to the user via the session error channel.
 */
export class ProfileMisconfiguredError extends Error {
  constructor(readonly profile: ProviderProfile, message: string) {
    super(message)
    this.name = 'ProfileMisconfiguredError'
  }
}

function profileRequiresExplicitModel(profile: ProviderProfile): boolean {
  switch (profile.credential.type) {
    case 'claude-subscription':
      // Anthropic OAuth sessions use Anthropic's server-side default.
      return false
    case 'anthropic-api':
      // Direct Anthropic API: SDK's built-in model default matches.
      return false
    case 'anthropic-compat-proxy':
    case 'openai-direct':
    case 'openai-compat-proxy':
    case 'gemini':
      return true
  }
}

function suggestedModelFor(profile: ProviderProfile): string {
  switch (profile.credential.type) {
    case 'claude-subscription':
    case 'anthropic-api':
    case 'anthropic-compat-proxy':
      return 'claude-sonnet-4-6'
    case 'openai-direct':
    case 'openai-compat-proxy':
      return 'gpt-5.4'
    case 'gemini':
      return 'gemini-2.5-pro'
  }
}
