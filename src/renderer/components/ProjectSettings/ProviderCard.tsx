// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Trash2, Pencil, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { IssueProviderIcon } from './IssueProviderIcons'
import { useIssueProviderStore } from '@/stores/issueProviderStore'
import { toast } from '@/lib/toast'
import { issueProviderPlatformLabel, issueProviderRepoLabel, type IssueProvider } from '@shared/types'

interface ProviderCardProps {
  provider: IssueProvider
  onEdit: (provider: IssueProvider) => void
}

export function ProviderCard({ provider, onEdit }: ProviderCardProps): React.JSX.Element {
  const { t } = useTranslation('projectSettings')
  const { deleteProvider, triggerSync, updateProvider, testConnection } = useIssueProviderStore()
  const [syncing, setSyncing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // ── Connection status ────────────────────────────────────────────
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [testingConnection, setTestingConnection] = useState(false)

  useEffect(() => {
    let cancelled = false
    setTestingConnection(true)
    testConnection(provider.id)
      .then((result) => {
        if (cancelled) return
        setConnectionOk(result.ok)
        setConnectionError(result.ok ? null : (result.error ?? null))
      })
      .catch(() => {
        if (cancelled) return
        setConnectionOk(false)
        setConnectionError('Connection test failed')
      })
      .finally(() => {
        if (!cancelled) setTestingConnection(false)
      })
    return () => { cancelled = true }
  }, [provider.id, testConnection])

  const platformLabel = issueProviderPlatformLabel(provider.platform)
  const repoDisplay = issueProviderRepoLabel(provider.platform, provider.repoOwner, provider.repoName)

  const handleSync = async (): Promise<void> => {
    setSyncing(true)
    try {
      await triggerSync(provider.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('issueIntegration.providerCard.syncFailed', 'Sync failed'))
    } finally {
      setSyncing(false)
    }
  }

  const handleToggleSync = async (checked: boolean): Promise<void> => {
    try {
      await updateProvider(provider.id, { syncEnabled: checked })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('issueIntegration.providerCard.updateFailed', 'Update failed'))
    }
  }

  const handleDelete = async (): Promise<void> => {
    try {
      await deleteProvider(provider.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('issueIntegration.providerCard.deleteFailed', 'Delete failed'))
    } finally {
      setConfirmingDelete(false)
    }
  }

  const lastSyncedLabel = provider.lastSyncedAt
    ? `${t('issueIntegration.providerCard.lastSynced')}: ${new Date(provider.lastSyncedAt).toLocaleString()}`
    : `${t('issueIntegration.providerCard.lastSynced')}: ${t('issueIntegration.providerCard.never')}`

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      {/* Top row: platform badge + repo + connection status + sync toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={cn(
              'shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md',
              provider.platform === 'github'
                ? 'bg-gray-900 text-white dark:bg-gray-200 dark:text-gray-900'
                : provider.platform === 'linear'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-800',
            )}
            aria-hidden="true"
          >
            <IssueProviderIcon platform={provider.platform} className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium truncate">{repoDisplay}</p>
              {/* Connection status indicator */}
              {!testingConnection && connectionOk === true && (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              )}
              {!testingConnection && connectionOk === false && (
                <XCircle
                  className="h-3.5 w-3.5 text-red-500 shrink-0 cursor-help"
                  title={connectionError ?? undefined}
                />
              )}
              {testingConnection && (
                <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-[hsl(var(--muted-foreground)/0.3)] border-t-[hsl(var(--muted-foreground))] animate-spin" />
              )}
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{platformLabel}</p>
          </div>
        </div>

        {/* Sync toggle — unified Switch component */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {provider.syncEnabled ? t('issueIntegration.providerCard.enabled') : t('issueIntegration.providerCard.disabled')}
          </span>
          <Switch
            checked={provider.syncEnabled}
            onChange={handleToggleSync}
            size="sm"
            label={provider.syncEnabled ? t('issueIntegration.providerCard.enabled') : t('issueIntegration.providerCard.disabled')}
          />
        </div>
      </div>

      {/* Bottom row: sync status + actions */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[hsl(var(--border)/0.5)]">
        <span className="text-xs text-[hsl(var(--muted-foreground))]">{lastSyncedLabel}</span>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors',
              'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
              syncing && 'opacity-50 cursor-not-allowed',
            )}
          >
            <RefreshCw className={cn('h-3 w-3', syncing && 'animate-spin')} />
            {syncing ? t('issueIntegration.providerCard.syncing') : t('issueIntegration.providerCard.syncNow')}
          </button>

          <button
            onClick={() => onEdit(provider)}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
          >
            <Pencil className="h-3 w-3" />
            {t('issueIntegration.providerCard.edit', 'Edit')}
          </button>

          {confirmingDelete ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleDelete}
                className="px-2 py-1 text-xs rounded-md text-red-500 hover:bg-red-500/10 transition-colors"
              >
                {t('issueIntegration.providerCard.delete')}
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="px-2 py-1 text-xs rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
              >
                {t('issueIntegration.providerCard.cancelDelete', 'Cancel')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              {t('issueIntegration.providerCard.delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
