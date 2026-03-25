// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ProxySettings } from '@shared/types'

/** Accepted proxy URL schemes for Telegram Bot (and Claude sessions). */
const PROXY_SCHEMES = ['http://', 'https://', 'socks5://', 'socks4://', 'socks://']

function validateProxyUrl(value: string, t: (key: string) => string): string | null {
  if (!value) return null
  const hasScheme = PROXY_SCHEMES.some((s) => value.startsWith(s))
  if (!hasScheme) return t('network.errorMissingScheme')
  try {
    new URL(value)
    return null
  } catch {
    return t('network.errorInvalidUrl')
  }
}

function ProxyField({
  label,
  value,
  placeholder,
  onChange,
  t,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
  t: (key: string) => string
}): React.JSX.Element {
  const error = validateProxyUrl(value, t)
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-md border bg-[hsl(var(--background))] px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] ${
          error
            ? 'border-red-400 focus:ring-red-400'
            : 'border-[hsl(var(--border))]'
        }`}
      />
      {error && (
        <p className="mt-1 text-xs text-red-500">{error}</p>
      )}
    </div>
  )
}

export function NetworkSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore((s) => s.settings)!
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const handleProxyChange = (field: keyof ProxySettings, value: string): void => {
    updateSettings({
      ...settings,
      proxy: { ...settings.proxy, [field]: value },
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">{t('network.title')}</h3>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">
          {t('network.description')}
        </p>
        <p
          className="text-xs text-[hsl(var(--muted-foreground))] mb-4 [&_code]:font-mono"
          dangerouslySetInnerHTML={{ __html: t('network.protocolHint') }}
        />
        <div className="space-y-3">
          <ProxyField
            label={t('network.httpsProxy')}
            value={settings.proxy.httpsProxy}
            placeholder={t('network.httpsProxyPlaceholder')}
            onChange={(v) => handleProxyChange('httpsProxy', v)}
            t={t}
          />
          <ProxyField
            label={t('network.httpProxy')}
            value={settings.proxy.httpProxy}
            placeholder={t('network.httpProxyPlaceholder')}
            onChange={(v) => handleProxyChange('httpProxy', v)}
            t={t}
          />
          <ProxyField
            label={t('network.noProxy')}
            value={settings.proxy.noProxy}
            placeholder={t('network.noProxyPlaceholder')}
            onChange={(v) => handleProxyChange('noProxy', v)}
            t={t}
          />
        </div>
      </div>
    </div>
  )
}
