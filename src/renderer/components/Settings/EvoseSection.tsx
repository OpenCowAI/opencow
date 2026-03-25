// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Loader2, Eye, EyeOff, ChevronDown, ChevronRight,
  CheckSquare, Square, Search, Info,
} from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { DEFAULT_EVOSE_SETTINGS, type EvoseApp, type EvoseAppConfig, type EvoseSettings } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ─── Utilities ────────────────────────────────────────────────────────────────

const parseWorkspaceIds = (raw: string): string[] =>
  raw.split(',').map((s) => s.trim()).filter(Boolean)

const formatWorkspaceIds = (ids: string[]): string => ids.join(', ')

const resolveEvoseBaseUrl = (raw: string): string =>
  raw.trim() || DEFAULT_EVOSE_SETTINGS.baseUrl

// ─── Status Type ─────────────────────────────────────────────────────────────

type FetchStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; count: number }
  | { kind: 'error'; message: string }

// ─── Primitives (inline, matching MessagingSection convention) ────────────────

function TextField({
  label, value, placeholder, type = 'text', hint, onChange, suffix,
}: {
  label: string
  value: string
  placeholder: string
  type?: string
  hint?: string
  onChange: (v: string) => void
  suffix?: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {hint && <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">{hint}</p>}
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
        />
        {suffix && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">{suffix}</div>
        )}
      </div>
    </div>
  )
}

/** Deterministic hue from string — gives each app a unique, stable avatar color. */
const AVATAR_HUES = [210, 260, 330, 30, 160, 190, 280, 350, 50, 130]
function avatarHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  return AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length]
}

