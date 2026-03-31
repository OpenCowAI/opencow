// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Dialog } from '@/components/ui/Dialog'
import { IssueProviderIcon } from './IssueProviderIcons'
import { resolveModalExitDurationMs } from '@/hooks/useModalAnimation'
import { useIssueProviderStore } from '@/stores/issueProviderStore'
import { toast } from '@/lib/toast'
import { issueProviderPlatformLabel, issueProviderRepoLabel, type IssueProvider, type IssueSyncDirection } from '@shared/types'
import { useRef, useEffect } from 'react'

// ─── Sync interval presets (seconds) ──────────────────────────────

const SYNC_INTERVAL_OPTIONS = [
  { value: 60, label: '1 min' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
  { value: 1800, label: '30 min' },
  { value: 3600, label: '1 hour' },
]

const SYNC_DIRECTION_OPTIONS: { value: IssueSyncDirection; labelKey: string }[] = [
  { value: 'readonly', labelKey: 'editProvider.direction.readonly' },
  { value: 'push', labelKey: 'editProvider.direction.push' },
  { value: 'bidirectional', labelKey: 'editProvider.direction.bidirectional' },
]

// ─── Props ────────────────────────────────────────────────────────

interface EditProviderDialogProps {
  provider: IssueProvider
  onClose: () => void
  onSaved: () => void
}

// ─── Component ────────────────────────────────────────────────────

export function EditProviderDialog({ provider, onClose, onSaved }: EditProviderDialogProps): React.JSX.Element {
  const { t } = useTranslation('projectSettings')
  const { updateProvider } = useIssueProviderStore()

  // Two-phase close for exit animation
  const [open, setOpen] = useState(true)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  const requestClose = useCallback(() => {
    setOpen(false)
    setTimeout(() => onCloseRef.current(), resolveModalExitDurationMs())
  }, [])

  // Form state
  const [syncIntervalS, setSyncIntervalS] = useState(provider.syncIntervalS)
  const [syncDirection, setSyncDirection] = useState<IssueSyncDirection>(provider.syncDirection)
  const [apiBaseUrl, setApiBaseUrl] = useState(provider.apiBaseUrl ?? '')
  const [newToken, setNewToken] = useState('')
  const [saving, setSaving] = useState(false)

  const platformLabel = issueProviderPlatformLabel(provider.platform)
  const repoDisplay = issueProviderRepoLabel(provider.platform, provider.repoOwner, provider.repoName)

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const patch: Record<string, unknown> = {}
      if (syncIntervalS !== provider.syncIntervalS) patch.syncIntervalS = syncIntervalS
      if (syncDirection !== provider.syncDirection) patch.syncDirection = syncDirection
      if (provider.platform === 'gitlab' && apiBaseUrl !== (provider.apiBaseUrl ?? '')) {
        patch.apiBaseUrl = apiBaseUrl.trim() || null
      }
      if (newToken.trim()) patch.authToken = newToken.trim()

      if (Object.keys(patch).length === 0) {
        requestClose()
        return
      }

      await updateProvider(provider.id, patch)
      toast(t('editProvider.saved', 'Settings saved'))
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('editProvider.saveFailed', 'Save failed'))
    } finally {
      setSaving(false)
    }
  }, [syncIntervalS, syncDirection, apiBaseUrl, newToken, provider, updateProvider, t, onSaved, requestClose])

  return (
    <Dialog open={open} onClose={requestClose} title={t('editProvider.title', 'Edit Integration')} size="md" preventOverlayClose>
      <div className="px-6 pt-5 pb-2">
        {/* Provider identity (read-only) */}
        <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[hsl(var(--border)/0.5)]">
          <span
            className={cn(
              'shrink-0 inline-flex items-center justify-center h-6 w-6 rounded',
              provider.platform === 'github'
                ? 'bg-gray-900 text-white dark:bg-gray-200 dark:text-gray-900'
                : provider.platform === 'linear'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-800',
            )}
          >
            <IssueProviderIcon platform={provider.platform} className="w-3.5 h-3.5" />
          </span>
          <span className="text-sm font-medium">{repoDisplay}</span>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">{platformLabel}</span>
        </div>

        {/* Sync interval */}
        <div className="mb-4">
          <label className="block text-xs font-medium mb-1.5">
            {t('editProvider.syncInterval', 'Sync Interval')}
          </label>
          <select
            value={syncIntervalS}
            onChange={(e) => setSyncIntervalS(Number(e.target.value))}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-transparent outline-none focus:border-[hsl(var(--primary))] transition-colors"
          >
            {SYNC_INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Sync direction */}
        <div className="mb-4">
          <label className="block text-xs font-medium mb-1.5">
            {t('editProvider.syncDirection', 'Sync Direction')}
          </label>
          <select
            value={syncDirection}
            onChange={(e) => setSyncDirection(e.target.value as IssueSyncDirection)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-transparent outline-none focus:border-[hsl(var(--primary))] transition-colors"
          >
            {SYNC_DIRECTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey, opt.value)}
              </option>
            ))}
          </select>
        </div>

        {/* API Base URL — only for GitLab */}
        {provider.platform === 'gitlab' && (
          <div className="mb-4">
            <label className="block text-xs font-medium mb-1.5">
              {t('addProvider.apiBaseUrl.label')}
            </label>
            <input
              type="text"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder={t('addProvider.apiBaseUrl.placeholder')}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-transparent outline-none focus:border-[hsl(var(--primary))] transition-colors"
            />
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
              {t('addProvider.apiBaseUrl.hint')}
            </p>
          </div>
        )}

        {/* Token rotation */}
        <div className="mb-2">
          <label className="block text-xs font-medium mb-1.5">
            {t('editProvider.newToken', 'Update Token')}
          </label>
          <input
            type="password"
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
            placeholder={t('editProvider.newTokenPlaceholder', 'Leave empty to keep current token')}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[hsl(var(--border))] bg-transparent outline-none focus:border-[hsl(var(--primary))] transition-colors font-mono"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[hsl(var(--border))]">
        <button
          onClick={requestClose}
          className="px-4 py-1.5 text-xs font-medium rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          {t('addProvider.actions.cancel')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            'px-4 py-1.5 text-xs font-medium rounded-lg transition-all',
            'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
            saving ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90',
          )}
        >
          {saving ? t('editProvider.saving', 'Saving...') : t('editProvider.save', 'Save')}
        </button>
      </div>
    </Dialog>
  )
}
