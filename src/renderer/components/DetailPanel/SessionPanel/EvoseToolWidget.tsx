// SPDX-License-Identifier: Apache-2.0

/**
 * EvoseToolWidget — Widget Tool adapter for Evose agent/workflow tools.
 *
 * Bridges the WidgetToolProps interface to EvoseProgressCard, providing a
 * single unified card that replaces the standard tool-call pill row.
 *
 * App metadata (display name, avatar) is resolved from the Evose app config
 * stored in settings, matching the same pattern used by ToolUseBlockView.
 */

import type { EvoseAppConfig, EvoseProgressBlock } from '@shared/types'
import { resolveEvoseAppInfo } from '@shared/evoseNames'
import { useSettingsStore } from '@/stores/settingsStore'
import { EvoseProgressCard } from './EvoseProgressCard'
import type { WidgetToolProps } from './WidgetToolRegistry'

// ── Stable fallback references ──────────────────────────────────────────────
// Module-level constants ensure reference stability for Zustand selectors and
// React props.  Inline `?? []` creates a new array on every call/render,
// which triggers infinite re-renders via useSyncExternalStore or causes
// unnecessary child re-renders via changed prop references.
const EMPTY_EVOSE_APPS: readonly EvoseAppConfig[] = []
const EMPTY_PROGRESS_BLOCKS: EvoseProgressBlock[] = []

export function EvoseToolWidget({ block, isExecuting }: WidgetToolProps): React.JSX.Element {
  const evoseApps = useSettingsStore((s) => s.settings?.evose?.apps ?? EMPTY_EVOSE_APPS)
  const evoseInfo = resolveEvoseAppInfo(block.name, evoseApps, block.input)
  const appName = evoseInfo?.displayName ?? block.name

  return (
    <EvoseProgressCard
      blocks={block.progressBlocks ?? EMPTY_PROGRESS_BLOCKS}
      isStreaming={isExecuting}
      appName={appName}
      appAvatar={evoseInfo?.avatar}
    />
  )
}
