// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProviderCredentialInfo } from '@shared/types'

interface BaseCredentialFormProps {
  initialValues: ProviderCredentialInfo | null
  loading: boolean
  onSubmit: (params: Record<string, unknown>) => void
}

interface CustomCredentialFormProps extends BaseCredentialFormProps {
  forceBearer: boolean
}

const INPUT_CLASS_NAME =
  'w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] font-mono'

const PRIMARY_BUTTON_CLASS_NAME = cn(
  'inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
  'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
  'hover:bg-[hsl(var(--primary)/0.9)]',
  'disabled:opacity-50 disabled:cursor-not-allowed',
)

export function ApiKeyForm({
  initialValues,
  loading,
  onSubmit,
}: BaseCredentialFormProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [apiKey, setApiKey] = useState(initialValues?.apiKey ?? '')

  useEffect(() => {
    setApiKey(initialValues?.apiKey ?? '')
  }, [initialValues?.apiKey])

  const handleSubmit = useCallback(() => {
    const trimmed = apiKey.trim()
    if (!trimmed) return
    onSubmit({ apiKey: trimmed })
  }, [apiKey, onSubmit])

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-1">{t('provider.apiKeyField')}</label>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={t('provider.apiKeyPlaceholder')}
          className={INPUT_CLASS_NAME}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSubmit()
          }}
        />
      </div>
      <button type="button" onClick={handleSubmit} disabled={loading || !apiKey.trim()} className={PRIMARY_BUTTON_CLASS_NAME}>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
        {t('provider.saveApiKey')}
      </button>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        {t('provider.getApiKeyFrom')}{' '}
        <a
          href="https://console.anthropic.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-[hsl(var(--foreground))]"
        >
          {t('provider.anthropicConsole')}
          <ExternalLink className="inline h-3 w-3 ml-0.5" aria-hidden="true" />
        </a>
      </p>
    </div>
  )
}

export function OpenRouterForm({
  initialValues,
  loading,
  onSubmit,
}: BaseCredentialFormProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [apiKey, setApiKey] = useState(initialValues?.apiKey ?? '')
  const [baseUrl, setBaseUrl] = useState(initialValues?.baseUrl ?? '')

  useEffect(() => {
    setApiKey(initialValues?.apiKey ?? '')
    setBaseUrl(initialValues?.baseUrl ?? '')
  }, [initialValues?.apiKey, initialValues?.baseUrl])

  const handleSubmit = useCallback(() => {
    const trimmedApiKey = apiKey.trim()
    if (!trimmedApiKey) return

    const params: Record<string, unknown> = { apiKey: trimmedApiKey }
    const trimmedBaseUrl = baseUrl.trim()
    if (trimmedBaseUrl) params.baseUrl = trimmedBaseUrl
    onSubmit(params)
  }, [apiKey, baseUrl, onSubmit])

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-1">{t('provider.openrouterApiKey')}</label>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={t('provider.openrouterApiKeyPlaceholder')}
          className={INPUT_CLASS_NAME}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSubmit()
          }}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">
          {t('provider.openrouterBaseUrl')}
          <span className="ml-1.5 text-xs font-normal text-[hsl(var(--muted-foreground))]">
            {t('provider.optional')}
          </span>
        </label>
        <input
          type="url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder={t('provider.openrouterBaseUrlPlaceholder')}
          className={INPUT_CLASS_NAME}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSubmit()
          }}
        />
      </div>
      <button type="button" onClick={handleSubmit} disabled={loading || !apiKey.trim()} className={PRIMARY_BUTTON_CLASS_NAME}>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
        {t('provider.saveApiKey')}
      </button>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        {t('provider.getOpenrouterKeyFrom')}{' '}
        <a
          href="https://openrouter.ai/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-[hsl(var(--foreground))]"
        >
          openrouter.ai
          <ExternalLink className="inline h-3 w-3 ml-0.5" aria-hidden="true" />
        </a>
      </p>
    </div>
  )
}

export function CustomCredentialForm({
  initialValues,
  loading,
  forceBearer,
  onSubmit,
}: CustomCredentialFormProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [apiKey, setApiKey] = useState(initialValues?.apiKey ?? '')
  const [baseUrl, setBaseUrl] = useState(initialValues?.baseUrl ?? '')
  const [authStyle, setAuthStyle] = useState<'api_key' | 'bearer'>(
    forceBearer ? 'bearer' : (initialValues?.authStyle ?? 'api_key'),
  )

  useEffect(() => {
    setApiKey(initialValues?.apiKey ?? '')
    setBaseUrl(initialValues?.baseUrl ?? '')
    setAuthStyle(forceBearer ? 'bearer' : (initialValues?.authStyle ?? 'api_key'))
  }, [forceBearer, initialValues?.apiKey, initialValues?.baseUrl, initialValues?.authStyle])

  const handleSubmit = useCallback(() => {
    const trimmedApiKey = apiKey.trim()
    const trimmedBaseUrl = baseUrl.trim()
    if (!trimmedApiKey || !trimmedBaseUrl) return

    onSubmit({
      apiKey: trimmedApiKey,
      baseUrl: trimmedBaseUrl,
      authStyle: forceBearer ? 'bearer' : authStyle,
    })
  }, [apiKey, authStyle, baseUrl, forceBearer, onSubmit])

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium mb-1">{t('provider.customBaseUrl')}</label>
        <input
          type="url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder={t('provider.customBaseUrlPlaceholder')}
          className={INPUT_CLASS_NAME}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSubmit()
          }}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">{t('provider.customApiKey')}</label>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={t('provider.customApiKeyPlaceholder')}
          className={INPUT_CLASS_NAME}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSubmit()
          }}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">{t('provider.customAuthStyle')}</label>
        {forceBearer ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('provider.customAuthStyleBearerFixed')}</p>
        ) : (
          <>
            <div className="flex gap-2">
              {(['api_key', 'bearer'] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => setAuthStyle(style)}
                  className={cn(
                    'flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors text-center',
                    authStyle === style
                      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))]'
                      : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary)/0.4)] hover:text-[hsl(var(--foreground))]',
                  )}
                >
                  {t(`provider.customAuthStyle_${style}`)}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-[hsl(var(--muted-foreground))]">
              {t(`provider.customAuthStyleHint_${authStyle}`)}
            </p>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading || !apiKey.trim() || !baseUrl.trim()}
        className={PRIMARY_BUTTON_CLASS_NAME}
      >
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
        {t('provider.saveApiKey')}
      </button>
    </div>
  )
}
