// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect } from 'react'
import { Monitor, Globe, MessageSquare, Bot, Bell, Webhook, Shield, X, Blocks, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '@/components/ui/Dialog'
import { useSettingsStore, type SettingsTab } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import { GeneralSection } from './GeneralSection'
import { ProviderSection } from './ProviderSection'
import { NetworkSection } from './NetworkSection'
import { CommandSection } from './CommandSection'
import { NotifySection } from './NotifySection'
import { WebhooksSection } from './WebhooksSection'
import { MessagingSection } from './MessagingSection'
import { EvoseSection } from './EvoseSection'
import { UpdateSection } from './UpdateSection'

interface TabItem {
  id: SettingsTab
  labelKey: string
  icon: React.ReactNode
}

interface TabGroup {
  labelKey: string
  tabs: TabItem[]
}

const TAB_GROUPS: TabGroup[] = [
  {
    labelKey: 'groups.app',
    tabs: [
      { id: 'general', labelKey: 'tabs.general', icon: <Monitor className="h-4 w-4" aria-hidden="true" /> },
      { id: 'network', labelKey: 'tabs.network', icon: <Globe className="h-4 w-4" aria-hidden="true" /> },
      { id: 'updates', labelKey: 'tabs.updates', icon: <RefreshCw className="h-4 w-4" aria-hidden="true" /> },
    ],
  },
  {
    labelKey: 'groups.model',
    tabs: [
      { id: 'provider', labelKey: 'tabs.provider', icon: <Shield className="h-4 w-4" aria-hidden="true" /> },
      { id: 'command', labelKey: 'tabs.chat', icon: <MessageSquare className="h-4 w-4" aria-hidden="true" /> },
    ],
  },
  {
    labelKey: 'groups.integrations',
    tabs: [
      { id: 'messaging', labelKey: 'tabs.messaging', icon: <Bot className="h-4 w-4" aria-hidden="true" /> },
      { id: 'evose', labelKey: 'tabs.evose', icon: <Blocks className="h-4 w-4" aria-hidden="true" /> },
    ],
  },
  {
    labelKey: 'groups.trigger',
    tabs: [
      { id: 'notifications', labelKey: 'tabs.notifications', icon: <Bell className="h-4 w-4" aria-hidden="true" /> },
      { id: 'webhooks', labelKey: 'tabs.webhooks', icon: <Webhook className="h-4 w-4" aria-hidden="true" /> },
    ],
  },
]

export function SettingsModal(): React.JSX.Element | null {
  const { t } = useTranslation('settings')
  const open = useSettingsStore((s) => s.settingsModalOpen)
  const initialTab = useSettingsStore((s) => s.settingsModalTab)
  const close = useSettingsStore((s) => s.closeSettingsModal)
  const settings = useSettingsStore((s) => s.settings)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  // Sync activeTab when modal opens – reset to 'general' unless a specific tab is requested
  useEffect(() => {
    if (open) setActiveTab(initialTab ?? 'general')
  }, [open, initialTab])

  return (
    <Dialog open={open} onClose={close} title={t('title')} size="4xl" className="flex flex-col h-[70vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))]">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <button
          onClick={close}
          className="p-1 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
          aria-label={t('closeAria')}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {!settings ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{t('loadingSettings')}</p>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Tab navigation */}
          <nav className="w-48 shrink-0 border-r border-[hsl(var(--border))] p-3 space-y-3" aria-label="Settings tabs" role="tablist">
            {TAB_GROUPS.map((group) => (
              <div key={group.labelKey} className="space-y-0.5">
                <div className="px-3 pt-0.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.5)]">
                  {t(group.labelKey)}
                </div>
                {group.tabs.map((tab) => (
                  <button
                    key={tab.id}
                    id={`settings-tab-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'w-full flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                      activeTab === tab.id
                        ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--accent-foreground))] font-medium'
                        : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))]'
                    )}
                    aria-selected={activeTab === tab.id}
                    aria-controls="settings-tabpanel"
                    role="tab"
                  >
                    {tab.icon}
                    {t(tab.labelKey)}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          {/* Tab content */}
          <div
            id="settings-tabpanel"
            className="flex-1 overflow-y-auto overscroll-contain p-5"
            role="tabpanel"
            aria-labelledby={`settings-tab-${activeTab}`}
          >
            {activeTab === 'general' && <GeneralSection />}
            {activeTab === 'provider' && <ProviderSection />}
            {activeTab === 'network' && <NetworkSection />}
            {activeTab === 'command' && <CommandSection />}
            {activeTab === 'notifications' && <NotifySection />}
            {activeTab === 'webhooks' && <WebhooksSection />}
            {activeTab === 'messaging' && <MessagingSection />}
            {activeTab === 'evose' && <EvoseSection />}
            {activeTab === 'updates' && <UpdateSection />}
          </div>
        </div>
      )}
    </Dialog>
  )
}
