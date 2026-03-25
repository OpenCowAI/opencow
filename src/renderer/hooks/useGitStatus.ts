// SPDX-License-Identifier: Apache-2.0

/**
 * useGitStatus — initialise git status for the active project.
 *
 * Responsibility:
 *   1. On project select, request initial GitRepositorySnapshot via IPC.
 *   2. Subsequent updates arrive automatically via DataBus (handled by useAppBootstrap).
 *
 * This hook only handles the "cold start" — DataBus handles the "hot path".
 *
 * @module useGitStatus
 */

import { useEffect } from 'react'
import { useGitStore } from '@/stores/gitStore'
import { getAppAPI } from '@/windowAPI'
import type { GitRepositorySnapshot } from '@shared/gitTypes'

/**
 * Initialise git status for a project.
 *
 * Call this once per FilesView mount / project switch. The initial IPC call
 * also activates the main-process GitService watcher for this project.
 */
export function useGitStatus(projectPath: string | undefined): void {
  const setGitStatus = useGitStore((s) => s.setGitStatus)

  useEffect(() => {
    if (!projectPath) return

    let cancelled = false

    async function init(): Promise<void> {
      try {
        const snapshot = await getAppAPI()['git:get-status'](projectPath!)
        if (!cancelled && snapshot) {
          setGitStatus(projectPath!, snapshot)
        }
      } catch {
        // Git unavailable — silent degradation, no broken UI
      }
    }

    init()
    return () => { cancelled = true }
  }, [projectPath, setGitStatus])
}

/**
 * Zustand selector: get git snapshot for a specific project.
 *
 * Usage: `const snapshot = useGitStore(s => selectGitSnapshot(s, projectPath))`
 */
export function selectGitSnapshot(
  store: { gitSnapshots: Record<string, GitRepositorySnapshot> },
  projectPath: string | undefined,
): GitRepositorySnapshot | undefined {
  if (!projectPath) return undefined
  return store.gitSnapshots[projectPath]
}
