// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { AIEngineKind, ApiProvider, ProviderCredentialInfo, ProviderStatus } from '@shared/types'
import { ProviderCredentialPanels } from './CredentialPanels'
import type { ProviderModeOption } from './constants'

interface CredentialViewState {
  checkingStatus: boolean
  isAuthenticated: boolean
  isAuthenticating: boolean
  isEditing: boolean
  status: ProviderStatus | null
  initialValues: ProviderCredentialInfo | null
}

interface CredentialViewActions {
  onLogin: (mode: ApiProvider, params?: Record<string, unknown>) => void
  onLogout: () => void
  onCancelLogin: () => void
  onStartEditing: () => void
  onCancelEditing: () => void
}

interface ModeCredentialStepProps {
  engineKind: AIEngineKind
  providerModes: ReadonlyArray<ProviderModeOption>
  activeMode: ApiProvider | null
  effectiveActiveMode: ApiProvider | null
  modeSupported: boolean
  onModeSelect: (mode: ApiProvider) => void
  credential: {
    state: CredentialViewState
    actions: CredentialViewActions
  }
}

export function ModeCredentialStep({
  engineKind,
  providerModes,
  activeMode,
  effectiveActiveMode,
  modeSupported,
  onModeSelect,
  credential,
}: ModeCredentialStepProps): React.JSX.Element {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">{t('provider.modeSelectLabel')}</label>
        <select
          value={effectiveActiveMode ?? ''}
          onChange={(event) => {
            const nextMode = event.target.value as ApiProvider | ''
            if (!nextMode) return
            onModeSelect(nextMode)
          }}
          disabled={credential.state.checkingStatus}
          className={cn(
            'w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-3 pr-8 py-1.5 text-sm outline-none',
            'focus:ring-2 focus:ring-[hsl(var(--ring))]',
            credential.state.checkingStatus && 'opacity-60 cursor-not-allowed',
          )}
        >
          <option value="">{t('provider.modeSelectPlaceholder')}</option>
          {providerModes.map((modeOption) => (
            <option key={`${engineKind}-${modeOption.mode}`} value={modeOption.mode}>
              {t(modeOption.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {activeMode && !modeSupported && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-300">
            {t('provider.unsupportedModeForEngine', {
              mode: activeMode,
              engine: t(`provider.engines.${engineKind}`),
            })}
          </p>
        </div>
      )}

      {effectiveActiveMode ? (
        <ProviderCredentialPanels
          engineKind={engineKind}
          mode={effectiveActiveMode}
          state={credential.state}
          actions={credential.actions}
        />
      ) : (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('provider.steps.modeCredential.empty')}</p>
      )}
    </div>
  )
}
