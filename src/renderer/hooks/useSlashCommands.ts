// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react'
import { useCapabilitySnapshot } from './useCapabilitySnapshot'
import {
  deduplicateByName,
  getBuiltinSlashCommands,
} from '@shared/slashItems'
import type { SlashItem } from '@shared/slashItems'
import type { CapabilitySnapshot } from '@shared/types'
import { useProjectScope } from '../contexts/ProjectScopeContext'
import {
  capabilityToSlashItem,
  filterActiveEntries,
  sortByPriority,
} from '../lib/capabilityAdapter'

// ── Snapshot → SlashItem[] pipeline ─────────────────────────────────

/**
 * Build the full slash item list from a Capability Center snapshot.
 *
 * Pipeline: filter(active) → sort(priority) → map(toSlashItem) → dedup
 *
 * Deduplication uses first-seen-wins ordering:
 *   builtin > commands (project > global, user > plugin) > skills (same)
 */
function buildSlashItems(snapshot: CapabilitySnapshot | null): SlashItem[] {
  const builtins = getBuiltinSlashCommands()
  if (!snapshot) return builtins

  const commands = sortByPriority(filterActiveEntries(snapshot.commands))
  const skills = sortByPriority(filterActiveEntries(snapshot.skills))

  const commandItems = commands.map((e, i) => capabilityToSlashItem(e, 'command', i))
  const skillItems = skills.map((e, i) => capabilityToSlashItem(e, 'skill', i))

  return deduplicateByName([
    ...builtins,
    ...commandItems,
    ...skillItems,
  ])
}

// ── Hook ────────────────────────────────────────────────────────────

export interface UseSlashCommandsReturn {
  /** All available items (builtins + commands + skills), deduplicated */
  allItems: SlashItem[]
  /** Whether the Capability Center snapshot is loading */
  loading: boolean
}

/**
 * Provides slash command items derived from the Capability Center snapshot.
 *
 * Data flow:
 *   useProjectScope().projectId
 *     → useCapabilitySnapshot(projectId)
 *     → buildSlashItems(snapshot)
 *     → { allItems }
 *
 * Reactive: auto-refreshes on `capabilities:changed` events (skill install,
 * toggle, delete) via the underlying useCapabilitySnapshot subscription.
 *
 * Only enabled + eligible entries appear (disabled / ineligible are filtered).
 */
export function useSlashCommands(): UseSlashCommandsReturn {
  const { projectId } = useProjectScope()
  const { snapshot, loading } = useCapabilitySnapshot(projectId)

  const allItems = useMemo(() => buildSlashItems(snapshot), [snapshot])

  return { allItems, loading }
}
