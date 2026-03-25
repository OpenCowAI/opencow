// SPDX-License-Identifier: Apache-2.0

import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, FileText, StickyNote } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '../../ui/badge'
import type { SessionPanelTab } from './artifactUtils'

// ─── Tab definitions ─────────────────────────────────────────────────────────

interface TabDef {
  value: SessionPanelTab
  labelKey: 'sessionPanel.chat' | 'sessionPanel.artifacts' | 'sessionPanel.notes'
  icon: LucideIcon
}

/** Static tab definitions — filtered at render time based on counts. */
const ALL_TABS: TabDef[] = [
  { value: 'console', labelKey: 'sessionPanel.chat', icon: MessageSquare },
  { value: 'artifacts', labelKey: 'sessionPanel.artifacts', icon: FileText },
  { value: 'notes', labelKey: 'sessionPanel.notes', icon: StickyNote },
]

// ─── Component ───────────────────────────────────────────────────────────────

interface SessionPanelTabBarProps {
  activeTab: SessionPanelTab
  onTabChange: (tab: SessionPanelTab) => void
  /** Number of .md artifacts in the session (shown as badge on the Artifacts tab) */
  artifactCount: number
  /** Number of notes for the current issue (shown as badge on the Notes tab) */
  noteCount: number
}

/**
 * Horizontal tab bar for switching between Console (message stream),
 * Artifacts (collected .md files) and Notes within the SessionPanel.
 *
 * The Notes tab is always visible (even when noteCount === 0).
 * The Artifacts tab is hidden when artifactCount === 0.
 *
 * Follows the same ARIA tablist pattern used in MainPanel.tsx.
 */
export const SessionPanelTabBar = memo(function SessionPanelTabBar({
  activeTab,
  onTabChange,
  artifactCount,
  noteCount,
}: SessionPanelTabBarProps): React.JSX.Element {
  const { t } = useTranslation('navigation')
  // Notes tab is always visible; Artifacts tab hides when empty
  const visibleTabs = useMemo(
    () => ALL_TABS.filter((tab) => tab.value !== 'artifacts' || artifactCount > 0),
    [artifactCount],
  )

  /** Badge count for a given tab, or 0 to suppress the badge. */
  const badgeFor = (tab: SessionPanelTab): number => {
    if (tab === 'artifacts') return artifactCount
    if (tab === 'notes') return noteCount
    return 0
  }

  return (
    <div
      className="flex items-center gap-0.5"
      role="tablist"
      aria-label={t('sessionPanel.views')}
    >
      {visibleTabs.map((tab) => {
        const Icon = tab.icon
        const isActive = activeTab === tab.value
        const count = badgeFor(tab.value)

        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.value)}
            className={cn(
              'px-2 py-1 text-xs flex items-center gap-1 rounded-md transition-colors',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
              isActive
                ? 'text-[hsl(var(--foreground))] font-medium bg-[hsl(var(--foreground)/0.06)]'
                : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
            )}
          >
            <Icon className="w-3 h-3" aria-hidden="true" />
            {t(tab.labelKey)}
            {count > 0 && (
              <Badge variant="secondary" className="px-1 py-0 text-[10px] leading-3.5 min-w-[1rem] text-center">
                {count}
              </Badge>
            )}
          </button>
        )
      })}
    </div>
  )
})
