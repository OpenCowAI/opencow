// SPDX-License-Identifier: Apache-2.0

/**
 * Pure migration planner.
 *
 * Given the raw settings.json contents (in whatever historical shape)
 * and awareness of whether the legacy Codex credentials file exists,
 * compute a `MigrationPlan` describing exactly what profiles to
 * synthesise, what credentials to move, and what legacy state to
 * discard. No disk I/O in this module — all side effects live in
 * `apply.ts`.
 */

import type { ApiProvider, ProviderSettings } from '@shared/types'
import { generateProviderProfileId } from '@shared/providerProfile'
import type { ProviderProfile } from '@shared/providerProfile'
import type {
  CredentialMove,
  MigratedProviderProfile,
  MigrationPlan,
  MigrationSource,
} from './types'
import { PROVIDER_SCHEMA_VERSION } from './types'

// ─── Legacy settings shapes we recognise ─────────────────────────────

interface LegacyEngineSettings {
  activeMode?: ApiProvider | null
  defaultModel?: string
}

interface LegacyProviderShape {
  schemaVersion?: number
  activeMode?: ApiProvider | null
  defaultModel?: string
  byEngine?: {
    claude?: LegacyEngineSettings
    codex?: LegacyEngineSettings
  }
  // Any prior in-memory / on-disk profiles are IGNORED by the planner
  // — the migration re-derives profiles from authoritative legacy
  // fields so the output is deterministic regardless of which Phase B
  // preview version the user last ran.
  profiles?: unknown
  defaultProfileId?: unknown
}

// ─── Defaults used when migrating openrouter/custom entries ──────────

const OPENROUTER_CLAUDE_BASE_URL = 'https://openrouter.ai/api/v1'
const OPENROUTER_OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'

// ─── Legacy credential key names ─────────────────────────────────────

/**
 * CredentialStore key names used by the adapters in OpenCow <= 0.3.21.
 * For Claude: in the main credentials file. For Codex: in the separate
 * `credentials-codex.enc` file.
 */
const LEGACY_CREDENTIAL_KEYS: Record<ApiProvider, string> = {
  subscription: 'subscription',
  api_key: 'apiKey',
  openrouter: 'openrouter',
  custom: 'custom',
}

// ─── Public API ──────────────────────────────────────────────────────

export interface PlanInput {
  rawProvider: unknown
  legacyCodexFilePresent: boolean
}

