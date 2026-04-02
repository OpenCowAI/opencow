// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { useIssueProviderStore } from '@/stores/issueProviderStore'
import { ProviderCard } from './ProviderCard'
import { AddProviderWizard } from './AddProviderWizard'
import { EditProviderDialog } from './EditProviderDialog'
import type { IssueProvider } from '@shared/types'

interface IssueIntegrationPanelProps {
  projectId: string
}

export function IssueIntegrationPanel({ projectId }: IssueIntegrationPanelProps): React.JSX.Element {
  const { t } = useTranslation('projectSettings')
  const { providers, loading, loadProviders } = useIssueProviderStore()
  const [showWizard, setShowWizard] = useState(false)
  const [editingProvider, setEditingProvider] = useState<IssueProvider | null>(null)

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))]">
          <div>
            <h3 className="text-sm font-medium">{t('issueIntegration.title')}</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              {t('issueIntegration.description')}
            </p>
          </div>
          <button
            onClick={() => setShowWizard(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('issueIntegration.addIntegration')}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-sm text-[hsl(var(--muted-foreground))]">
              {t('issueIntegration.loading')}
            </div>
          ) : providers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {t('issueIntegration.noProviders')}
              </p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                {t('issueIntegration.noProvidersHint')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {providers.map((provider) => (
                <ProviderCard key={provider.id} provider={provider} onEdit={setEditingProvider} />
              ))}
            </div>
          )}
        </div>
      </div>

      {showWizard && (
        <AddProviderWizard
          projectId={projectId}
          onClose={() => setShowWizard(false)}
          onCreated={() => {
            void loadProviders(projectId)
            setShowWizard(false)
          }}
        />
      )}

      {editingProvider && (
        <EditProviderDialog
          provider={editingProvider}
          onClose={() => setEditingProvider(null)}
          onSaved={() => {
            void loadProviders(projectId)
            setEditingProvider(null)
          }}
        />
      )}
    </>
  )
}
