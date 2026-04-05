// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { resolveModalExitDurationMs } from '@/hooks/useModalAnimation'
import { useIssueProviderStore } from '@/stores/issueProviderStore'
import { cn } from '@/lib/utils'
import { ProjectGeneralSettingsPanel } from './ProjectGeneralSettingsPanel'
import { ProjectBrowserSettingsPanel } from './ProjectBrowserSettingsPanel'
import { IssueIntegrationPanel } from './IssueIntegrationPanel'

interface ProjectSettingsModalProps {
  projectId: string
  onClose: () => void
}

export function ProjectSettingsModal({ projectId, onClose }: ProjectSettingsModalProps): React.JSX.Element {
  const { t } = useTranslation('projectSettings')
  const loadProviders = useIssueProviderStore((s) => s.loadProviders)
  const [activeTab, setActiveTab] = useState<'general' | 'browser' | 'issueIntegration'>('general')

  // Two-phase close: play exit animation before unmounting
  const [open, setOpen] = useState(true)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  const requestClose = useCallback(() => {
    setOpen(false)
    setTimeout(() => onCloseRef.current(), resolveModalExitDurationMs())
  }, [])

  useEffect(() => {
    loadProviders(projectId)
  }, [projectId, loadProviders])

  return (
    <Dialog open={open} onClose={requestClose} title={t('title')} size="4xl" className="flex flex-col h-[72vh]">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))]">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <button
          onClick={requestClose}
          className="p-1 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
          aria-label={t('closeAria')}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        <nav className="w-52 shrink-0 border-r border-[hsl(var(--border))] p-3 space-y-1" aria-label={t('tabs.ariaLabel')} role="tablist">
          {(['general', 'browser', 'issueIntegration'] as const).map((tab) => (
            <button
              key={tab}
              id={`project-settings-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls="project-settings-tabpanel"
              onClick={() => setActiveTab(tab)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                activeTab === tab
                  ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--accent-foreground))] font-medium'
                  : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))]',
              )}
            >
              {t(`tabs.${tab}`)}
            </button>
          ))}
        </nav>
        <div
          id="project-settings-tabpanel"
          className="flex-1 min-w-0 min-h-0"
          role="tabpanel"
          aria-labelledby={`project-settings-tab-${activeTab}`}
        >
          {activeTab === 'general' ? (
            <ProjectGeneralSettingsPanel projectId={projectId} />
          ) : activeTab === 'browser' ? (
            <ProjectBrowserSettingsPanel projectId={projectId} />
          ) : (
            <IssueIntegrationPanel projectId={projectId} />
          )}
        </div>
      </div>
    </Dialog>
  )
}
