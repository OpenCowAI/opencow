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

import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, Loader2, MoreHorizontal, Plus, Trash2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PillDropdown } from '@/components/ui/PillDropdown'
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
import { ProviderProfileForm } from './provider/ProviderProfileForm'

// ─── Type catalog surfaced in the Add dropdown ───────────────────────

interface TypeGroup {
  headingKey: 'anthropic' | 'openai' | 'google'
  items: ReadonlyArray<{ type: ProviderType }>
}

const TYPE_GROUPS: ReadonlyArray<TypeGroup> = [
  {
    headingKey: 'anthropic',
    items: [
      { type: 'claude-subscription' },
      { type: 'anthropic-api' },
      { type: 'anthropic-compat-proxy' },
    ],
  },
  {
    headingKey: 'openai',
    items: [
      { type: 'openai-direct' },
      { type: 'openai-compat-proxy' },
    ],
  },
  {
    headingKey: 'google',
    items: [
      { type: 'gemini' },
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
          // preferredModel uses null to clear, string to set, undefined to skip.
          preferredModel: input.preferredModel ?? null,
          ...(input.credential.type === 'anthropic-compat-proxy'
            ? {
                credentialConfig: {
                  baseUrl: input.credential.baseUrl,
                  authStyle: input.credential.authStyle,
                },
              }
            : input.credential.type === 'openai-compat-proxy'
              ? { credentialConfig: { baseUrl: input.credential.baseUrl } }
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

  const handlePickType = useCallback(
    (type: ProviderType) => {
      setDropdownOpen(false)
      setEditingId(null)
      setAddingType(type)
      setFormError(null)
    },
    [],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        {/*
          `min-w-0` lets the description shrink + wrap instead of
          forcing the row wider than the container; without it a long
          Chinese/English description pushed the primary CTA into a
          narrow column where the button label wrapped to two lines.
        */}
        <div className="min-w-0">
          <h3 className="text-sm font-medium mb-1">{t('provider.title')}</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('provider.description')}</p>
        </div>
        {/*
          Use the shared PillDropdown primitive so the menu inherits
          the system-wide dropdown enter/exit animation (see
          `globals.css:696` `dropdown-enter` / `dropdown-exit`). It
          also handles outside-click / Escape / portal positioning
          uniformly with every other dropdown in the app.
        */}
        <PillDropdown
          open={dropdownOpen}
          onOpenChange={setDropdownOpen}
          position="below"
          align="right"
          className="flex-none"
          dropdownClassName="w-64 py-2"
          trigger={
            <button
              type="button"
              onClick={() => setDropdownOpen((open) => !open)}
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 whitespace-nowrap"
              aria-haspopup="menu"
              aria-expanded={dropdownOpen}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('provider.profile.addButton')}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          }
        >
          <AddTypeMenuContent onPick={handlePickType} />
        </PillDropdown>
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
            {t('provider.profile.addHeading', { type: t(`provider.profile.typeLabels.${addingType}`) })}
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
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3',
        isDefault
          ? 'border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.06)]'
          : 'border-[hsl(var(--border))] bg-[hsl(var(--foreground)/0.02)]',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{profile.name}</span>
          {isDefault && (
            // Explicit textual badge beats the previous Star icon: `default`
            // semantics are unambiguous without hover-to-read a tooltip, and
            // the primary-tinted pill is consistent with TestStateBadge and
            // the rest of the settings surface.
            <span
              className="inline-flex items-center rounded-full bg-[hsl(var(--primary)/0.12)] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--primary))]"
            >
              {t('provider.profile.defaultBadge')}
            </span>
          )}
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono">
            {profile.credential.type}
          </span>
          <TestStateBadge testing={testing} result={lastTest} />
        </div>
        <ProfileRowDetail profile={profile} />
      </div>
      <div className="flex-none flex items-center gap-1">
        {!isDefault && (
          // Verb-labelled button replaces the previous "click the greyed-out
          // star" affordance. Ranked first in the action group because it's
          // the single most likely action on a non-default row (the rest are
          // steady-state utilities: test, edit, remove).
          <button
            type="button"
            onClick={onSetDefault}
            className="text-xs px-2 py-1 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)]"
          >
            {t('provider.profile.setDefault')}
          </button>
        )}
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
        {/*
          Ellipsis = "more actions" entry, not a direct destructive
          action. The previous design wired the ellipsis straight to
          `onRemove` (window.confirm), which violates the
          universal "⋯ opens a menu" convention — a user expecting to
          browse actions ended up in a confirm prompt instead.
          Wrapping in PillDropdown also gives the menu the system-wide
          enter/exit animation for free (globals.css `dropdown-enter`).
        */}
        <PillDropdown
          open={moreMenuOpen}
          onOpenChange={setMoreMenuOpen}
          position="below"
          align="right"
          dropdownClassName="w-36 py-1"
          trigger={
            <button
              type="button"
              onClick={() => setMoreMenuOpen((o) => !o)}
              className="text-xs px-2 py-1 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)]"
              aria-label={t('provider.profile.moreActions')}
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
            >
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          }
        >
          <div role="menu">
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen(false)
                onRemove()
              }}
              className="flex items-center gap-2 w-full text-left text-xs px-3 py-2 rounded-sm text-red-600 hover:bg-red-500/10 cursor-pointer"
              role="menuitem"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('provider.profile.remove')}
            </button>
          </div>
        </PillDropdown>
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
  const lines: string[] = []
  if (cred.type === 'anthropic-compat-proxy' || cred.type === 'openai-compat-proxy') {
    lines.push(cred.baseUrl || '—')
  }
  if (profile.preferredModel) lines.push(profile.preferredModel)
  if (lines.length === 0) return null
  return (
    <p className="text-xs text-[hsl(var(--muted-foreground))] truncate font-mono">
      {lines.join(' · ')}
    </p>
  )
}

interface AddTypeMenuContentProps {
  onPick: (type: ProviderType) => void
}

/**
 * Grouped provider-type menu items. Positioning, animation, and
 * outside-click handling are owned by the enclosing `PillDropdown`;
 * this component renders only the semantic `role="menu"` content.
 */
function AddTypeMenuContent({ onPick }: AddTypeMenuContentProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  return (
    <div role="menu">
      {TYPE_GROUPS.map((group) => (
        <div key={group.headingKey} className="px-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.7)] px-2 py-1">
            {t(`provider.profile.typeGroups.${group.headingKey}`)}
          </p>
          {group.items.map(({ type }) => (
            <button
              key={type}
              type="button"
              onClick={() => onPick(type)}
              className="block w-full text-left text-xs px-2 py-1.5 rounded-sm hover:bg-[hsl(var(--foreground)/0.06)] cursor-pointer"
              role="menuitem"
            >
              {t(`provider.profile.typeLabels.${type}`)}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
