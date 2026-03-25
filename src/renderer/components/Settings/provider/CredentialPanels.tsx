// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Loader2, LogOut, Pencil, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AIEngineKind, ApiProvider, ProviderCredentialInfo, ProviderStatus } from '@shared/types'
import { CustomCredentialForm, ApiKeyForm, OpenRouterForm } from './CredentialForms'
import { StatusBadge } from './StatusBadge'

interface CredentialPanelState {
  checkingStatus: boolean
  isAuthenticated: boolean
  isAuthenticating: boolean
  isEditing: boolean
  status: ProviderStatus | null
  initialValues: ProviderCredentialInfo | null
}

interface CredentialPanelActions {
  onLogin: (mode: ApiProvider, params?: Record<string, unknown>) => void
  onLogout: () => void
  onCancelLogin: () => void
  onStartEditing: () => void
  onCancelEditing: () => void
}

interface ProviderCredentialPanelsProps {
  engineKind: AIEngineKind
  mode: ApiProvider
  state: CredentialPanelState
  actions: CredentialPanelActions
}

function CheckingStatus(): React.JSX.Element {
  const { t } = useTranslation('settings')
  return (
    <div className="flex items-center gap-2 py-1">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      <span className="text-sm text-[hsl(var(--muted-foreground))]">{t('provider.status.checking')}</span>
    </div>
  )
}

interface SubscriptionPanelProps {
  state: Pick<CredentialPanelState, 'isAuthenticated' | 'isAuthenticating' | 'status'>
  actions: {
    onLogin: () => void
    onLogout: () => void
    onCancelLogin: () => void
  }
}

function SubscriptionPanel({ state, actions }: SubscriptionPanelProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const tc = useTranslation('common').t

  return (
    <div className="space-y-3">
      {state.isAuthenticated && state.status?.detail?.subscriptionType && (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {t('provider.plan')}{' '}
          <span className="font-medium text-[hsl(var(--foreground))] capitalize">
            {state.status.detail.subscriptionType}
          </span>
        </p>
      )}

      <div className="flex items-center gap-2">
        {!state.isAuthenticated && !state.isAuthenticating && (
          <button
            type="button"
            onClick={actions.onLogin}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
              'hover:bg-[hsl(var(--primary)/0.9)]',
            )}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            {t('provider.loginWithClaude')}
          </button>
        )}

        {state.isAuthenticating && (
          <>
            <span className="inline-flex items-center gap-2 text-sm text-yellow-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {t('provider.waitingForAuth')}
            </span>
            <button
              type="button"
              onClick={actions.onCancelLogin}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm font-medium transition-colors',
                'border border-[hsl(var(--border))] hover:bg-[hsl(var(--destructive)/0.1)] hover:border-[hsl(var(--destructive)/0.5)] hover:text-[hsl(var(--destructive))]',
              )}
            >
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {tc('cancel')}
            </button>
          </>
        )}

        {state.isAuthenticated && (
          <button
            type="button"
            onClick={actions.onLogout}
            disabled={state.isAuthenticating}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              'border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            {t('provider.logout')}
          </button>
        )}
      </div>

      {!state.isAuthenticated && !state.isAuthenticating && (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('provider.loginHelp')}</p>
      )}
    </div>
  )
}

interface AuthenticatedActionsProps {
  authenticating: boolean
  onStartEditing: () => void
  onLogout: () => void
}

function AuthenticatedActions({
  authenticating,
  onStartEditing,
  onLogout,
}: AuthenticatedActionsProps): React.JSX.Element {
  const { t } = useTranslation('settings')

  return (
    <div className="flex items-center gap-3">
      <StatusBadge state="authenticated" />
      <button
        type="button"
        onClick={onStartEditing}
        disabled={authenticating}
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm transition-colors',
          'border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        {t('provider.edit')}
      </button>
      <button
        type="button"
        onClick={onLogout}
        disabled={authenticating}
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm transition-colors',
          'border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        {t('provider.removeKey')}
      </button>
    </div>
  )
}

interface CredentialModePanelProps {
  state: Pick<CredentialPanelState, 'isAuthenticated' | 'isAuthenticating' | 'isEditing'>
  actions: Pick<CredentialPanelActions, 'onStartEditing' | 'onLogout' | 'onCancelEditing'>
  children: ReactNode
}

function CredentialModePanel({ state, actions, children }: CredentialModePanelProps): React.JSX.Element {
  const { t } = useTranslation('settings')

  if (state.isAuthenticated && !state.isEditing) {
    return (
      <AuthenticatedActions
        authenticating={state.isAuthenticating}
        onStartEditing={actions.onStartEditing}
        onLogout={actions.onLogout}
      />
    )
  }

  return (
    <div className="space-y-3">
      {children}
      {state.isEditing && (
        <button
          type="button"
          onClick={actions.onCancelEditing}
          className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          {t('provider.cancelEdit')}
        </button>
      )}
    </div>
  )
}

function renderCredentialForm(
  props: ProviderCredentialPanelsProps,
): React.JSX.Element {
  const { mode, engineKind, state, actions } = props

  if (mode === 'api_key') {
    return (
      <ApiKeyForm
        initialValues={state.initialValues}
        loading={state.isAuthenticating}
        onSubmit={(params) => actions.onLogin('api_key', params)}
      />
    )
  }

  if (mode === 'openrouter') {
    return (
      <OpenRouterForm
        initialValues={state.initialValues}
        loading={state.isAuthenticating}
        onSubmit={(params) => actions.onLogin('openrouter', params)}
      />
    )
  }

  return (
    <CustomCredentialForm
      initialValues={state.initialValues}
      loading={state.isAuthenticating}
      forceBearer={engineKind === 'codex'}
      onSubmit={(params) => actions.onLogin('custom', params)}
    />
  )
}

export function ProviderCredentialPanels(props: ProviderCredentialPanelsProps): React.JSX.Element {
  const { mode, state, actions } = props

  if (state.checkingStatus) {
    return <CheckingStatus />
  }

  if (mode === 'subscription') {
    return (
      <SubscriptionPanel
        state={{
          isAuthenticated: state.isAuthenticated,
          isAuthenticating: state.isAuthenticating,
          status: state.status,
        }}
        actions={{
          onLogin: () => actions.onLogin('subscription'),
          onLogout: actions.onLogout,
          onCancelLogin: actions.onCancelLogin,
        }}
      />
    )
  }

  return (
    <CredentialModePanel
      state={{
        isAuthenticated: state.isAuthenticated,
        isAuthenticating: state.isAuthenticating,
        isEditing: state.isEditing,
      }}
      actions={{
        onStartEditing: actions.onStartEditing,
        onLogout: actions.onLogout,
        onCancelEditing: actions.onCancelEditing,
      }}
    >
      {renderCredentialForm(props)}
    </CredentialModePanel>
  )
}
