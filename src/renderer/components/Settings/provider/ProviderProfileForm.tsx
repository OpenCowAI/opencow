// SPDX-License-Identifier: Apache-2.0

/**
 * Provider profile create/edit form — dispatches on ProviderType.
 *
 * Phase B.5 implements the three types wired end-to-end today:
 *   - claude-subscription  (OAuth, no local fields)
 *   - anthropic-api        (single API key)
 *   - anthropic-compat-proxy (baseUrl + key + authStyle)
 *
 * Deferred types (openai-direct, openai-compat-proxy, gemini,
 * anthropic-bedrock, anthropic-vertex) render a read-only "Not yet
 * supported" notice — matches the proposal's grey-out behaviour.
 */

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type {
  CreateProviderProfileInput,
  ProviderProfile,
  ProviderType,
} from '@shared/providerProfile'
import { isProviderTypeImplemented } from '@shared/providerProfile'

interface ProviderProfileFormProps {
  mode: 'create' | 'edit'
  type: ProviderType
  initial?: ProviderProfile
  /** Fired when the user clicks Save. Caller is responsible for closing the form. */
  onSubmit: (input: CreateProviderProfileInput) => Promise<void>
  onCancel: () => void
  /** External error, surfaced above the buttons. */
  error: string | null
  busy: boolean
}

export function ProviderProfileForm({
  mode,
  type,
  initial,
  onSubmit,
  onCancel,
  error,
  busy,
}: ProviderProfileFormProps): React.JSX.Element {
  const { t } = useTranslation('settings')

  const [name, setName] = useState(initial?.name ?? defaultNameFor(type))
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(
    initial?.credential.type === 'anthropic-compat-proxy'
      ? initial.credential.baseUrl
      : '',
  )
  const [authStyle, setAuthStyle] = useState<'api_key' | 'bearer'>(
    initial?.credential.type === 'anthropic-compat-proxy'
      ? initial.credential.authStyle
      : 'bearer',
  )

  const supported = isProviderTypeImplemented(type)

  const handleSubmit = useCallback(async () => {
    if (!supported) return
    const trimmedName = name.trim()
    if (!trimmedName) return

    const input = buildCreateInput({ type, name: trimmedName, apiKey, baseUrl, authStyle })
    if (!input) return
    await onSubmit(input)
  }, [type, name, apiKey, baseUrl, authStyle, supported, onSubmit])

  if (!supported) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
        <p className="text-sm text-amber-300">
          {t('provider.profile.unsupported', { type })}
        </p>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)]"
          >
            {t('provider.profile.close')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="block text-xs font-medium mb-1">{t('provider.profile.nameLabel')}</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={defaultNameFor(type)}
          className={formInputClass}
        />
      </label>

      {(type === 'anthropic-api' || type === 'anthropic-compat-proxy') && (
        <label className="block">
          <span className="block text-xs font-medium mb-1">
            {t('provider.profile.apiKeyLabel')}
            {mode === 'edit' && (
              <span className="ml-1.5 text-[10px] font-normal text-[hsl(var(--muted-foreground))]">
                {t('provider.profile.apiKeyKeepHint')}
              </span>
            )}
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={apiKeyPlaceholder(type)}
            autoComplete="off"
            className={cn(formInputClass, 'font-mono')}
          />
        </label>
      )}

      {type === 'anthropic-compat-proxy' && (
        <>
          <label className="block">
            <span className="block text-xs font-medium mb-1">{t('provider.profile.baseUrlLabel')}</span>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://example.com/v1"
              className={cn(formInputClass, 'font-mono')}
            />
          </label>
          <div>
            <span className="block text-xs font-medium mb-1">{t('provider.profile.authStyleLabel')}</span>
            <div className="flex gap-3 text-xs">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="authStyle"
                  value="bearer"
                  checked={authStyle === 'bearer'}
                  onChange={() => setAuthStyle('bearer')}
                />
                Bearer
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="authStyle"
                  value="api_key"
                  checked={authStyle === 'api_key'}
                  onChange={() => setAuthStyle('api_key')}
                />
                x-api-key
              </label>
            </div>
          </div>
        </>
      )}

      {type === 'claude-subscription' && (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {t('provider.profile.subscriptionHint')}
        </p>
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] disabled:opacity-50"
        >
          {t('provider.profile.cancel')}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy || !name.trim()}
          className="text-xs px-3 py-1.5 rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50"
        >
          {busy
            ? t('provider.profile.saving')
            : type === 'claude-subscription'
              ? t('provider.profile.loginSubscription')
              : t('provider.profile.save')}
        </button>
      </div>
    </div>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────

const formInputClass = cn(
  'w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1.5 text-sm outline-none',
  'focus:ring-2 focus:ring-[hsl(var(--ring))]',
)

function defaultNameFor(type: ProviderType): string {
  switch (type) {
    case 'claude-subscription': return 'Claude Pro/Max'
    case 'anthropic-api': return 'Anthropic API'
    case 'anthropic-compat-proxy': return 'Custom Proxy'
    case 'openai-direct': return 'OpenAI'
    case 'openai-compat-proxy': return 'OpenAI-compatible'
    case 'gemini': return 'Gemini'
    case 'anthropic-bedrock': return 'Bedrock'
    case 'anthropic-vertex': return 'Vertex'
  }
}

function apiKeyPlaceholder(type: ProviderType): string {
  if (type === 'anthropic-api') return 'sk-ant-...'
  return 'sk-...'
}

function buildCreateInput(params: {
  type: ProviderType
  name: string
  apiKey: string
  baseUrl: string
  authStyle: 'api_key' | 'bearer'
}): CreateProviderProfileInput | null {
  const { type, name, apiKey, baseUrl, authStyle } = params

  switch (type) {
    case 'claude-subscription':
      // Passing an (empty) authParams triggers SubscriptionProvider.authenticate(),
      // which opens the browser-based OAuth flow. Without this the profile
      // would be persisted without credentials and be immediately unauthenticated.
      return {
        name,
        credential: { type: 'claude-subscription' },
        authParams: {},
      }
    case 'anthropic-api':
      if (!apiKey.trim()) return null
      return {
        name,
        credential: { type: 'anthropic-api' },
        authParams: { apiKey: apiKey.trim() },
      }
    case 'anthropic-compat-proxy':
      if (!apiKey.trim() || !baseUrl.trim()) return null
      return {
        name,
        credential: {
          type: 'anthropic-compat-proxy',
          baseUrl: baseUrl.trim(),
          authStyle,
        },
        authParams: {
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim(),
          authStyle,
        },
      }
    default:
      return null
  }
}
