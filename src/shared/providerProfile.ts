// SPDX-License-Identifier: Apache-2.0

/**
 * Provider Profile — user-owned LLM account descriptor.
 *
 * Phase B data model (see
 * docs/proposals/2026-04-12-provider-management-redesign.md §4.1).
 *
 * Design invariants:
 *   1. Profile objects are **non-sensitive** and live in settings.json.
 *      All secrets (API keys, OAuth tokens) are stored in CredentialStore
 *      under the key `credential:${profileId}` and MUST NOT appear here.
 *   2. `ProviderType` defines all 8 protocol types up-front. Types not
 *      yet supported by the runtime are validated as "not yet implemented"
 *      at session start time, so UI can surface them as disabled options.
 *   3. `ProviderProfileId` is a branded string to prevent accidental
 *      mixing with raw session/project IDs.
 *   4. Migration from legacy `ProviderSettings { activeMode }` is
 *      idempotent — safe to re-run on already-migrated settings.
 */

import type { ApiProvider } from './types'

// ─── Brand ────────────────────────────────────────────────────────────

export type ProviderProfileId = string & { readonly __brand: 'ProviderProfileId' }

export function asProviderProfileId(raw: string): ProviderProfileId {
  return raw as ProviderProfileId
}

// ─── Type registry ────────────────────────────────────────────────────

/**
 * All 8 provider protocol types. Presence in this union does NOT imply
 * runtime support — see `isProviderTypeImplemented()` below.
 */
export type ProviderType =
  | 'claude-subscription'
  | 'anthropic-api'
  | 'anthropic-bedrock'
  | 'anthropic-vertex'
  | 'anthropic-compat-proxy'
  | 'openai-direct'
  | 'openai-compat-proxy'
  | 'gemini'

/**
 * Types that are wired end-to-end in the current OpenCow build.
 * Bedrock/Vertex are the only two still unimplemented — they require
 * AWS/GCP SDK integration which is a separate ticket.
 */
const IMPLEMENTED_PROVIDER_TYPES: ReadonlySet<ProviderType> = new Set([
  'claude-subscription',
  'anthropic-api',
  'anthropic-compat-proxy',
  'openai-direct',
  'openai-compat-proxy',
  'gemini',
])

export function isProviderTypeImplemented(type: ProviderType): boolean {
  return IMPLEMENTED_PROVIDER_TYPES.has(type)
}

// ─── Credential descriptor (non-sensitive only) ───────────────────────

/**
 * Non-sensitive, type-specific configuration. Secrets live in
 * CredentialStore keyed by profile id — they MUST NEVER appear here.
 */
export type ProviderCredential =
  | { type: 'claude-subscription' }
  | { type: 'anthropic-api' }
  | { type: 'anthropic-bedrock'; region: string }
  | { type: 'anthropic-vertex'; project: string; region: string }
  | {
      type: 'anthropic-compat-proxy'
      baseUrl: string
      authStyle: 'api_key' | 'bearer'
    }
  | { type: 'openai-direct' }
  | { type: 'openai-compat-proxy'; baseUrl: string }
  | { type: 'gemini' }

// ─── Profile ──────────────────────────────────────────────────────────

export interface ProviderProfile {
  readonly id: ProviderProfileId
  name: string
  credential: ProviderCredential
  preferredModel?: string
  readonly createdAt: string
  updatedAt: string
}

export interface ProviderProfileSettings {
  profiles: ProviderProfile[]
  defaultProfileId: ProviderProfileId | null
  /** Optional default model hint (applies when profile.preferredModel is unset). */
  defaultModel?: string
}

// ─── IPC payloads ─────────────────────────────────────────────────────

/**
 * Payload for `provider:create-profile`. Secrets (API key, OAuth tokens)
 * are passed in `authParams` and forwarded to the adapter's authenticate()
 * method — they are never embedded in the profile record on disk.
 */
export interface CreateProviderProfileInput {
  name: string
  credential: ProviderCredential
  preferredModel?: string
  /** Adapter-specific authentication parameters (apiKey, baseUrl, authStyle, etc.). */
  authParams?: Record<string, unknown>
  /** If true, the newly created profile becomes the default. */
  setAsDefault?: boolean
}

/** Editable fields of an existing profile. `credential.type` is immutable. */
export interface UpdateProviderProfilePatch {
  name?: string
  preferredModel?: string | null
  /**
   * Non-secret credential fields (baseUrl, authStyle, region, etc.).
   * The discriminator `type` cannot be changed after creation — to switch
   * types, remove the profile and create a new one.
   */
  credentialConfig?: Partial<Omit<ProviderCredential, 'type'>>
  /** New adapter-specific authentication parameters (e.g. rotate API key). */
  authParams?: Record<string, unknown>
}

