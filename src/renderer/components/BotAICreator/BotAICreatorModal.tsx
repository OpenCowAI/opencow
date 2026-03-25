// SPDX-License-Identifier: Apache-2.0

/**
 * BotAICreatorModal — Centered modal for conversational IM bot configuration.
 *
 * Composes:
 *   - `CreatorModalControlled` for the full modal layout and lifecycle
 *   - `useBotCreatorSession` for domain-specific session management
 *   - `useCreatorModalBehavior` for modal behavior (needs `markConfirmed`)
 *
 * Domain-specific concerns only:
 *   - `BotConfirmationCard` footer for create / navigate
 *   - ParsedBotOutput → IMConnection conversion
 *   - Persists created connection via `onBotCreated` callback
 *
 * @module
 */

import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BotConfirmationCard } from './BotConfirmationCard'
import { CreatorModalControlled, type CreatorModalI18n } from '../AICreator'
import {
  useBotCreatorSession,
  type BotCreatorSessionConfig
} from '@/hooks/useBotCreatorSession'
import { useCreatorModalBehavior } from '@/hooks/useCreatorModalBehavior'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { toast } from '@/lib/toast'
import type { IMConnection } from '@shared/types'
import type { ParsedBotOutput } from '@shared/botOutputParser'

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/** Derive a stable identity key from parsed bot output for discard-guard comparison. */
function botOutputKey(p: ParsedBotOutput | null): string | null {
  if (!p) return null
  return `${p.platform}\0${p.name}`
}

/** Convert ParsedBotOutput → IMConnection for persistence. */
function toIMConnection(parsed: ParsedBotOutput): IMConnection {
  const base = {
    id: crypto.randomUUID(),
    name: parsed.name,
    enabled: false,
    allowedUserIds: parsed.allowedUserIds ?? [],
    defaultWorkspacePath: parsed.defaultWorkspacePath ?? '',
  }

  switch (parsed.platform) {
    case 'telegram':
      return { ...base, platform: 'telegram', botToken: parsed.botToken }
    case 'feishu':
      return {
        ...base,
        platform: 'feishu',
        appId: parsed.appId,
        appSecret: parsed.appSecret,
        domain: parsed.domain,
      }
    case 'discord':
      return {
        ...base,
        platform: 'discord',
        botToken: parsed.botToken,
        guildId: parsed.guildId,
      }
    case 'weixin':
      return {
        ...base,
        platform: 'weixin',
        botToken: parsed.botToken,
        ...(parsed.baseUrl ? { baseUrl: parsed.baseUrl } : {}),
      }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════

export interface BotAICreatorModalProps {
  /** Controls modal visibility. */
  open: boolean
  /** Called when the modal should close. */
  onClose: () => void
  /** Called when a bot connection is successfully created. Receives the new IMConnection. */
  onBotCreated: (connection: IMConnection) => void
  /**
   * Called when user wants to navigate to a created connection in Settings.
   * Parent should close modal + scroll to / highlight the ConnectionCard.
   */
  onNavigateToConnection?: (connectionId: string) => void
  /** Configuration for the bot creator session. */
  config?: BotCreatorSessionConfig
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export function BotAICreatorModal({
  open,
  onClose,
  onBotCreated,
  onNavigateToConnection,
  config = {}
}: BotAICreatorModalProps): React.JSX.Element | null {
  const { t } = useTranslation('settings')
  const projectId = useAppStore(selectProjectId)
  const projects = useAppStore((s) => s.projects)

  // ── Session config — merge props with current project context ──
  const sessionConfig: BotCreatorSessionConfig = useMemo(
    () => ({
      projectId: config.projectId ?? projectId,
    }),
    [config.projectId, projectId]
  )

  // ── Resolve project context ────────────────────────────────────
  const project = useMemo(
    () => {
      const id = sessionConfig.projectId
      const path = id ? projects.find((p) => p.id === id)?.path : undefined
      return { id: id ?? undefined, path }
    },
    [projects, sessionConfig.projectId]
  )

  const creator = useBotCreatorSession(sessionConfig)

  // ── Modal behavior (needs markConfirmed for create flow) ───────
  const modal = useCreatorModalBehavior({
    open,
    onClose,
    cleanup: creator.cleanup,
    outputKey: botOutputKey(creator.parsedBot),
    hasSession: creator.session !== null
  })

  // ── i18n strings ───────────────────────────────────────────────
  const i18n = useMemo<CreatorModalI18n>(
    () => ({
      header: { title: t('messaging.botCreator.title'), closeLabel: t('messaging.botCreator.close') },
      discard: {
        title: t('messaging.botCreator.discardTitle'),
        message: t('messaging.botCreator.discardMessage'),
        confirm: t('messaging.botCreator.discardConfirm'),
        cancel: t('messaging.botCreator.discardCancel')
      },
      welcome: {
        title: t('messaging.botCreator.welcomeTitle'),
        description: t('messaging.botCreator.welcomeDescription'),
        inputPlaceholder: t('messaging.botCreator.inputPlaceholder')
      },
      pausedPlaceholder: t('messaging.botCreator.inputPlaceholderPaused'),
      suggestions: [
        t('messaging.botCreator.suggestion.telegram'),
        t('messaging.botCreator.suggestion.feishu'),
        t('messaging.botCreator.suggestion.discord')
      ]
    }),
    [t]
  )

  // ── Bot creation handler (from confirmation card) ──────────────
  const handleConfirmBot = useCallback(
    async (parsed: ParsedBotOutput): Promise<IMConnection> => {
      const connection = toIMConnection(parsed)
      onBotCreated(connection)
      modal.markConfirmed()
      toast(t('messaging.botCreator.botCreated', { name: connection.name }))
      return connection
    },
    [onBotCreated, modal, t]
  )

  // ── Navigate to connection in Settings ─────────────────────────
  const handleNavigateToConnection = useCallback(
    (connectionId: string) => {
      if (onNavigateToConnection) {
        onNavigateToConnection(connectionId)
      } else {
        onClose()
      }
    },
    [onNavigateToConnection, onClose]
  )

  // ── Footer node: BotConfirmationCard ───────────────────────────
  const footerNode = useMemo(() => {
    if (!creator.parsedBot) return undefined
    return (
      <BotConfirmationCard
        bot={creator.parsedBot}
        onConfirm={handleConfirmBot}
        onNavigate={handleNavigateToConnection}
      />
    )
  }, [creator.parsedBot, handleConfirmBot, handleNavigateToConnection])

  // ── Render ─────────────────────────────────────────────────────
  return (
    <CreatorModalControlled
      modal={modal}
      creator={creator}
      i18n={i18n}
      project={project}
      footerNode={footerNode}
    />
  )
}
