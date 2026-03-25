// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useRef } from 'react'
import { getAppAPI } from '@/windowAPI'

// ─── Types ────────────────────────────────────────────────────────

/** Parameters identifying which package to uninstall */
export interface PackageUninstallTarget {
  prefix: string
  scope: 'global' | 'project'
  projectId?: string
}

export interface UsePackageUninstallResult {
  /** Whether an uninstall request is in-flight */
  uninstalling: boolean
  /** Error message from the most recent failed uninstall, or null */
  error: string | null
  /** The target currently awaiting confirmation, or null when dialog is closed */
  pendingTarget: PackageUninstallTarget | null
  /** Open the confirm dialog for a specific package */
  requestUninstall: (target: PackageUninstallTarget) => void
  /** Cancel / close the confirm dialog */
  cancel: () => void
  /** Execute the uninstall — called from the confirm dialog's action button */
  confirm: () => Promise<void>
}

// ─── Hook ─────────────────────────────────────────────────────────

/**
 * Shared package uninstall logic — manages confirm dialog lifecycle, IPC call, and error state.
 *
 * Imperative design: the caller triggers `requestUninstall(target)` at click time,
 * which opens the confirm dialog and stores the target. `confirm()` executes the IPC
 * against the stored target. This mirrors `useMarketInstall.install(params)` — the
 * action receives its parameters when invoked, not when the hook is instantiated.
 *
 * Dialog visibility is derived from `pendingTarget !== null` — a single source of truth
 * with no possibility of desync between "dialog open" and "which package".
 *
 * Used by:
 * - InlineCapabilityDetail (capability detail → uninstall mounted package)
 * - CapabilityDetailView (side panel → uninstall mounted package)
 * - SkillDetailPanel (marketplace detail → uninstall installed package)
 *
 * @param onSuccess  Called after successful uninstall (e.g., navigate back, close panel).
 */
export function usePackageUninstall(
  onSuccess?: () => void,
): UsePackageUninstallResult {
  const [uninstalling, setUninstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingTarget, setPendingTarget] = useState<PackageUninstallTarget | null>(null)

  // Refs for async access — `confirm` is stable (zero deps) and reads latest values via refs
  const pendingTargetRef = useRef(pendingTarget)
  pendingTargetRef.current = pendingTarget
  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess

  const requestUninstall = useCallback((target: PackageUninstallTarget) => {
    setError(null)
    setPendingTarget(target)
  }, [])

  const cancel = useCallback(() => {
    setPendingTarget(null)
    setError(null)
  }, [])

  const confirm = useCallback(async () => {
    const t = pendingTargetRef.current
    if (!t) return
    setUninstalling(true)
    setError(null)
    try {
      await getAppAPI()['package:uninstall']({
        prefix: t.prefix,
        scope: t.scope,
        projectId: t.projectId,
      })
      setPendingTarget(null)
      onSuccessRef.current?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to uninstall package')
    } finally {
      setUninstalling(false)
    }
  }, [])

  return { uninstalling, error, pendingTarget, requestUninstall, cancel, confirm }
}
