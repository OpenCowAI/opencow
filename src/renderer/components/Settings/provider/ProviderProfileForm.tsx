// SPDX-License-Identifier: Apache-2.0

/**
 * Provider profile create/edit form — dispatches on ProviderType.
 *
 * Every ProviderType in the shared `providerProfile` union is wired here.
 * When a new type is added, the exhaustive switches in both the render
 * path (field set) and `buildCreateInput` will fail to compile until the
 * form knows how to collect the required credentials.
 */

import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type {
  CreateProviderProfileInput,
  ProviderProfile,
  ProviderType,
} from '@shared/providerProfile'

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

// ─── Field selectors per type ────────────────────────────────────────
// Encoding "which fields this type needs" as a declarative record
// avoids sprawl across the render logic and buildCreateInput.

interface TypeFields {
  needsApiKey: boolean
  needsBaseUrl: boolean
  needsAuthStyle: boolean
}

const FIELDS: Record<ProviderType, TypeFields> = {
  'claude-subscription': { needsApiKey: false, needsBaseUrl: false, needsAuthStyle: false },
  'anthropic-api': { needsApiKey: true, needsBaseUrl: false, needsAuthStyle: false },
  'anthropic-compat-proxy': { needsApiKey: true, needsBaseUrl: true, needsAuthStyle: true },
  'openai-direct': { needsApiKey: true, needsBaseUrl: false, needsAuthStyle: false },
  'openai-compat-proxy': { needsApiKey: true, needsBaseUrl: true, needsAuthStyle: false },
  'gemini': { needsApiKey: true, needsBaseUrl: false, needsAuthStyle: false },
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
  const fields = FIELDS[type]

  const [name, setName] = useState(initial?.name ?? defaultNameFor(type))
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(readInitialBaseUrl(initial) ?? defaultBaseUrlFor(type))
  const [authStyle, setAuthStyle] = useState<'api_key' | 'bearer'>(
    initial?.credential.type === 'anthropic-compat-proxy'
      ? initial.credential.authStyle
      : 'bearer',
  )
  const [preferredModel, setPreferredModel] = useState(initial?.preferredModel ?? '')

  const canSubmit =
    name.trim().length > 0
    // In edit mode, blank apiKey means "keep existing". In create mode we need one if the type requires.
    && (mode === 'edit' || !fields.needsApiKey || apiKey.trim().length > 0)
    && (!fields.needsBaseUrl || baseUrl.trim().length > 0)

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    const input = buildCreateInput({
      type,
      mode,
      name: name.trim(),
      apiKey,
      baseUrl,
      authStyle,
      preferredModel: preferredModel.trim(),
    })
    if (!input) return
    await onSubmit(input)
  }, [canSubmit, type, mode, name, apiKey, baseUrl, authStyle, preferredModel, onSubmit])

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

      {fields.needsApiKey && (
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

      {fields.needsBaseUrl && (
        <label className="block">
          <span className="block text-xs font-medium mb-1">{t('provider.profile.baseUrlLabel')}</span>
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={defaultBaseUrlFor(type) || 'https://example.com/v1'}
            className={cn(formInputClass, 'font-mono')}
          />
        </label>
      )}

      {fields.needsAuthStyle && (
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
      )}

      <label className="block">
        <span className="block text-xs font-medium mb-1">
          {t('provider.profile.preferredModelLabel')}
          <span className="ml-1.5 text-[10px] font-normal text-[hsl(var(--muted-foreground))]">
            {type === 'claude-subscription'
              ? t('provider.profile.preferredModelOptional')
              : t('provider.profile.preferredModelRecommended')}
          </span>
        </span>
        <input
          type="text"
          value={preferredModel}
          onChange={(e) => setPreferredModel(e.target.value)}
          placeholder={defaultModelPlaceholder(type)}
          className={cn(formInputClass, 'font-mono')}
        />
      </label>

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
          disabled={busy || !canSubmit}
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
  }
}

function defaultBaseUrlFor(type: ProviderType): string {
  switch (type) {
    case 'anthropic-compat-proxy': return 'https://openrouter.ai/api/v1'
    case 'openai-compat-proxy': return 'https://api.deepseek.com/v1'
    default: return ''
  }
}

function apiKeyPlaceholder(type: ProviderType): string {
  if (type === 'anthropic-api') return 'sk-ant-...'
  if (type === 'gemini') return 'AIza...'
  return 'sk-...'
}

/** Suggested model id per protocol — shown as placeholder, never auto-applied. */
function defaultModelPlaceholder(type: ProviderType): string {
  switch (type) {
    case 'claude-subscription':
    case 'anthropic-api':
    case 'anthropic-compat-proxy':
      return 'claude-sonnet-4-6'
    case 'openai-direct':
    case 'openai-compat-proxy':
      return 'gpt-5.4'
    case 'gemini':
      return 'gemini-2.5-pro'
  }
}

function readInitialBaseUrl(initial?: ProviderProfile): string | null {
  if (!initial) return null
  const c = initial.credential
  if (c.type === 'anthropic-compat-proxy' || c.type === 'openai-compat-proxy') {
    return c.baseUrl
  }
  return null
}

function buildCreateInput(params: {
  type: ProviderType
  mode: 'create' | 'edit'
  name: string
  apiKey: string
  baseUrl: string
  authStyle: 'api_key' | 'bearer'
  preferredModel: string
}): CreateProviderProfileInput | null {
  const { type, mode, name, apiKey, baseUrl, authStyle, preferredModel } = params
  const trimmedKey = apiKey.trim()
  const trimmedUrl = baseUrl.trim()
  const modelField = preferredModel ? { preferredModel } : {}

  switch (type) {
    case 'claude-subscription':
      return { name, credential: { type: 'claude-subscription' }, authParams: {}, ...modelField }

    case 'anthropic-api':
      if (mode === 'create' && !trimmedKey) return null
      return {
        name,
        credential: { type: 'anthropic-api' },
        ...modelField,
        ...(trimmedKey ? { authParams: { apiKey: trimmedKey } } : {}),
      }

    case 'anthropic-compat-proxy':
      if (!trimmedUrl) return null
      if (mode === 'create' && !trimmedKey) return null
      return {
        name,
        credential: { type: 'anthropic-compat-proxy', baseUrl: trimmedUrl, authStyle },
        ...modelField,
        ...(trimmedKey
          ? { authParams: { apiKey: trimmedKey, baseUrl: trimmedUrl, authStyle } }
          : {}),
      }

    case 'openai-direct':
      if (mode === 'create' && !trimmedKey) return null
      return {
        name,
        credential: { type: 'openai-direct' },
        ...modelField,
        ...(trimmedKey ? { authParams: { apiKey: trimmedKey } } : {}),
      }

    case 'openai-compat-proxy':
      if (!trimmedUrl) return null
      if (mode === 'create' && !trimmedKey) return null
      return {
        name,
        credential: { type: 'openai-compat-proxy', baseUrl: trimmedUrl },
        ...modelField,
        ...(trimmedKey ? { authParams: { apiKey: trimmedKey, baseUrl: trimmedUrl } } : {}),
      }

    case 'gemini':
      if (mode === 'create' && !trimmedKey) return null
      return {
        name,
        credential: { type: 'gemini' },
        ...modelField,
        ...(trimmedKey ? { authParams: { apiKey: trimmedKey } } : {}),
      }
  }
}
