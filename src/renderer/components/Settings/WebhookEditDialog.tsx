// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { cn } from '@/lib/utils'
import type { WebhookEndpoint, WebhookProviderType, WebhookEventKind } from '@shared/types'

const PROVIDER_OPTIONS: { value: WebhookProviderType; labelKey: string; descKey: string }[] = [
  { value: 'lark', labelKey: 'webhooks.providers.lark', descKey: 'webhooks.edit.providerDesc.lark' },
  { value: 'telegram', labelKey: 'webhooks.providers.telegram', descKey: 'webhooks.edit.providerDesc.telegram' },
  { value: 'custom', labelKey: 'webhooks.providers.custom', descKey: 'webhooks.edit.providerDesc.custom' }
]

const EVENT_OPTIONS: { value: WebhookEventKind; labelKey: string }[] = [
  { value: 'session_complete', labelKey: 'webhooks.edit.eventLabels.complete' },
  { value: 'session_error', labelKey: 'webhooks.edit.eventLabels.error' },
  { value: 'session_waiting', labelKey: 'webhooks.edit.eventLabels.waiting' },
  { value: 'session_start', labelKey: 'webhooks.edit.eventLabels.start' },
  { value: 'task_completed', labelKey: 'webhooks.edit.eventLabels.task' },
  { value: 'notification', labelKey: 'webhooks.edit.eventLabels.notify' }
]

function getFieldLabelKeys(provider: WebhookProviderType): {
  urlLabelKey: string
  urlPlaceholderKey: string
  secretLabelKey: string
  secretPlaceholderKey: string
} {
  switch (provider) {
    case 'lark':
      return {
        urlLabelKey: 'webhooks.edit.fields.lark.url',
        urlPlaceholderKey: 'webhooks.edit.fields.lark.urlPlaceholder',
        secretLabelKey: 'webhooks.edit.fields.lark.secret',
        secretPlaceholderKey: 'webhooks.edit.fields.lark.secretPlaceholder'
      }
    case 'telegram':
      return {
        urlLabelKey: 'webhooks.edit.fields.telegram.url',
        urlPlaceholderKey: 'webhooks.edit.fields.telegram.urlPlaceholder',
        secretLabelKey: 'webhooks.edit.fields.telegram.secret',
        secretPlaceholderKey: 'webhooks.edit.fields.telegram.secretPlaceholder'
      }
    case 'custom':
      return {
        urlLabelKey: 'webhooks.edit.fields.custom.url',
        urlPlaceholderKey: 'webhooks.edit.fields.custom.urlPlaceholder',
        secretLabelKey: 'webhooks.edit.fields.custom.secret',
        secretPlaceholderKey: 'webhooks.edit.fields.custom.secretPlaceholder'
      }
  }
}

function createEmptyEndpoint(): WebhookEndpoint {
  return {
    id: `wh_${crypto.randomUUID().slice(0, 8)}`,
    name: '',
    provider: 'lark',
    url: '',
    secret: '',
    enabled: true,
    useProxy: false,
    subscribedEvents: ['session_complete', 'session_error'],
    createdAt: Date.now(),
    lastTriggeredAt: null,
    lastError: null
  }
}

interface Props {
  open: boolean
  payload: WebhookEditDialogPayload
  onSave: (endpoint: WebhookEndpoint) => void
  onClose: () => void
}

export type WebhookEditDialogPayload =
  | { mode: 'add'; nonce: string }
  | { mode: 'edit'; endpoint: WebhookEndpoint; nonce: string }

function resolveInitialForm(payload: WebhookEditDialogPayload): WebhookEndpoint {
  return payload.mode === 'edit' ? payload.endpoint : createEmptyEndpoint()
}