export type ProviderTestOutcome =
  | { ok: true; detail?: string }
  | { ok: false; reason: 'unauthenticated' | 'network' | 'unsupported' | 'error'; message: string }

export interface ProviderTestResult {
  profileId: ProviderProfileId
  outcome: ProviderTestOutcome
  /** Wall-clock ms the test took. */
  durationMs: number
}

// ─── Id generation ────────────────────────────────────────────────────

/**
 * Generate a stable, URL-safe profile id. Format: `prof_${10-char alphanumeric}`.
 * Not cryptographic — collision risk for 10 chars over alphabet-36 is
 * negligible for the scale of profiles a single user holds (~ <100).
 */
export function generateProviderProfileId(): ProviderProfileId {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let suffix = ''
  for (let i = 0; i < 10; i++) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return `prof_${suffix}` as ProviderProfileId
}

// ─── Legacy shape (Phase A output) ────────────────────────────────────

export interface LegacyProviderSettings {
  activeMode: ApiProvider | null
  defaultModel?: string
}

// ─── Migration ────────────────────────────────────────────────────────

export interface MigrationCredentialPlan {
  /** Existing CredentialStore key (before migration). */
  fromKey: string
  /** New CredentialStore key (after migration). */
  toKey: string
}

export interface MigrationResult {
  settings: ProviderProfileSettings
  /**
   * Rename plan for CredentialStore. Callers apply this to the store
   * after settings.json is written. Empty when nothing to rename
   * (e.g. no legacy activeMode was set).
   */
  credentialRenames: MigrationCredentialPlan[]
}

/**
 * Migrate legacy `ProviderSettings` into the new profile-list shape.
 *
 * Rules (from proposal §6.1):
 *   - `subscription` → profile type `claude-subscription` named "Claude Pro/Max"
 *   - `api_key`      → profile type `anthropic-api` named "Anthropic API"
 *   - `openrouter`   → profile type `anthropic-compat-proxy` named "OpenRouter",
 *                      baseUrl preset to the OpenRouter Anthropic endpoint
 *   - `custom`       → profile type `anthropic-compat-proxy` named "Custom Proxy"
 *                      (baseUrl/authStyle unknown — filled by caller from stored credential)
 *   - `null`         → empty profile list
 *
 * The migration is **idempotent**: when `input` is already the new shape
 * (detected by presence of `profiles` array), it is returned unchanged.
 *
 * Credential renames are described declaratively. The caller is
 * responsible for applying them to CredentialStore.
 */
export function migrateLegacyProviderSettings(
  input: LegacyProviderSettings | ProviderProfileSettings | undefined | null,
  opts: {
    /** Injected for deterministic tests; defaults to `generateProviderProfileId`. */
    generateId?: () => ProviderProfileId
    /** Injected for deterministic tests; defaults to `new Date().toISOString()`. */
    now?: () => string
  } = {},
): MigrationResult {
  const now = opts.now ?? (() => new Date().toISOString())

  // Already new shape → passthrough.
  if (input && Array.isArray((input as ProviderProfileSettings).profiles)) {
    return {
      settings: input as ProviderProfileSettings,
      credentialRenames: [],
    }
  }

  const legacy = (input ?? {}) as LegacyProviderSettings
  const defaultModel = legacy.defaultModel
  const mode = legacy.activeMode

  if (!mode) {
    return {
      settings: {
        profiles: [],
        defaultProfileId: null,
        ...(defaultModel ? { defaultModel } : {}),
      },
      credentialRenames: [],
    }
  }

  // Deterministic id for migrated profiles — lets settingsService.load()
  // be called repeatedly on a legacy (not-yet-saved-back) settings.json
  // without generating fresh ids. New profiles created via UI still use
  // `generateProviderProfileId()` and get random ids.
  const generateId = opts.generateId ?? (() => deterministicMigratedId(mode))
  const profileId = generateId()
  const timestamp = now()
  const profile = buildProfileFromLegacyMode(mode, profileId, timestamp)

  return {
    settings: {
      profiles: [profile],
      defaultProfileId: profileId,
      ...(defaultModel ? { defaultModel } : {}),
    },
    credentialRenames: [
      {
        fromKey: legacyCredentialKey(mode),
        toKey: credentialKeyFor(profileId),
      },
    ],
  }
}

/**
 * Deterministic id used when migrating a legacy `activeMode` into a profile.
 * Must be stable across repeated loads of the same unsaved settings.json.
 */
