// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/appStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTerminalOverlayStore } from '@/stores/terminalOverlayStore'
import { useMessagingStore } from '@/stores/messagingStore'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useSessionStatusCounts } from '@/hooks/useSessionStatusCounts'
import { StatusCountItem } from '@/components/ui/StatusCountItem'
import { Terminal as TerminalIcon } from 'lucide-react'

const VISIBLE_STATUSES = ['active', 'waiting', 'error'] as const

/** Provider mode i18n sub-keys — maps API provider mode to navigation:statusBar.providerModes.* key */
type ProviderModeI18nKey = 'claude' | 'apiKey' | 'openrouter' | 'custom'
const PROVIDER_MODE_KEYS: Record<string, ProviderModeI18nKey> = {
  subscription: 'claude',
  api_key: 'apiKey',
  openrouter: 'openrouter',
  custom: 'custom',
}

export function StatusBar(): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const sessions = useAppStore((s) => s.sessions)
  const projects = useAppStore((s) => s.projects)
  const onboarding = useAppStore((s) => s.onboarding)
  const providerStatus = useSettingsStore((s) => s.providerStatus)
  const connStatuses = useMessagingStore((s) => s.messagingConnectionStatuses)
  const settings = useSettingsStore((s) => s.settings)
  const openSettingsModal = useSettingsStore((s) => s.openSettingsModal)
  const counts = useSessionStatusCounts(sessions)

  // ── Terminal state ──────────────────────────────────────────────────────────
  const terminalOverlay = useTerminalOverlayStore((s) => s.terminalOverlay)
  const terminalTabGroups = useTerminalOverlayStore((s) => s.terminalTabGroups)
  const openTerminalOverlay = useTerminalOverlayStore((s) => s.openTerminalOverlay)
  const closeTerminalOverlay = useTerminalOverlayStore((s) => s.closeTerminalOverlay)
  const selectedProjectId = useAppStore((s) =>
    s.appView.mode === 'projects' ? s.appView.projectId : null
  )

  const isTerminalOpen = terminalOverlay !== null

  const handleTerminalClick = (): void => {
    if (isTerminalOpen) {
      closeTerminalOverlay()
      return
    }
    // Open terminal for current project, or global if no project selected
    const scope = selectedProjectId
      ? { type: 'project' as const, projectId: selectedProjectId }
      : { type: 'global' as const }
    openTerminalOverlay(scope)
  }

  // ── Messaging connection status ──────────────────────────────────────────
  const configuredConnections = settings?.messaging?.connections ?? []

  const msgConnectedCount = configuredConnections.filter(
    (conn) => connStatuses.get(conn.id)?.connectionStatus === 'connected'
  ).length
  const msgNotConnectedCount = configuredConnections.length - msgConnectedCount

  const isAuthed = providerStatus?.state === 'authenticated'
  const isAuthenticating = providerStatus?.state === 'authenticating'

  // Display the active profile's name when available. Falls back to
  // the engine label when no profile is configured (fresh install).
  const profiles = settings?.provider.profiles ?? []
  const activeProfile = providerStatus?.profileId
    ? profiles.find((p) => p.id === providerStatus.profileId) ?? null
    : null
  const engineLabel = t('statusBar.engineNames.claude')
  const displayLabel = activeProfile?.name ?? engineLabel

  const authTitle = isAuthed
    ? t('statusBar.providerVia', { mode: displayLabel })
    : isAuthenticating
      ? t('statusBar.authenticating')
      : t('statusBar.notAuthenticated')

  return (
    <footer
      {...surfaceProps({ elevation: 'raised', color: 'card' })}
      className="h-7 border-t border-[hsl(var(--border)/0.4)] bg-[hsl(var(--card))] flex items-center px-4 text-xs text-[hsl(var(--muted-foreground))] gap-4 tabular-nums"
      role="status"
      aria-label={t('statusBar.sessionStats')}
    >
      <span>{projects.length} projects</span>
      {VISIBLE_STATUSES.map((status) => (
        <StatusCountItem key={status} status={status} count={counts[status]} hideWhenZero />
      ))}

      {/* Terminal toggle — click to open/close TerminalSheet */}
      <button
        className={cn(
          'ml-auto flex items-center gap-1.5 transition-colors',
          isTerminalOpen
            ? 'text-[hsl(var(--foreground))]'
            : 'hover:text-[hsl(var(--foreground))]',
        )}
        title={t('statusBar.terminal')}
        onClick={handleTerminalClick}
      >
        <TerminalIcon className="h-3 w-3" />
        <span className="text-[10px]">{t('statusBar.terminal')}</span>
        {(() => {
          const count = Object.values(terminalTabGroups).reduce((sum, g) => sum + g.tabs.length, 0)
          return count > 0 ? (
            <span className="text-[10px] tabular-nums opacity-60">{count}</span>
          ) : null
        })()}
      </button>

      {/* Provider status — click to open Settings > Provider */}
      <button
        className="flex items-center gap-1.5 hover:text-[hsl(var(--foreground))] transition-colors"
        title={authTitle}
        onClick={() => openSettingsModal('provider')}
      >
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            isAuthed ? 'bg-green-500' : isAuthenticating ? 'bg-yellow-500 animate-pulse' : 'bg-orange-400'
          )}
          aria-hidden="true"
        />
        <span className="text-[10px]">
          {isAuthed ? displayLabel : t('statusBar.provider')}
        </span>
      </button>


      {/* Messaging connection status — only shown when at least one connection is configured */}
      {configuredConnections.length > 0 && (
        <button
          className="flex items-center gap-1 hover:text-[hsl(var(--foreground))] transition-colors"
          title={t('statusBar.messagingStatus', { connected: msgConnectedCount, notConnected: msgNotConnectedCount })}
          onClick={() => openSettingsModal('messaging')}
          aria-label={t('statusBar.messagingStatus', { connected: msgConnectedCount, notConnected: msgNotConnectedCount })}
        >
          {msgConnectedCount > 0 && (
            <span className="flex items-center gap-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
              <span className="text-[10px]">{msgConnectedCount}</span>
            </span>
          )}
          {msgNotConnectedCount > 0 && (
            <span className="flex items-center gap-0.5">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  configuredConnections.some(
                    (conn) => connStatuses.get(conn.id)?.connectionStatus === 'error'
                  )
                    ? 'bg-red-500'
                    : 'bg-orange-400'
                )}
                aria-hidden="true"
              />
              <span className="text-[10px]">{msgNotConnectedCount}</span>
            </span>
          )}
          <span className="text-[10px] ml-0.5">{t('statusBar.messaging')}</span>
        </button>
      )}
    </footer>
  )
}
