// SPDX-License-Identifier: Apache-2.0

/**
 * Phase B.5 Settings → Providers — profile list view.
 *
 * Shows user-owned LLM profiles with Add / Edit / Remove / Set Default
 * actions. Each profile is a `ProviderProfile` record from
 * src/shared/providerProfile.ts. Backend IPC lives in Phase B.4.
 *
 * Deferred to later Phase B steps:
 *   - Test Connection button (Phase B.6)
 *   - Per-profile live status badges (Phase B.6)
 *   - Non-Anthropic-native profile types (Phase D)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, Loader2, MoreHorizontal, Plus, Star, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { getAppAPI } from '@/windowAPI'
import type {
  CreateProviderProfileInput,
  ProviderProfile,
  ProviderProfileId,
  ProviderTestResult,
  ProviderType,
  UpdateProviderProfilePatch,
} from '@shared/providerProfile'
import { isProviderTypeImplemented } from '@shared/providerProfile'
import { ProviderProfileForm } from './provider/ProviderProfileForm'

// ─── Type catalog surfaced in the Add dropdown ───────────────────────

interface TypeGroup {
  heading: string
  items: ReadonlyArray<{ type: ProviderType; label: string }>
}

const TYPE_GROUPS: ReadonlyArray<TypeGroup> = [
  {
    heading: 'Anthropic',
    items: [
      { type: 'claude-subscription', label: 'Claude Pro/Max subscription' },
      { type: 'anthropic-api', label: 'Anthropic API direct' },
      { type: 'anthropic-compat-proxy', label: 'Anthropic-compatible proxy' },
      { type: 'anthropic-bedrock', label: 'AWS Bedrock' },
      { type: 'anthropic-vertex', label: 'Google Vertex' },
    ],
  },
  {
    heading: 'OpenAI',
    items: [
      { type: 'openai-direct', label: 'OpenAI direct' },
      { type: 'openai-compat-proxy', label: 'OpenAI-compatible proxy' },
    ],
  },
  {
    heading: 'Google',
    items: [
      { type: 'gemini', label: 'Gemini' },
    ],
  },
]

// ─── Component ───────────────────────────────────────────────────────

export function ProviderSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore((store) => store.settings)

  const profiles = useMemo<ProviderProfile[]>(
    () => settings?.provider.profiles ?? [],
    [settings?.provider.profiles],
  )
  const defaultProfileId = settings?.provider.defaultProfileId ?? null

  // Active form state — either adding a new profile of a type, or editing
  // an existing profile. Only one form is open at a time.
  const [addingType, setAddingType] = useState<ProviderType | null>(null)
  const [editingId, setEditingId] = useState<ProviderProfileId | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [formBusy, setFormBusy] = useState(false)

  const [dropdownOpen, setDropdownOpen] = useState(false)

  const closeForm = useCallback(() => {
    setAddingType(null)
    setEditingId(null)
    setFormError(null)
    setFormBusy(false)
  }, [])

  const refreshProfiles = useCallback(async () => {
    // The backend broadcasts `settings:updated` after mutations; the
    // useAppBootstrap DataBus listener refreshes settings automatically.
    // This explicit call covers the edge case where the event is missed
    // (e.g. form opened before dispatch subscribes).
    try {
      const list = await getAppAPI()['provider:list-profiles']()
      const current = useSettingsStore.getState().settings
      if (current) {
        useSettingsStore.getState().setSettings({
          ...current,
          provider: { ...current.provider, profiles: list },
        })
      }
    } catch {
      // Best-effort refresh — event-driven sync is authoritative.
    }
  }, [])

  const handleCreate = useCallback(
    async (input: CreateProviderProfileInput) => {
      setFormBusy(true)
      setFormError(null)
      try {
        await getAppAPI()['provider:create-profile'](input)
        await refreshProfiles()
        closeForm()
      } catch (err) {
        setFormError(err instanceof Error ? err.message : String(err))
      } finally {
        setFormBusy(false)
      }
    },
    [refreshProfiles, closeForm],
  )

  const handleUpdate = useCallback(
    async (id: ProviderProfileId, input: CreateProviderProfileInput) => {
      setFormBusy(true)
      setFormError(null)
      try {
        // Derive an update patch from the form payload. The form already
        // handles "blank key = keep" semantics (ProviderProfileForm passes
        // authParams only when the user typed a new key).
        const patch: UpdateProviderProfilePatch = {
          name: input.name,
          ...(input.credential.type === 'anthropic-compat-proxy'
            ? {
                credentialConfig: {
                  baseUrl: input.credential.baseUrl,
                  authStyle: input.credential.authStyle,
                },
              }
            : {}),
          ...(input.authParams ? { authParams: input.authParams } : {}),
        }
        await getAppAPI()['provider:update-profile'](id, patch)
        await refreshProfiles()
        closeForm()
      } catch (err) {
        setFormError(err instanceof Error ? err.message : String(err))
      } finally {
        setFormBusy(false)
      }
    },
    [refreshProfiles, closeForm],
  )

  const handleRemove = useCallback(
    async (id: ProviderProfileId, name: string) => {
      const ok = window.confirm(t('provider.profile.confirmRemove', { name }))
      if (!ok) return
      try {
        await getAppAPI()['provider:remove-profile'](id)
        await refreshProfiles()
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err))
      }
    },
    [refreshProfiles, t],
  )

  const handleSetDefault = useCallback(
    async (id: ProviderProfileId) => {
      try {
        await getAppAPI()['provider:set-default-profile'](id)
        await refreshProfiles()
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err))
      }
    },
    [refreshProfiles],
  )

  // ── Per-profile Test Connection state ─────────────────────────────
  const [testResults, setTestResults] = useState<Record<string, ProviderTestResult>>({})
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())

  const handleTest = useCallback(
    async (id: ProviderProfileId) => {
      setTestingIds((prev) => new Set(prev).add(id))
      try {
        const result = await getAppAPI()['provider:test-profile'](id)
        setTestResults((prev) => ({ ...prev, [id]: result }))
      } catch (err) {
        setTestResults((prev) => ({
          ...prev,
          [id]: {
            profileId: id,
            outcome: {
              ok: false,
              reason: 'error',
              message: err instanceof Error ? err.message : String(err),
            },
            durationMs: 0,
          },
        }))
      } finally {
        setTestingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [],
  )

  // Close the Add dropdown when clicking outside.
  useEffect(() => {
    if (!dropdownOpen) return
    const onDocClick = () => setDropdownOpen(false)
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [dropdownOpen])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-medium mb-1">{t('provider.title')}</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('provider.description')}</p>
        </div>
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setDropdownOpen((open) => !open)}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90"
            aria-haspopup="menu"
            aria-expanded={dropdownOpen}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t('provider.profile.addButton')}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {dropdownOpen && (
            <AddTypeDropdown
              onPick={(type) => {
                setDropdownOpen(false)
                if (!isProviderTypeImplemented(type)) return
                setEditingId(null)
                setAddingType(type)
                setFormError(null)
              }}
            />
          )}
        </div>
      </div>

      {profiles.length === 0 && !addingType && (
        <div className="rounded-lg border border-dashed border-[hsl(var(--border))] p-8 text-center">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t('provider.profile.emptyState')}
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {profiles.map((profile) => (
          <li key={profile.id}>
            {editingId === profile.id ? (
              <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--foreground)/0.02)] p-4">
                <ProviderProfileForm
                  mode="edit"
                  type={profile.credential.type}
                  initial={profile}
                  onSubmit={(input) => handleUpdate(profile.id, input)}
                  onCancel={closeForm}
                  error={formError}
                  busy={formBusy}
                />
              </div>
            ) : (
              <ProfileRow
                profile={profile}
                isDefault={profile.id === defaultProfileId}
                testing={testingIds.has(profile.id)}
                lastTest={testResults[profile.id] ?? null}
                onEdit={() => {
                  setAddingType(null)
                  setEditingId(profile.id)
                  setFormError(null)
                }}
                onRemove={() => handleRemove(profile.id, profile.name)}
                onSetDefault={() => handleSetDefault(profile.id)}
                onTest={() => handleTest(profile.id)}
              />
            )}
          </li>
        ))}
      </ul>

      {addingType && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--foreground)/0.02)] p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.8)] mb-3">
            {t('provider.profile.addHeading', { type: addingType })}
          </h4>
          <ProviderProfileForm
            mode="create"
            type={addingType}
            onSubmit={handleCreate}
            onCancel={closeForm}
            error={formError}
            busy={formBusy}
          />
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────

interface ProfileRowProps {
  profile: ProviderProfile
  isDefault: boolean
  testing: boolean
  lastTest: ProviderTestResult | null
  onEdit: () => void
  onRemove: () => void
  onSetDefault: () => void
  onTest: () => void
}

function ProfileRow({
  profile, isDefault, testing, lastTest, onEdit, onRemove, onSetDefault, onTest,
}: ProfileRowProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3',
        isDefault
          ? 'border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.06)]'
          : 'border-[hsl(var(--border))] bg-[hsl(var(--foreground)/0.02)]',
      )}
    >
      <div className="flex-none">
        {isDefault ? (
          <Star
            className="h-4 w-4 text-[hsl(var(--primary))]"
            fill="currentColor"
            aria-label={t('provider.profile.defaultBadge')}
          />
        ) : (
          <Star
            className="h-4 w-4 text-[hsl(var(--muted-foreground)/0.4)] cursor-pointer hover:text-[hsl(var(--muted-foreground))]"
            onClick={onSetDefault}
            aria-label={t('provider.profile.setDefault')}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{profile.name}</span>
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
            {profile.credential.type}
          </span>
          <TestStateBadge testing={testing} result={lastTest} />
        </div>
        <ProfileRowDetail profile={profile} />
      </div>
      <div className="flex-none flex items-center gap-1">
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          className="text-xs px-2 py-1 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)] disabled:opacity-50"
        >
          {t('provider.profile.test')}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs px-2 py-1 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)]"
        >
          {t('provider.profile.edit')}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs px-2 py-1 rounded-md border border-[hsl(var(--border))] hover:bg-red-500/10 hover:border-red-500/40"
          aria-label={t('provider.profile.remove')}
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function TestStateBadge({
  testing, result,
}: { testing: boolean; result: ProviderTestResult | null }): React.JSX.Element | null {
  const { t } = useTranslation('settings')
  if (testing) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        {t('provider.profile.testing')}
      </span>
    )
  }
  if (!result) return null
  if (result.outcome.ok) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] text-green-500"
        title={t('provider.profile.testOkTitle', { ms: result.durationMs })}
      >
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        {t('provider.profile.testOk')}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] text-red-500"
      title={result.outcome.message}
    >
      <XCircle className="h-3 w-3" aria-hidden="true" />
      {t(`provider.profile.testFail.${result.outcome.reason}`)}
    </span>
  )
}

function ProfileRowDetail({ profile }: { profile: ProviderProfile }): React.JSX.Element | null {
  const cred = profile.credential
  if (cred.type === 'anthropic-compat-proxy') {
    return (
      <p className="text-xs text-[hsl(var(--muted-foreground))] truncate font-mono">
        {cred.baseUrl || '—'}
      </p>
    )
  }
  if (cred.type === 'openai-compat-proxy') {
    return (
      <p className="text-xs text-[hsl(var(--muted-foreground))] truncate font-mono">
        {cred.baseUrl || '—'}
      </p>
    )
  }
  return null
}

interface AddTypeDropdownProps {
  onPick: (type: ProviderType) => void
}

function AddTypeDropdown({ onPick }: AddTypeDropdownProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  return (
    <div
      role="menu"
      className="absolute right-0 top-full mt-1 z-20 w-64 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-lg py-2"
    >
      {TYPE_GROUPS.map((group) => (
        <div key={group.heading} className="px-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.7)] px-2 py-1">
            {group.heading}
          </p>
          {group.items.map(({ type, label }) => {
            const enabled = isProviderTypeImplemented(type)
            return (
              <button
                key={type}
                type="button"
                onClick={() => enabled && onPick(type)}
                disabled={!enabled}
                className={cn(
                  'block w-full text-left text-xs px-2 py-1.5 rounded-sm',
                  enabled
                    ? 'hover:bg-[hsl(var(--foreground)/0.06)] cursor-pointer'
                    : 'text-[hsl(var(--muted-foreground)/0.5)] cursor-not-allowed',
                )}
                role="menuitem"
              >
                {label}
                {!enabled && (
                  <span className="ml-1.5 text-[9px] font-mono text-[hsl(var(--muted-foreground)/0.6)]">
                    ({t('provider.profile.sdkNotReady')})
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
