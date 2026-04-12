// SPDX-License-Identifier: Apache-2.0

/**
 * Provider Profile — user-owned LLM account descriptor.
 *
 * Post Phase B.7 cutover data model. Historical migration logic (pre-A
 * byEngine shapes, Phase A flat shape, B preview shapes) now lives in
 * `electron/services/provider/migration/` — settings on disk are
 * always `schemaVersion: 1` post-bootstrap.
 *
 * Design invariants:
 *   1. Profile objects are **non-sensitive** and live in settings.json.
 *      All secrets live in CredentialStore under `credential:${id}`.
 *   2. `ProviderType` enumerates all 8 protocol types up-front.
 *      Implementation status is gated by `isProviderTypeImplemented`.
 *   3. `ProviderProfileId` is a branded string — prevents accidental
 *      mixing with session / project / any other id type.
 */

// ─── Brand ────────────────────────────────────────────────────────────

export type ProviderProfileId = string & { readonly __brand: 'ProviderProfileId' }

export function asProviderProfileId(raw: string): ProviderProfileId {
  return raw as ProviderProfileId
}

// ─── Type registry ────────────────────────────────────────────────────

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
 * Types wired end-to-end in the current OpenCow build. Bedrock / Vertex
 * depend on AWS / GCP SDK integration — a separate ticket.
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
  /**
   * Optional migration provenance stamped by the bootstrap migration
   * runner. Present on profiles derived from pre-v1 settings shapes;
   * absent on profiles created via the Settings UI.
   */
  _migrationSource?: {
    engine: 'claude' | 'codex'
    legacyMode: 'subscription' | 'api_key' | 'openrouter' | 'custom'
  }
}

// ─── Id generation ────────────────────────────────────────────────────

/**
 * Generate a stable, URL-safe profile id. Format: `prof_${10-char alphanumeric}`.
 * Not cryptographic — collision risk at realistic profile counts (<100)
 * is negligible.
 */
export function generateProviderProfileId(): ProviderProfileId {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let suffix = ''
  for (let i = 0; i < 10; i++) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return `prof_${suffix}` as ProviderProfileId
}

/** CredentialStore key where secrets for a profile live. */
export function credentialKeyFor(id: ProviderProfileId): string {
  return `credential:${id}`
}

// ─── IPC payloads ─────────────────────────────────────────────────────

export interface CreateProviderProfileInput {
  name: string
  credential: ProviderCredential
  preferredModel?: string
  /** Adapter-specific authentication parameters (apiKey, baseUrl, etc.). */
  authParams?: Record<string, unknown>
  setAsDefault?: boolean
}

export interface UpdateProviderProfilePatch {
  name?: string
  preferredModel?: string | null
  credentialConfig?: Partial<Omit<ProviderCredential, 'type'>>
  authParams?: Record<string, unknown>
}

export type ProviderTestOutcome =
  | { ok: true; detail?: string }
  | { ok: false; reason: 'unauthenticated' | 'network' | 'unsupported' | 'error'; message: string }

export interface ProviderTestResult {
  profileId: ProviderProfileId
  outcome: ProviderTestOutcome
  durationMs: number
}

// ─── Shared credential info (non-sensitive fields for form pre-fill) ─

export interface ProviderCredentialInfo {
  apiKey?: string
  baseUrl?: string
  authStyle?: 'api_key' | 'bearer'
}
