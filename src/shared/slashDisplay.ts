// SPDX-License-Identifier: Apache-2.0

import type { SlashCommandBlock } from './types'

type SlashDisplayShape = Pick<SlashCommandBlock, 'name' | 'label'>

/**
 * Resolve user-facing slash label from frozen message block data.
 * Falls back to canonical name for defensive rendering of legacy records.
 */
export function getSlashDisplayLabel(block: SlashDisplayShape): string {
  const label = typeof block.label === 'string' ? block.label.trim() : ''
  return label || block.name
}

/** Format one slash command as "/<display-label>". */
export function formatSlashDisplay(block: SlashDisplayShape): string {
  return `/${getSlashDisplayLabel(block)}`
}

/** Join slash commands into a single preview string. */
export function joinSlashDisplays(blocks: SlashDisplayShape[]): string {
  return blocks.map(formatSlashDisplay).join(' ')
}
