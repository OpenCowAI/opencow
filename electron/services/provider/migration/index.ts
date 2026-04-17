// SPDX-License-Identifier: Apache-2.0

/**
 * Single entry point for provider settings migration.
 *
 * Called once at app bootstrap, before any consumer reads the provider
 * state. Detect → plan → apply → mark-complete — all in one function.
 *
 * The caller provides a `MigrationDeps` bag with:
 *   - settingsService    (read/write settings.json)
 *   - mainCredentialStore  (the authoritative credentials file)
 *   - legacyCodexCredentialStore (optional — mounted when the pre-A
 *                                  codex file still exists)
 *   - legacyCodexCredentialsPath (for the final unlink)
 *
 * Idempotent: re-running on already-migrated settings short-circuits
 * inside the planner.
 */

import { createLogger } from '../../../platform/logger'
import { planProviderMigration } from './plan'
import { applyProviderMigration } from './apply'
import type { MigrationDeps } from './types'
export type { MigrationDeps } from './types'
export { PROVIDER_SCHEMA_VERSION } from './types'

const log = createLogger('ProviderMigration')

export async function runProviderMigration(deps: MigrationDeps): Promise<void> {
  const currentSettings = await deps.settingsService.load()
  const plan = planProviderMigration({
    rawProvider: currentSettings.provider,
    legacyCodexFilePresent: deps.legacyCodexCredentialStore !== null,
  })

  if (plan.reason === 'already-migrated') {
    return
  }

  log.info(`Provider migration: ${plan.reason}`, {
    profiles: plan.targetSettings.profiles.length,
    credentialMoves: plan.credentialMoves.length,
    deleteLegacyCodexFile: plan.deleteLegacyCodexFile,
  })

  await applyProviderMigration(deps, plan)
}
