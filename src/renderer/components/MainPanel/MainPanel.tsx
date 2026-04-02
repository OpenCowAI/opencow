// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore, selectMainTab } from '@/stores/appStore'
import { DashboardView } from '@/components/DashboardView/DashboardView'
import { IssuesView } from '@/components/IssuesView/IssuesView'
import { ChatView } from '@/components/ChatView/ChatView'
import { CapabilitiesView } from '@/components/ChatView/CapabilitiesView'
import { StarredArtifactsView } from '@/components/StarredArtifactsView/StarredArtifactsView'
import { ScheduleView } from '@/components/ScheduleView/ScheduleView'
import { MemoryView } from '@/components/MemoryView/MemoryView'
import { KeepAliveTab } from '@/components/ui/KeepAliveTab'
import { PillDropdown } from '@/components/ui/PillDropdown'
import { ProviderBanner } from './ProviderBanner'
import { getChatInputFocus } from '@/lib/chatInputRegistry'
import type { MainTab } from '@shared/types'
import { cn } from '@/lib/utils'
import { CircleDot, MessageSquare, LayoutDashboard, Star, EllipsisVertical, Blocks, Brain, CalendarClock } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// Core tabs — Files has been moved into ChatView's view mode toggle
type MainTabLabelKey = 'mainTabs.issues' | 'mainTabs.chat' | 'mainTabs.schedule'
const tabs: { value: MainTab; labelKey: MainTabLabelKey; icon: typeof CircleDot }[] = [
  { value: 'issues', labelKey: 'mainTabs.issues', icon: CircleDot },
  { value: 'chat', labelKey: 'mainTabs.chat', icon: MessageSquare },
  { value: 'schedule', labelKey: 'mainTabs.schedule', icon: CalendarClock },
]

// === More Menu Item (extracted to avoid repetition) ===

interface MoreMenuItemProps {
  icon: LucideIcon
  label: string
  tab: MainTab
  activeTab: MainTab
  onSelect: (tab: MainTab) => void
}

function MoreMenuItem({ icon: Icon, label, tab, activeTab, onSelect }: MoreMenuItemProps): React.JSX.Element {
  return (
    <button
      role="menuitem"
      onClick={() => onSelect(tab)}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left',
        activeTab === tab
          ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--accent-foreground))] font-medium'
          : 'hover:bg-[hsl(var(--foreground)/0.04)]'
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label}
    </button>
  )
}

// === More Popover (Dashboard + Starred entries) ===

function MorePopover(): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const [open, setOpen] = useState(false)
  const activeTab = useAppStore(selectMainTab)
  const setActiveTab = useAppStore((s) => s.setMainTab)

  const handleOpenChange = useCallback((v: boolean) => setOpen(v), [])

  const handleSelect = useCallback((tab: MainTab) => {
    setActiveTab(tab)
    setOpen(false)
  }, [setActiveTab])

  // Highlight trigger when any More-menu tab is active
  const isMoreTabActive = activeTab === 'dashboard' || activeTab === 'starred' || activeTab === 'capabilities' || activeTab === 'memories'

  return (
    <PillDropdown
      open={open}
      onOpenChange={handleOpenChange}
      position="below"
      align="left"
      trigger={
        <button
          onClick={() => setOpen((prev) => !prev)}
          aria-label={t('moreOptions', { ns: 'common' })}
          aria-expanded={open}
          aria-haspopup="menu"
          className={cn(
            'no-drag p-1.5 rounded-md transition-colors',
            open || isMoreTabActive
              ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground))]'
              : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]'
          )}
        >
          <EllipsisVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      }
    >
      <MoreMenuItem icon={LayoutDashboard} label={t('mainTabs.dashboard')} tab="dashboard" activeTab={activeTab} onSelect={handleSelect} />
      <MoreMenuItem icon={Star} label={t('mainTabs.starredArtifacts')} tab="starred" activeTab={activeTab} onSelect={handleSelect} />
      <div className="my-1 h-px bg-[hsl(var(--border))]" role="separator" />
      <MoreMenuItem icon={Blocks} label={t('mainTabs.capabilities')} tab="capabilities" activeTab={activeTab} onSelect={handleSelect} />
      <MoreMenuItem icon={Brain} label={t('mainTabs.memories')} tab="memories" activeTab={activeTab} onSelect={handleSelect} />
    </PillDropdown>
  )
}

// === Main Tab Bar ===

function MainPanelTabs(): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const activeTab = useAppStore(selectMainTab)
  const setActiveTab = useAppStore((s) => s.setMainTab)

  return (
    <div
      className="drag-region border-b border-[hsl(var(--border)/0.5)] px-2 flex gap-1 items-center py-2"
      role="tablist"
      aria-label={t('mainPanelViews')}
    >
      {/* Tab buttons */}
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={activeTab === tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={cn(
              'no-drag px-3 py-1.5 text-sm flex items-center gap-1.5 rounded-full transition-colors',
              'hover:bg-[hsl(var(--foreground)/0.06)]',
              activeTab === tab.value
                ? 'text-[hsl(var(--foreground))] font-medium'
                : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {t(tab.labelKey)}
          </button>
        )
      })}

      {/* More popover (right after Agent tab) */}
      <MorePopover />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// MainPanel
//
// Uses KeepAliveTab for ALL views so that component-local state
// (scroll positions, input drafts, sidebar expansion, etc.) is
// preserved across tab switches. Tabs are lazily mounted on first
// visit and then kept alive via CSS `display: none`.
//
// IMPORTANT: No early returns! All KeepAliveTab wrappers must
// render in every code path, otherwise switching to Schedule would
// unmount the project tabs and destroy their preserved state.
//
// Schedule is rendered as a first-class tab via KeepAliveTab.
// ════════════════════════════════════════════════════════════════════

export function MainPanel(): React.JSX.Element {
  const activeTab = useAppStore(selectMainTab)
  const previousTabRef = useRef<MainTab>(activeTab)

  useEffect(() => {
    const previousTab = previousTabRef.current
    previousTabRef.current = activeTab

    if (!(previousTab === 'issues' && activeTab === 'chat')) return

    let attempts = 0
    const maxAttempts = 8
    let rafId: number | null = null
    let cancelled = false

    const tryFocus = (): void => {
      if (cancelled) return

      const callbacks = getChatInputFocus()
      if (callbacks) {
        callbacks.focus()
        return
      }

      if (attempts >= maxAttempts) return
      attempts += 1
      rafId = requestAnimationFrame(tryFocus)
    }

    rafId = requestAnimationFrame(tryFocus)
    return () => {
      cancelled = true
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [activeTab])

  return (
    <div className="h-full flex flex-col min-w-0 overflow-hidden">
      <MainPanelTabs />

      {/* Provider not configured reminder */}
      <ProviderBanner />

      <KeepAliveTab active={activeTab === 'schedule'}>
        <ScheduleView />
      </KeepAliveTab>
      <KeepAliveTab active={activeTab === 'dashboard'}>
        <DashboardView />
      </KeepAliveTab>
      <KeepAliveTab active={activeTab === 'issues'}>
        <IssuesView />
      </KeepAliveTab>
      <KeepAliveTab active={activeTab === 'chat'}>
        <ChatView />
      </KeepAliveTab>
      <KeepAliveTab active={activeTab === 'starred'}>
        <StarredArtifactsView />
      </KeepAliveTab>
      <KeepAliveTab active={activeTab === 'capabilities'}>
        <CapabilitiesView />
      </KeepAliveTab>
      <KeepAliveTab active={activeTab === 'memories'}>
        <MemoryView />
      </KeepAliveTab>
    </div>
  )
}
