// SPDX-License-Identifier: Apache-2.0

/**
 * Provider settings migration — shared types.
 *
 * The migration runs once at bootstrap. Its job is to transform any
 * pre-Phase-B settings shape (including the Phase A flat `activeMode`
 * shape, the pre-A `byEngine.{claude,codex}` shape, or a missing file)
 * into the current v1 shape with:
 *
 *   - `provider.schemaVersion: 1`
 *   - `provider.profiles[]`     — one entry per configured provider
 *   - `provider.defaultProfileId` or null
 *   - all credentials under `credential:${profileId}` keys in the main store
 *
 * Legacy flat keys and the separate `credentials-codex.enc` file are
 * deleted after a successful migration. The migration is designed to
 * be re-runnable (idempotent) in case of partial completion.
 */

import type { CredentialStore } from '../credentialStore'
import type { ProviderSettings } from '@shared/types'
import type { ProviderProfile } from '@shared/providerProfile'
import type { SettingsService } from '../../settingsService'

export const PROVIDER_SCHEMA_VERSION = 1 as const
export type ProviderSchemaVersion = typeof PROVIDER_SCHEMA_VERSION

/**
 * Immutable dependency set for the migration. All disk / store mutations
 * go through these — keeping the logic testable with in-memory fakes.
 */
export interface MigrationDeps {
  /**
   * Primary source of the user's settings.json. Read via
   * `settingsService.load()` (tolerates legacy shapes) and written via
   * `settingsService.update()` (persists current shape).
   */
  readonly settingsService: SettingsService
  /** The main encrypted credential file (Claude pre-Phase-B + all post-B profiles). */
  readonly mainCredentialStore: CredentialStore
  /**
   * Read-only view of `credentials-codex.enc` when it exists on disk.
   * Absent for fresh installs and for users who never configured Codex
   * on OpenCow <= 0.3.21.
   */
  readonly legacyCodexCredentialStore: CredentialStore | null
  /**
   * Absolute path to the legacy codex credentials file — needed for the
   * final `unlink` step after a successful migration. Provided
   * alongside the store so a partial migration that failed before
   * delete can be retried without re-probing the filesystem.
   */
  readonly legacyCodexCredentialsPath: string
}

/**
 * A single credential to relocate during migration. All `from*` paths
 * are populated by the planner based on detected legacy shape; the
 * applier performs the move atomically per entry.
 */
export interface CredentialMove {
  readonly source: 'main' | 'codex'
  readonly fromKey: string
  readonly toKey: string
  /** Transforms the stored blob shape (e.g. OpenRouter → `{apiKey, baseUrl, authStyle}`). */
  readonly transform?: (legacyBlob: unknown) => unknown
  /**
   * Once the blob is moved, derive non-sensitive profile fields from
   * the final stored shape. Lets the planner stay pure (no
   * CredentialStore access) while still back-filling the profile's
   * `baseUrl` / `authStyle` with real values seen on disk.
   */
  readonly enrichProfile?: (
    finalBlob: unknown,
  ) => { credential?: import('@shared/providerProfile').ProviderCredential }
  /** Profile id that this move feeds; used by apply() to run the enrichment patch. */
  readonly profileId: import('@shared/providerProfile').ProviderProfileId
}

export interface MigrationPlan {
  /** Target settings shape after migration. Always includes schemaVersion. */
  readonly targetSettings: ProviderSettings
  readonly credentialMoves: ReadonlyArray<CredentialMove>
  /**
   * Legacy keys to delete from the main credential store AFTER moves
   * complete and settings.json is written. Best-effort — failure here
   * leaves orphaned data but doesn't corrupt the migrated state.
   */
  readonly legacyKeysToDelete: ReadonlyArray<string>
  /** Whether the `credentials-codex.enc` file should be unlinked. */
  readonly deleteLegacyCodexFile: boolean
  /**
   * `null` when the migration is a no-op (already-migrated settings or
   * fresh install). Callers can short-circuit before calling `apply()`.
   */
  readonly reason: 'fresh-install' | 'already-migrated' | 'upgrade'
}

/**
 * Profile provenance — stamped on every migrated profile so the apply
 * phase can dispatch CredentialStore reads to the correct source. Also
 * used by the UI (future enhancement) to surface a "migrated from X"
 * label without leaking semantics into the profile id.
 */
export interface MigrationSource {
  readonly engine: 'claude' | 'codex'
  readonly legacyMode: 'subscription' | 'api_key' | 'openrouter' | 'custom'
}

/**
 * Extension to ProviderProfile carrying migration provenance. Stored
 * alongside the profile in settings.json; future versions may drop it
 * once all users have migrated past a certain schemaVersion.
 */
export type MigratedProviderProfile = ProviderProfile & {
  readonly _migrationSource: MigrationSource
}
