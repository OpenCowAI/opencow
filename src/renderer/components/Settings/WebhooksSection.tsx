// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, Trash2, Zap, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { useDialogState } from '@/hooks/useModalAnimation'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import { WebhookEditDialog } from './WebhookEditDialog'
import type { WebhookEditDialogPayload } from './WebhookEditDialog'
import type { WebhookEndpoint, WebhookTestResult } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ---------------------------------------------------------------------------
// Provider badge styling
// ---------------------------------------------------------------------------

const PROVIDER_BADGE: Record<string, { labelKey: string; className: string }> = {
  lark: { labelKey: 'webhooks.providers.lark', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  telegram: {
    labelKey: 'webhooks.providers.telegram',
    className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
  },
  custom: {
    labelKey: 'webhooks.providers.custom',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300'
  }
}

const EVENT_LABEL_KEYS: Record<string, string> = {
  session_complete: 'webhooks.events.complete',
  session_error: 'webhooks.events.error',
  session_waiting: 'webhooks.events.waiting',
  session_start: 'webhooks.events.start',
  task_completed: 'webhooks.events.task',
  notification: 'webhooks.events.notify'
}

function createDialogNonce(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// ---------------------------------------------------------------------------
// WebhookCard (inline component)
// ---------------------------------------------------------------------------

function WebhookCard({
  endpoint,
  testResult,
  onToggle,
  onEdit,
  onDelete,
  onTest
}: {
  endpoint: WebhookEndpoint
  testResult: WebhookTestResult | 'loading' | undefined
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onTest: () => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const tc = useTranslation('common').t
  const badge = PROVIDER_BADGE[endpoint.provider] ?? PROVIDER_BADGE.custom

  return (
    <div
      className={cn(
        'rounded-lg border border-[hsl(var(--border))] p-3 transition-colors',
        endpoint.enabled ? 'bg-[hsl(var(--card))]' : 'bg-[hsl(var(--muted)/0.3)] opacity-60'
      )}
    >
      {/* Top row: badge + name + proxy badge + toggle */}
      <div className="flex items-center gap-2 mb-2">
        <span className={cn('px-2 py-0.5 rounded text-xs font-medium', badge.className)}>
          {t(badge.labelKey)}
        </span>
        {endpoint.useProxy && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
            {t('webhooks.viaProxy')}
          </span>
        )}
        <span className="text-sm font-medium flex-1 truncate">{endpoint.name}</span>
        <label className="relative inline-flex items-center cursor-pointer" aria-label={t('webhooks.enableWebhookAria')}>
          <input
            type="checkbox"
            checked={endpoint.enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-[hsl(var(--muted))] peer-focus:ring-2 peer-focus:ring-[hsl(var(--ring))] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[hsl(var(--primary))]" />
        </label>
      </div>

      {/* URL (truncated) */}
      <p className="text-xs text-[hsl(var(--muted-foreground))] font-mono truncate mb-2">
        {endpoint.provider === 'telegram' ? t('webhooks.chatPrefix', { url: endpoint.url }) : endpoint.url}
      </p>

      {/* Event badges */}
      <div className="flex flex-wrap gap-1 mb-3">
        {endpoint.subscribedEvents.map((evt) => (
          <span
            key={evt}
            className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--accent-foreground))]"
          >
            {EVENT_LABEL_KEYS[evt] ? t(EVENT_LABEL_KEYS[evt]) : evt}
          </span>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onTest}
          disabled={testResult === 'loading'}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors disabled:opacity-50"
          aria-label={t('webhooks.testWebhookAria')}
        >
          {testResult === 'loading' ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <Zap className="h-3 w-3" aria-hidden="true" />
          )}
          {tc('test')}
        </button>
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
          aria-label={t('webhooks.editWebhookAria')}
        >
          <Pencil className="h-3 w-3" aria-hidden="true" />
          {tc('edit')}
        </button>
        <button
          onClick={onDelete}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-[hsl(var(--border))] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors"
          aria-label={t('webhooks.deleteWebhookAria')}
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" />
          {tc('delete')}
        </button>

        {/* Test result indicator */}
        {testResult && testResult !== 'loading' && (
          <span className="ml-auto flex items-center gap-1 text-xs">
            {testResult.success ? (
              <>
                <CheckCircle className="h-3.5 w-3.5 text-green-500" aria-hidden="true" />
                <span className="text-green-600 dark:text-green-400">{t('webhooks.testOk', { ms: testResult.durationMs })}</span>
              </>
            ) : (
              <>
                <XCircle className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />
                <span className="text-red-600 dark:text-red-400 truncate max-w-[160px]">
                  {testResult.error ?? `HTTP ${testResult.statusCode}`}
                </span>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

function EmptyState({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  const { t } = useTranslation('settings')

  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-12 h-12 rounded-full bg-[hsl(var(--accent))] flex items-center justify-center mb-3">
        <Zap className="h-5 w-5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium mb-1">{t('webhooks.noWebhooks')}</p>
      <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4 max-w-xs">
        {t('webhooks.noWebhooksDesc')}
      </p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-colors"
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        {t('webhooks.addWebhook')}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// WebhooksSection (exported)
// ---------------------------------------------------------------------------

export function WebhooksSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore((s) => s.settings)!
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const editDialog = useDialogState<WebhookEditDialogPayload>()
  const [testResults, setTestResults] = useState<Record<string, WebhookTestResult | 'loading'>>({})

  const endpoints = settings.webhooks.endpoints

  const handleToggle = (id: string, enabled: boolean): void => {
    const updated = endpoints.map((ep) => (ep.id === id ? { ...ep, enabled } : ep))
    updateSettings({ ...settings, webhooks: { endpoints: updated } })
  }

  const handleDelete = (id: string): void => {
    const updated = endpoints.filter((ep) => ep.id !== id)
    updateSettings({ ...settings, webhooks: { endpoints: updated } })
  }

  const handleSave = (endpoint: WebhookEndpoint): void => {
    const idx = endpoints.findIndex((ep) => ep.id === endpoint.id)
    const updated =
      idx >= 0
        ? endpoints.map((ep) => (ep.id === endpoint.id ? endpoint : ep))
        : [...endpoints, endpoint]
    updateSettings({ ...settings, webhooks: { endpoints: updated } })
    editDialog.close()
  }

  const handleTest = async (endpoint: WebhookEndpoint): Promise<void> => {
    setTestResults((prev) => ({ ...prev, [endpoint.id]: 'loading' }))
    try {
      const result = await getAppAPI()['webhook:test'](endpoint)
      setTestResults((prev) => ({ ...prev, [endpoint.id]: result }))
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [endpoint.id]: { success: false, error: 'IPC error', durationMs: 0 }
      }))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium">{t('webhooks.title')}</h3>
          {endpoints.length > 0 && (
            <button
              onClick={() => editDialog.show({ mode: 'add', nonce: createDialogNonce() })}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              {t('webhooks.addWebhook')}
            </button>
          )}
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4">
          {t('webhooks.description')}
        </p>

        {endpoints.length === 0 ? (
          <EmptyState onAdd={() => editDialog.show({ mode: 'add', nonce: createDialogNonce() })} />
        ) : (
          <div className="space-y-2">
            {endpoints.map((ep) => (
              <WebhookCard
                key={ep.id}
                endpoint={ep}
                testResult={testResults[ep.id]}
                onToggle={(enabled) => handleToggle(ep.id, enabled)}
                onEdit={() => editDialog.show({ mode: 'edit', endpoint: ep, nonce: createDialogNonce() })}
                onDelete={() => handleDelete(ep.id)}
                onTest={() => handleTest(ep)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      {editDialog.data && (
        <WebhookEditDialog
          key={editDialog.data.nonce}
          open={editDialog.open}
          payload={editDialog.data}
          onSave={handleSave}
          onClose={editDialog.close}
        />
      )}
    </div>
  )
}