function AppListItem({ app, checked, onToggle }: {
  app: EvoseAppConfig
  checked: boolean
  onToggle: () => void
}): React.JSX.Element {
  const hue = avatarHue(app.name)
  const initial = app.name.charAt(0).toUpperCase()

  return (
    <label className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-[hsl(var(--accent)/0.5)] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-4 w-4 rounded border-[hsl(var(--border))] accent-[hsl(var(--ring))]"
      />
      {app.avatar ? (
        <img
          src={app.avatar}
          alt=""
          className="flex-none h-6 w-6 rounded-full object-cover"
        />
      ) : (
        <span
          className="flex-none flex items-center justify-center h-6 w-6 rounded-full text-[11px] font-semibold leading-none select-none"
          style={{
            backgroundColor: `hsl(${hue} 50% 92%)`,
            color: `hsl(${hue} 45% 40%)`,
          }}
        >
          {initial}
        </span>
      )}
      <span className="flex-1 text-sm truncate">{app.name}</span>
      <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono">{app.type}</span>
    </label>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EvoseSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const tc = useTranslation('common').t
  const settings = useSettingsStore((s) => s.settings)!
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  // Local draft — not persisted until user clicks Save.
  // Re-initialized each time the tab is opened (conditional rendering in SettingsModal
  // unmounts/remounts this component on tab switch).
  const [draft, setDraft] = useState<EvoseSettings>(() => settings.evose)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>({ kind: 'idle' })
  const [searchQuery, setSearchQuery] = useState('')
  const [saved, setSaved] = useState(false)

  const patchDraft = useCallback(
    (partial: Partial<EvoseSettings>) => setDraft((d) => ({ ...d, ...partial })),
    [],
  )

  // useMemo: filteredApps is used in both render and setAllInFilter callback.
  // Memoizing avoids a new array reference on every render, which would otherwise
  // force setAllInFilter to re-create on every keystroke.
  const filteredApps = useMemo(
    () =>
      draft.apps.filter(
        (app) =>
          searchQuery === '' ||
          app.name.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [draft.apps, searchQuery],
  )

  const agents    = useMemo(() => filteredApps.filter((a) => a.type === 'agent'),    [filteredApps])
  const workflows = useMemo(() => filteredApps.filter((a) => a.type === 'workflow'), [filteredApps])

  // ── Validate & Fetch ──────────────────────────────────────────────────────

  const handleFetch = useCallback(async () => {
    if (!draft.apiKey.trim()) {
      setFetchStatus({ kind: 'error', message: t('evose.apiKeyRequired') })
      return
    }
    if (draft.workspaceIds.length === 0) {
      setFetchStatus({ kind: 'error', message: t('evose.workspaceIdsRequired') })
      return
    }

    setFetchStatus({ kind: 'loading' })
    try {
      const apps: EvoseApp[] = await getAppAPI()['evose:fetch-apps'](
        draft.apiKey,
        resolveEvoseBaseUrl(draft.baseUrl),
        draft.workspaceIds,
      )

      // Merge with existing enabled state:
      // - Previously enabled/disabled choices are preserved
      // - Newly discovered apps default to enabled=true
      const existingMap = new Map(draft.apps.map((a) => [a.appId, a]))
      const merged: EvoseAppConfig[] = apps.map((app) => ({
        appId:   app.id,
        name:    app.name,
        type:    app.type,
        enabled: existingMap.get(app.id)?.enabled ?? true,
        avatar:  app.avatar,
      }))

      patchDraft({ apps: merged })
      setFetchStatus({ kind: 'success', count: apps.length })
    } catch (err) {
      setFetchStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : t('evose.connectionFailed'),
      })
    }
  }, [draft.apiKey, draft.baseUrl, draft.workspaceIds, draft.apps, patchDraft, t])

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    updateSettings({
      ...settings,
      evose: {
        ...draft,
        baseUrl: resolveEvoseBaseUrl(draft.baseUrl),
      },
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [settings, draft, updateSettings])

  // ── App list helpers ──────────────────────────────────────────────────────

  const toggleApp = useCallback((appId: string) => {
    patchDraft({
      apps: draft.apps.map((a) => (a.appId === appId ? { ...a, enabled: !a.enabled } : a)),
    })
  }, [draft.apps, patchDraft])

  const setAllInFilter = useCallback(
    (enabled: boolean) => {
      const ids = new Set(filteredApps.map((a) => a.appId))
      patchDraft({
        apps: draft.apps.map((a) => (ids.has(a.appId) ? { ...a, enabled } : a)),
      })
    },
    [draft.apps, filteredApps, patchDraft],
  )

  const selectAllLabel = searchQuery
    ? t('evose.selectCurrentResults', { count: filteredApps.length })
    : t('evose.selectAll')

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold">{t('evose.title')}</h3>
          {/* Info icon with rich hover card */}
          <span className="group/evose-info relative inline-flex items-center">
            <Info className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] cursor-help hover:text-[hsl(var(--foreground))] transition-colors" aria-hidden="true" />
            <span
              className={[
                // Hidden: pointer-events-none so it doesn't block elements behind it.
                // Shown (group-hover): pointer-events-auto so the user can hover over
                // the card and click the link without the card disappearing.
                'pointer-events-none group-hover/evose-info:pointer-events-auto',
                'absolute left-0 top-full mt-2 z-50 w-72',
                'rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))]',
                'p-3.5 shadow-xl',
                'opacity-0 scale-95 transition-all duration-150',
                'group-hover/evose-info:opacity-100 group-hover/evose-info:scale-100',
              ].join(' ')}
              role="tooltip"
            >
              {/* Transparent bridge — covers the mt-2 gap between icon and card top.
                  When the mouse travels from the icon through the gap, it hovers over
                  this invisible strip (a child of group/evose-info), keeping the
                  group-hover state alive and the card visible. */}
              <span className="absolute inset-x-0 -top-2 h-2" aria-hidden="true" />

              {/* Site */}
              <a
                href="https://evose.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors mb-2 block"
              >
                🌐 {t('evose.website')} ↗
              </a>
              {/* Slogan */}
              <p className="text-[13px] font-semibold text-[hsl(var(--foreground))] mb-2 leading-snug">
                {t('evose.tagline')}
              </p>
              {/* Divider */}
              <div className="border-t border-[hsl(var(--border))] mb-2" />
              {/* Description */}
              <p className="text-[12px] text-[hsl(var(--muted-foreground))] leading-relaxed whitespace-normal">
                {t('evose.description')}
              </p>
            </span>
          </span>
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
          {t('evose.mcpDescription')}
        </p>
      </div>

      {/* API Key */}
      <TextField
        label={t('evose.apiKey')}
        value={draft.apiKey}
        placeholder={t('evose.apiKeyPlaceholder')}
        type={showApiKey ? 'text' : 'password'}
        onChange={(v) => patchDraft({ apiKey: v })}
        suffix={
          <button
            type="button"
            onClick={() => setShowApiKey((v) => !v)}
            className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            aria-label={showApiKey ? t('evose.hideApiKey') : t('evose.showApiKey')}
          >
            {showApiKey
              ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              : <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            }
          </button>
        }
      />

      {/* Workspace IDs */}
      <TextField
        label={t('evose.workspaceIds')}
        value={formatWorkspaceIds(draft.workspaceIds)}
        placeholder={t('evose.workspaceIdsPlaceholder')}
        hint={t('evose.workspaceIdsHint')}
        onChange={(v) => patchDraft({ workspaceIds: parseWorkspaceIds(v) })}
      />

      {/* Advanced: Endpoint */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          {showAdvanced
            ? <ChevronDown className="h-3.5 w-3.5" />
            : <ChevronRight className="h-3.5 w-3.5" />
          }
          {t('evose.advancedOptions')}
        </button>
        {showAdvanced && (
          <div className="mt-2 pl-4 border-l border-[hsl(var(--border))]">
            <TextField
              label={t('evose.endpoint')}
              value={draft.baseUrl}
              placeholder={t('evose.endpointPlaceholder')}
              hint={t('evose.endpointHint')}
              onChange={(v) => patchDraft({ baseUrl: v })}
            />
          </div>
        )}
      </div>

      {/* Fetch button + status */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleFetch}
          disabled={fetchStatus.kind === 'loading'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[hsl(var(--border))] text-sm hover:bg-[hsl(var(--accent))] transition-colors disabled:opacity-50"
        >
          {fetchStatus.kind === 'loading' && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          {t('evose.verifyAndFetch')}
        </button>
        {fetchStatus.kind === 'success' && (
          <span className="text-xs text-emerald-600">
            {t('evose.connectedApps', { count: fetchStatus.count })}
          </span>
        )}
        {fetchStatus.kind === 'error' && (
          <span className="text-xs text-red-500">{fetchStatus.message}</span>
        )}
      </div>

      {/* App list */}
      {draft.apps.length > 0 && (
        <div className="space-y-3 border-t border-[hsl(var(--border))] pt-4">
          {/* Toolbar */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAllInFilter(true)}
              className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {selectAllLabel}
            </button>
            <span className="text-[hsl(var(--border))]">·</span>
            <button
              type="button"
              onClick={() => setAllInFilter(false)}
              className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            >
              <Square className="h-3.5 w-3.5" />
              {t('evose.deselectAll')}
            </button>
            <div className="ml-auto relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('evose.searchApps')}
                className="pl-7 pr-3 py-1 text-xs rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] w-36"
              />
            </div>
          </div>

          {/* Agents */}
          {agents.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-1 px-3">
                {t('evose.agents')}
              </p>
              <div className="space-y-0.5">
                {agents.map((app) => (
                  <AppListItem
                    key={app.appId}
                    app={app}
                    checked={app.enabled}
                    onToggle={() => toggleApp(app.appId)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Workflows */}
          {workflows.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide mb-1 px-3">
                {t('evose.workflows')}
              </p>
              <div className="space-y-0.5">
                {workflows.map((app) => (
                  <AppListItem
                    key={app.appId}
                    app={app}
                    checked={app.enabled}
                    onToggle={() => toggleApp(app.appId)}
                  />
                ))}
              </div>
            </div>
          )}

          {filteredApps.length === 0 && searchQuery && (
            <p className="text-sm text-center text-[hsl(var(--muted-foreground))] py-4">
              {t('evose.noAppsFound', { query: searchQuery })}
            </p>
          )}
        </div>
      )}

      {/* Save */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-[hsl(var(--border))]">
        {saved && (
          <span className="text-xs text-emerald-600">{t('evose.saved')}</span>
        )}
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-1.5 rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {tc('save')}
        </button>
      </div>
    </div>
  )
}
