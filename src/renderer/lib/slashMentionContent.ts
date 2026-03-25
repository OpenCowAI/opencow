// SPDX-License-Identifier: Apache-2.0

import type { JSONContent } from '@tiptap/core'
import type { SlashItem, SlashItemCategory } from '@shared/slashItems'
import type { SlashCommandExecutionContract } from '@shared/types'
import {
  compactSlashExecutionContract,
  deriveSlashExecutionContractFromItemExecutionMeta,
} from '@shared/slashExecution'

export interface SlashMentionAttrs {
  /** Stable execution identifier (used by resolver/dispatcher). */
  name: string
  /** Slash mention category used by resolver policy. */
  category: SlashItemCategory
  /** Optional source path for command/skill expansion. */
  sourcePath?: string
  /** Optional UI label; when present, mention chip renders this text. */
  label?: string
  /** Structured execution contract for runtime policy planning. */
  executionContract?: SlashCommandExecutionContract
}

function resolveSlashMentionLabel(item: SlashItem): string | undefined {
  const raw = item.presentation?.title
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed || undefined
}

/**
 * Build structured slash mention attrs from a slash item.
 *
 * Keeps execution identity (`name/category/sourcePath`) stable, while allowing
 * display text to diverge via `label` for richer UX (e.g. app display names).
 */
export function buildSlashMentionAttrs(item: SlashItem): SlashMentionAttrs {
  const label = resolveSlashMentionLabel(item)
  const executionContract = compactSlashExecutionContract(
    deriveSlashExecutionContractFromItemExecutionMeta(item.executionMeta),
  )
  return {
    name: item.name,
    category: item.category,
    sourcePath: item.sourcePath,
    ...(label ? { label } : {}),
    ...(executionContract ? { executionContract } : {}),
  }
}

/**
 * Build insertion payload for a slash mention node followed by one separator
 * space, so all insertion call-sites share the same attrs contract.
 */
export function buildSlashMentionInsertContent(item: SlashItem): JSONContent[] {
  return [
    {
      type: 'slashMention',
      attrs: buildSlashMentionAttrs(item),
    },
    { type: 'text', text: ' ' },
  ]
}
