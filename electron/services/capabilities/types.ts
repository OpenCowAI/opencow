// SPDX-License-Identifier: Apache-2.0

import type { CapabilityCategory, CapabilityTypeMap, ScopedList } from '@shared/types'
import type { ResolvedPlugin } from './pluginResolver'

export { type ClaudeCodePaths } from './paths'

export interface ScanContext {
  paths: import('./paths').ClaudeCodePaths
  /** Plugins that are installed AND enabled AND not blocked */
  activePlugins: ResolvedPlugin[]
  /** All installed plugins (including disabled/blocked — for pluginScanner UI display) */
  allPlugins: ResolvedPlugin[]
}

/** Every scanner implements this interface — one scanner per capability category */
export interface CapabilityScanner<K extends CapabilityCategory> {
  category: K
  scan(ctx: ScanContext): Promise<ScopedList<CapabilityTypeMap[K]>>
}
