// SPDX-License-Identifier: Apache-2.0

/**
 * Side-effecting migration applier.
 *
 * Safe-ordering invariants:
 *   1. Move credentials into profile-scoped slots first. If this fails
 *      mid-flight, the partial moves are visible on next boot as
 *      profile slots that happen to be populated; the planner detects
 *      unchanged legacy keys and re-runs for the remaining entries.
 *   2. Persist the new settings.json shape with schemaVersion: 1 once
 *      all credentials are moved. This flips the state machine.
 *   3. Best-effort cleanup of legacy keys and the codex file. Failure
 *      here leaves orphaned data but does not corrupt the migrated
 *      state.
 */

import { unlink } from 'fs/promises'
import { createLogger } from '../../../platform/logger'
import type { AppSettings } from '@shared/types'
import type { MigrationDeps, MigrationPlan } from './types'

const log = createLogger('ProviderMigration')

export async function applyProviderMigration(
  deps: MigrationDeps,
  plan: MigrationPlan,
): Promise<void> {
  if (plan.reason !== 'upgrade') {
    // No-op plans still persist the target settings when a fresh
    // install is detected — writes schemaVersion: 1 so subsequent boots
    // skip detection entirely.
    if (plan.reason === 'fresh-install') {
      await persistSettings(deps, plan)
    }
    return
  }

  // Work on a mutable copy of the plan's profiles so enrichProfile
  // callbacks can patch each profile's non-sensitive credential config
  // based on the final stored blob.
  const enrichedProfiles = [...plan.targetSettings.profiles]

  // ── Step 1: move credentials into profile-scoped slots ────────────
  for (const move of plan.credentialMoves) {
    const sourceStore =
      move.source === 'codex'
        ? deps.legacyCodexCredentialStore
        : deps.mainCredentialStore
    if (!sourceStore) {
      log.warn(
        `Skipping credential move (${move.source} store not mounted): ${move.fromKey} → ${move.toKey}`,
      )
      continue
    }

    const targetStore = deps.mainCredentialStore

    // Idempotency: if the target slot is already populated (prior
    // interrupted migration), don't overwrite.
    const alreadyThere = await targetStore.getAs<unknown>(move.toKey)
    if (alreadyThere !== undefined) {
      log.info(`Credential move skipped — target already populated: ${move.toKey}`)
      continue
    }

    const legacyBlob = await sourceStore.getAs<unknown>(move.fromKey)
    if (legacyBlob === undefined) {
      // The legacy key vanished — either never existed or deleted by a
      // previous interrupted run that got to the cleanup phase.
      continue
    }

    const finalBlob = move.transform ? move.transform(legacyBlob) : legacyBlob
    await targetStore.updateAs(move.toKey, finalBlob)
    log.info(`Credential moved: ${move.source}:${move.fromKey} → ${move.toKey}`)

    // Patch profile.credential from the final blob if an enrichment was
    // declared. Mutates the local copy; persisted in Step 2 below.
    if (move.enrichProfile) {
      const patch = move.enrichProfile(finalBlob)
      if (patch.credential) {
        const idx = enrichedProfiles.findIndex((p) => p.id === move.profileId)
        if (idx >= 0) {
          enrichedProfiles[idx] = { ...enrichedProfiles[idx], credential: patch.credential }
        }
      }
    }
  }

  // ── Step 2: persist new settings shape (with enriched profiles) ──
  await persistSettings(deps, {
    ...plan,
    targetSettings: { ...plan.targetSettings, profiles: enrichedProfiles },
  })

  // ── Step 3: cleanup (best-effort) ─────────────────────────────────
  for (const key of plan.legacyKeysToDelete) {
    try {
      await deps.mainCredentialStore.removeAt(key)
    } catch (err) {
      log.warn(`Legacy credential key cleanup failed for "${key}"`, err)
    }
  }

  if (plan.deleteLegacyCodexFile) {
    try {
      await unlink(deps.legacyCodexCredentialsPath)
      log.info(`Legacy codex credentials file unlinked: ${deps.legacyCodexCredentialsPath}`)
    } catch (err) {
      // ENOENT means the file was already removed by an earlier run.
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        log.warn('Legacy codex credentials file unlink failed', err)
      }
    }
  }
}

async function persistSettings(deps: MigrationDeps, plan: MigrationPlan): Promise<void> {
  const current = await deps.settingsService.load()
  const next: AppSettings = {
    ...current,
    provider: plan.targetSettings,
  }
  await deps.settingsService.update(next)
}