export function WebhookEditDialog({ open, payload, onSave, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation('settings')
  const tc = useTranslation('common').t
  const isEditing = payload.mode === 'edit'
  const [form, setForm] = useState<WebhookEndpoint>(() => resolveInitialForm(payload))

  const fieldKeys = getFieldLabelKeys(form.provider)

  const isValid =
    form.name.trim() !== '' &&
    form.url.trim() !== '' &&
    (form.provider !== 'telegram' || form.secret.trim() !== '') &&
    form.subscribedEvents.length > 0

  const handleProviderChange = (provider: WebhookProviderType): void => {
    setForm((prev) => ({ ...prev, provider, url: '', secret: '' }))
  }

  const toggleEvent = (event: WebhookEventKind): void => {
    setForm((prev) => {
      const events = prev.subscribedEvents.includes(event)
        ? prev.subscribedEvents.filter((e) => e !== event)
        : [...prev.subscribedEvents, event]
      return { ...prev, subscribedEvents: events }
    })
  }

  const handleSave = (): void => {
    if (!isValid) return
    onSave(form)
  }

  const dialogTitle = isEditing ? t('webhooks.edit.editTitle') : t('webhooks.edit.addTitle')

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={dialogTitle}
      size="lg"
      className="flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))]">
        <h2 className="text-base font-semibold">{dialogTitle}</h2>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
          aria-label={t('webhooks.edit.closeAria')}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-5 space-y-5">
        {/* Provider selector */}
        <div>
          <label className="text-sm font-medium mb-2 block">{t('webhooks.edit.providerLabel')}</label>
          <div className="grid grid-cols-3 gap-2">
            {PROVIDER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleProviderChange(opt.value)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border p-3 text-sm transition-colors',
                  form.provider === opt.value
                    ? 'border-[hsl(var(--ring))] bg-[hsl(var(--primary)/0.08)]'
                    : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)]'
                )}
              >
                <span className="font-medium">{t(opt.labelKey)}</span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{t(opt.descKey)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Name */}
        <div>
          <label htmlFor="webhook-name" className="text-sm font-medium mb-1 block">
            {t('webhooks.edit.nameLabel')}
          </label>
          <input
            id="webhook-name"
            type="text"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder={t('webhooks.edit.namePlaceholder')}
            className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
          />
        </div>

        {/* URL */}
        <div>
          <label htmlFor="webhook-url" className="text-sm font-medium mb-1 block">
            {t(fieldKeys.urlLabelKey)}
          </label>
          <input
            id="webhook-url"
            type="text"
            value={form.url}
            onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
            placeholder={t(fieldKeys.urlPlaceholderKey)}
            className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
          />
        </div>

        {/* Secret */}
        <div>
          <label htmlFor="webhook-secret" className="text-sm font-medium mb-1 block">
            {t(fieldKeys.secretLabelKey)}
          </label>
          <input
            id="webhook-secret"
            type="password"
            value={form.secret}
            onChange={(e) => setForm((prev) => ({ ...prev, secret: e.target.value }))}
            placeholder={t(fieldKeys.secretPlaceholderKey)}
            autoComplete="off"
            className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
          />
        </div>

        {/* Event subscriptions */}
        <div>
          <label className="text-sm font-medium mb-2 block">{t('webhooks.edit.subscribedEvents')}</label>
          <div className="grid grid-cols-2 gap-2">
            {EVENT_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 cursor-pointer rounded-md border border-[hsl(var(--border))] px-3 py-2 hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
              >
                <input
                  type="checkbox"
                  checked={form.subscribedEvents.includes(opt.value)}
                  onChange={() => toggleEvent(opt.value)}
                  className="h-4 w-4 rounded border-[hsl(var(--border))] accent-[hsl(var(--ring))]"
                />
                <span className="text-sm">{t(opt.labelKey)}</span>
              </label>
            ))}
          </div>
          {form.subscribedEvents.length === 0 && (
            <p className="text-xs text-[hsl(var(--destructive))] mt-1">
              {t('webhooks.edit.selectOneEvent')}
            </p>
          )}
        </div>

        {/* Proxy toggle */}
        <div className="flex items-start justify-between gap-4 rounded-md border border-[hsl(var(--border))] px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">{t('webhooks.edit.useProxy')}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              {t('webhooks.edit.useProxyDesc')}
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5" aria-label="Use proxy for this webhook">
            <input
              type="checkbox"
              checked={form.useProxy}
              onChange={(e) => setForm((prev) => ({ ...prev, useProxy: e.target.checked }))}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-[hsl(var(--muted))] peer-focus:ring-2 peer-focus:ring-[hsl(var(--ring))] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[hsl(var(--primary))]" />
          </label>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-[hsl(var(--border))]">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
        >
          {tc('cancel')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isValid}
          className={cn(
            'px-4 py-2 text-sm rounded-md transition-colors',
            isValid
              ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90'
              : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] cursor-not-allowed'
          )}
        >
          {isEditing ? t('webhooks.edit.saveChanges') : t('webhooks.edit.addTitle')}
        </button>
      </div>
    </Dialog>
  )
}