export function planProviderMigration(input: PlanInput): MigrationPlan {
  const provider = normaliseRawProvider(input.rawProvider)

  // Already migrated — settings.json has schemaVersion 1.
  if (provider.schemaVersion === PROVIDER_SCHEMA_VERSION) {
    return noopPlan('already-migrated', toV1Settings(provider))
  }

  const claudeMode = resolveLegacyMode(provider, 'claude')
  const codexMode = resolveLegacyMode(provider, 'codex')
  const hasAnyLegacyConfig = claudeMode !== null || codexMode !== null

  // Fresh install: no legacy fields at all.
  if (!hasAnyLegacyConfig) {
    return noopPlan('fresh-install', {
      schemaVersion: PROVIDER_SCHEMA_VERSION,
      profiles: [],
      defaultProfileId: null,
      ...(provider.defaultModel ? { defaultModel: provider.defaultModel } : {}),
    })
  }

  const profiles: MigratedProviderProfile[] = []
  const moves: CredentialMove[] = []

  if (claudeMode) {
    const built = buildClaudeMigration(claudeMode)
    profiles.push(built.profile)
    moves.push(built.credentialMove)
  }

  // Codex credentials only migrate when the codex file was actually on
  // disk. If the user reconfigured activeMode to codex on a machine
  // where the file was never created (rare edge case — Phase A-only
  // users couldn't have), skip the credential move but still produce
  // the profile record so the user can re-authenticate.
  if (codexMode) {
    const built = buildCodexMigration(codexMode, input.legacyCodexFilePresent)
    profiles.push(built.profile)
    if (built.credentialMove) moves.push(built.credentialMove)
  }

  // Pick the default: Claude-derived profile wins when both exist
  // (Codex types currently route to OpenAI — a deliberate change from
  // the user's original engine, we shouldn't auto-select it). If only
  // one side was configured, that one becomes default.
  const defaultProfileId = profiles[0]?.id ?? null

  return {
    targetSettings: {
      schemaVersion: PROVIDER_SCHEMA_VERSION,
      profiles,
      defaultProfileId,
      ...(provider.defaultModel ? { defaultModel: provider.defaultModel } : {}),
    },
    credentialMoves: moves,
    legacyKeysToDelete: moves
      .filter((m) => m.source === 'main')
      .map((m) => m.fromKey),
    deleteLegacyCodexFile: input.legacyCodexFilePresent,
    reason: 'upgrade',
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function normaliseRawProvider(raw: unknown): LegacyProviderShape {
  if (!raw || typeof raw !== 'object') return {}
  return raw as LegacyProviderShape
}

function toV1Settings(provider: LegacyProviderShape): ProviderSettings {
  return {
    schemaVersion: PROVIDER_SCHEMA_VERSION,
    profiles: Array.isArray(provider.profiles) ? (provider.profiles as ProviderProfile[]) : [],
    defaultProfileId: (provider.defaultProfileId ?? null) as ProviderSettings['defaultProfileId'],
    ...(provider.defaultModel ? { defaultModel: provider.defaultModel } : {}),
  }
}

function resolveLegacyMode(
  provider: LegacyProviderShape,
  engine: 'claude' | 'codex',
): ApiProvider | null {
  const candidate = provider.byEngine?.[engine]?.activeMode ?? null
  if (candidate) return candidate
  // The Phase A flat shape stored Claude's activeMode at the root.
  // Codex never had a root form.
  if (engine === 'claude' && provider.activeMode) return provider.activeMode
  return null
}

function noopPlan(
  reason: 'fresh-install' | 'already-migrated',
  targetSettings: ProviderSettings,
): MigrationPlan {
  return {
    targetSettings,
    credentialMoves: [],
    legacyKeysToDelete: [],
    deleteLegacyCodexFile: false,
    reason,
  }
}

// ─── Claude engine profile builders ──────────────────────────────────

interface BuildResult {
  profile: MigratedProviderProfile
  credentialMove: CredentialMove
}

function buildClaudeMigration(mode: ApiProvider): BuildResult {
  const id = generateProviderProfileId()
  const timestamp = new Date().toISOString()
  const source: MigrationSource = { engine: 'claude', legacyMode: mode }
  const fromKey = LEGACY_CREDENTIAL_KEYS[mode]
  const toKey = `credential:${id}`

  switch (mode) {
    case 'subscription':
      return {
        profile: {
          id,
          name: 'Claude Pro/Max',
          credential: { type: 'claude-subscription' },
          createdAt: timestamp,
          updatedAt: timestamp,
          _migrationSource: source,
        },
        credentialMove: { source: 'main', fromKey, toKey, profileId: id },
      }
    case 'api_key':
      return {
        profile: {
          id,
          name: 'Anthropic API',
          credential: { type: 'anthropic-api' },
          createdAt: timestamp,
          updatedAt: timestamp,
          _migrationSource: source,
        },
        credentialMove: { source: 'main', fromKey, toKey, profileId: id },
      }
    case 'openrouter':
      return {
        profile: {
          id,
          name: 'OpenRouter',
          credential: {
            type: 'anthropic-compat-proxy',
            // baseUrl is placeholder-rewritten by the transform below using
            // the legacy blob's baseUrl if present.
            baseUrl: OPENROUTER_CLAUDE_BASE_URL,
            authStyle: 'bearer',
          },
          createdAt: timestamp,
          updatedAt: timestamp,
          _migrationSource: source,
        },
        credentialMove: {
          source: 'main',
          fromKey,
          toKey,
          transform: (blob) => {
            const legacy = (blob ?? {}) as { apiKey?: string; baseUrl?: string }
            const baseUrl = legacy.baseUrl?.trim() || OPENROUTER_CLAUDE_BASE_URL
            return { apiKey: legacy.apiKey ?? '', baseUrl, authStyle: 'bearer' }
          },
          enrichProfile: (finalBlob) => {
            const blob = finalBlob as { baseUrl?: string; authStyle?: 'api_key' | 'bearer' }
            return {
              credential: {
                type: 'anthropic-compat-proxy',
                baseUrl: blob.baseUrl ?? OPENROUTER_CLAUDE_BASE_URL,
                authStyle: blob.authStyle ?? 'bearer',
              },
            }
          },
          profileId: id,
        },
      }
    case 'custom':
      return {
        profile: {
          id,
          name: 'Custom Proxy',
          // baseUrl/authStyle left empty — applied will patch them after
          // reading the legacy blob (see apply.ts).
          credential: {
            type: 'anthropic-compat-proxy',
            baseUrl: '',
            authStyle: 'bearer',
          },
          createdAt: timestamp,
          updatedAt: timestamp,
          _migrationSource: source,
        },
        credentialMove: {
          source: 'main',
          fromKey,
          toKey,
          profileId: id,
          transform: (blob) => {
            const legacy = (blob ?? {}) as {
              apiKey?: string
              baseUrl?: string
              authStyle?: 'api_key' | 'bearer'
            }
            return {
              apiKey: legacy.apiKey ?? '',
              baseUrl: legacy.baseUrl?.trim() ?? '',
              authStyle: legacy.authStyle ?? 'bearer',
            }
          },
          enrichProfile: (finalBlob) => {
            const blob = finalBlob as { baseUrl?: string; authStyle?: 'api_key' | 'bearer' }
            return {
              credential: {
                type: 'anthropic-compat-proxy',
                baseUrl: blob.baseUrl ?? '',
                authStyle: blob.authStyle ?? 'bearer',
              },
            }
          },
        },
      }
  }
}

// ─── Codex engine profile builders (OpenAI-family types) ─────────────

function buildCodexMigration(
  mode: ApiProvider,
  legacyFilePresent: boolean,
): { profile: MigratedProviderProfile; credentialMove: CredentialMove | null } {
  const id = generateProviderProfileId()
  const timestamp = new Date().toISOString()
  const source: MigrationSource = { engine: 'codex', legacyMode: mode }
  const fromKey = LEGACY_CREDENTIAL_KEYS[mode]
  const toKey = `credential:${id}`

  const codexEnrich = buildCodexProfileEnrichment(mode)
  const credentialMove: CredentialMove | null = legacyFilePresent
    ? {
        source: 'codex',
        fromKey,
        toKey,
        profileId: id,
        transform: buildCodexBlobTransform(mode),
        enrichProfile: codexEnrich,
      }
    : null

  switch (mode) {
    case 'subscription':
      // Codex never had subscription — treat as api_key fallback.
      return buildCodexApiKeyProfile(id, timestamp, source, credentialMove)
    case 'api_key':
      return buildCodexApiKeyProfile(id, timestamp, source, credentialMove)
    case 'openrouter':
      return {
        profile: {
          id,
          name: 'OpenRouter (OpenAI)',
          credential: { type: 'openai-compat-proxy', baseUrl: OPENROUTER_OPENAI_BASE_URL },
          createdAt: timestamp,
          updatedAt: timestamp,
          _migrationSource: source,
        },
        credentialMove,
      }
    case 'custom':
      return {
        profile: {
          id,
          name: 'Custom OpenAI-Compatible',
          credential: { type: 'openai-compat-proxy', baseUrl: '' },
          createdAt: timestamp,
          updatedAt: timestamp,
          _migrationSource: source,
        },
        credentialMove,
      }
  }
}

function buildCodexApiKeyProfile(
  id: string,
  timestamp: string,
  source: MigrationSource,
  credentialMove: CredentialMove | null,
): { profile: MigratedProviderProfile; credentialMove: CredentialMove | null } {
  return {
    profile: {
      id: id as MigratedProviderProfile['id'],
      name: 'OpenAI',
      credential: { type: 'openai-direct' },
      createdAt: timestamp,
      updatedAt: timestamp,
      _migrationSource: source,
    },
    credentialMove,
  }
}

function buildCodexProfileEnrichment(
  mode: ApiProvider,
): ((finalBlob: unknown) => { credential?: import('@shared/providerProfile').ProviderCredential }) | undefined {
  // api_key → no baseUrl backfill needed (adapter uses its default endpoint)
  if (mode === 'api_key' || mode === 'subscription') return undefined
  return (finalBlob) => {
    const blob = finalBlob as { baseUrl?: string }
    const fallback =
      mode === 'openrouter' ? OPENROUTER_OPENAI_BASE_URL : OPENAI_DEFAULT_BASE_URL
    return {
      credential: { type: 'openai-compat-proxy', baseUrl: blob.baseUrl ?? fallback },
    }
  }
}

function buildCodexBlobTransform(mode: ApiProvider): (legacy: unknown) => unknown {
  // The codex adapters stored `{apiKey, baseUrl?}` for openrouter/custom
  // and a bare string for api_key. The new OpenAI adapter expects
  // `{apiKey, baseUrl}`. Normalise here.
  return (blob) => {
    if (typeof blob === 'string') return { apiKey: blob, baseUrl: OPENAI_DEFAULT_BASE_URL }
    const legacy = (blob ?? {}) as { apiKey?: string; baseUrl?: string }
    const defaultBase =
      mode === 'openrouter' ? OPENROUTER_OPENAI_BASE_URL : OPENAI_DEFAULT_BASE_URL
    return {
      apiKey: legacy.apiKey ?? '',
      baseUrl: legacy.baseUrl?.trim() || defaultBase,
    }
  }
}