export function deterministicMigratedId(mode: ApiProvider): ProviderProfileId {
  return `prof_migrated_${mode}` as ProviderProfileId
}

/**
 * Deterministic id for profiles migrated from the legacy Codex engine
 * (line-of-business in OpenCow <= 0.3.21). Distinct prefix so Codex
 * migrations never collide with the Claude-engine migration above.
 */
export function deterministicMigratedCodexId(mode: ApiProvider): ProviderProfileId {
  return `prof_migrated_codex_${mode}` as ProviderProfileId
}

/**
 * Migrate a legacy Codex-engine configuration (`provider.byEngine.codex.*`
 * from pre-Phase-A settings) into profile records. All Codex profiles
 * map to OpenAI-family types which are not yet implemented at runtime
 * (Phase D dependency on opencow-agent-sdk M1). They are still produced
 * so the user's existing configuration is NOT silently lost — the
 * Settings UI shows them as "SDK M1" pending entries.
 *
 * Rules:
 *   - `api_key`    → type `openai-direct`, name "OpenAI (Codex)"
 *   - `openrouter` → type `openai-compat-proxy`, name "OpenRouter (Codex)",
 *                    baseUrl preset to OpenRouter's OpenAI endpoint
 *   - `custom`     → type `openai-compat-proxy`, name "Custom OpenAI-Compatible",
 *                    baseUrl populated by the credential-layer migration
 *   - `null` / `subscription` → nothing (Codex never had OAuth)
 */
export function migrateLegacyCodexSettings(
  codexActiveMode: string | null | undefined,
  opts: { now?: () => string } = {},
): { profile: ProviderProfile; credentialRename: MigrationCredentialPlan } | null {
  const now = opts.now ?? (() => new Date().toISOString())
  const mode = codexActiveMode as ApiProvider | null | undefined
  if (!mode || mode === 'subscription') return null
  if (mode !== 'api_key' && mode !== 'openrouter' && mode !== 'custom') return null

  const id = deterministicMigratedCodexId(mode)
  const timestamp = now()
  const profile = buildCodexProfileFromLegacyMode(mode, id, timestamp)
  return {
    profile,
    credentialRename: {
      fromKey: legacyCredentialKey(mode),
      toKey: credentialKeyFor(id),
    },
  }
}

function buildCodexProfileFromLegacyMode(
  mode: 'api_key' | 'openrouter' | 'custom',
  id: ProviderProfileId,
  timestamp: string,
): ProviderProfile {
  switch (mode) {
    case 'api_key':
      return {
        id,
        name: 'OpenAI (Codex)',
        credential: { type: 'openai-direct' },
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    case 'openrouter':
      return {
        id,
        name: 'OpenRouter (Codex)',
        credential: {
          type: 'openai-compat-proxy',
          baseUrl: 'https://openrouter.ai/api/v1',
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    case 'custom':
      return {
        id,
        name: 'Custom OpenAI-Compatible',
        credential: {
          type: 'openai-compat-proxy',
          baseUrl: '', // populated by applyProfileCredentialMigration
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      }
  }
}

/** CredentialStore key where secrets for a profile live. */
export function credentialKeyFor(id: ProviderProfileId): string {
  return `credential:${id}`
}

/**
 * CredentialStore key used by the legacy flat-mode schema.
 *
 * NOTE: the adapter default keys are NOT 1:1 with ApiProvider names —
 * AnthropicApiKeyProvider uses `apiKey` (camelCase) as its default key,
 * while all other adapters use their ApiProvider name as-is.
 */
export function legacyCredentialKey(mode: ApiProvider): string {
  if (mode === 'api_key') return 'apiKey'
  return mode
}

function buildProfileFromLegacyMode(
  mode: ApiProvider,
  id: ProviderProfileId,
  timestamp: string,
): ProviderProfile {
  switch (mode) {
    case 'subscription':
      return {
        id,
        name: 'Claude Pro/Max',
        credential: { type: 'claude-subscription' },
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    case 'api_key':
      return {
        id,
        name: 'Anthropic API',
        credential: { type: 'anthropic-api' },
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    case 'openrouter':
      return {
        id,
        name: 'OpenRouter',
        credential: {
          type: 'anthropic-compat-proxy',
          baseUrl: 'https://openrouter.ai/api/v1',
          authStyle: 'bearer',
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    case 'custom':
      return {
        id,
        name: 'Custom Proxy',
        credential: {
          // baseUrl/authStyle are recovered from stored credential payload
          // by the settings service after migration — they live in
          // CredentialStore as part of the legacy `custom` credential blob.
          type: 'anthropic-compat-proxy',
          baseUrl: '',
          authStyle: 'bearer',
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      }
  }
}
