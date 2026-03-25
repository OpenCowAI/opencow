// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Bot, Sparkles } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useMessagingStore } from '@/stores/messagingStore'
import type {
  IMConnection,
  IMPlatformType,
  TelegramConnection,
  FeishuConnection,
  DiscordConnection,
  WeixinConnection,
} from '@shared/types'
import { usePopover } from '@/hooks/usePopover'
import { cn } from '@/lib/utils'
import { ConnectionCard } from './messaging/ConnectionCard'
import { BotAICreatorModal } from '../BotAICreator/BotAICreatorModal'
import { ALL_PLATFORMS, PLATFORM_META } from './messaging/platformConfig'
import type { TFunction } from 'i18next'

// ── Factory: create a new blank connection for a given platform ──────────────

function makeNewConnection(platform: IMPlatformType, t: TFunction): IMConnection {
  const platformName = t(PLATFORM_META[platform].labelKey)
  const base = {
    id: crypto.randomUUID(),
    name: t('messaging.newConnectionName', { platform: platformName }),
    enabled: false,
    allowedUserIds: [],
    defaultWorkspacePath: '',
  }

  switch (platform) {
    case 'telegram':
      return { ...base, platform: 'telegram', botToken: '' } satisfies TelegramConnection
    case 'feishu':
      return { ...base, platform: 'feishu', appId: '', appSecret: '' } satisfies FeishuConnection
    case 'discord':
      return { ...base, platform: 'discord', botToken: '' } satisfies DiscordConnection
    case 'weixin':
      return { ...base, platform: 'weixin', botToken: '' } satisfies WeixinConnection
  }
}

// ── Empty state — Platform quick-start cards ─────────────────────────────────

function EmptyState({ onSelect }: { onSelect: (platform: IMPlatformType) => void }): React.JSX.Element {
  const { t } = useTranslation('settings')
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.5)] px-6 py-8">
      <div className="text-center mb-6">
        <h4 className="text-sm font-semibold">{t('messaging.emptyState.title')}</h4>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
          {t('messaging.emptyState.description')}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {ALL_PLATFORMS.map((platform) => {
          const meta = PLATFORM_META[platform]
          const Icon = meta.icon
          return (
            <button
              key={platform}
              type="button"
              onClick={() => onSelect(platform)}
              className="group flex flex-col items-center gap-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-5 transition-all hover:border-[hsl(var(--ring))] hover:shadow-sm hover:-translate-y-0.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 outline-none"
            >
              <div className={`h-10 w-10 rounded-xl ${meta.iconBg} flex items-center justify-center`}>
                <Icon className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="text-center">
                <div className="text-sm font-medium">{t(meta.labelKey)}</div>
                <div className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">
                  {t(meta.setupTimeKey)}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Add bot popover — anchored to the "+" button ─────────────────────────────

function AddBotPopover({ onSelect }: { onSelect: (platform: IMPlatformType) => void }): React.JSX.Element {
  const { t } = useTranslation('settings')
  const {
    open,
    mounted,
    triggerRef,
    contentRef,
    animCls,
    toggle,
    closeImmediate,
  } = usePopover()

  const handleSelect = useCallback(
    (platform: IMPlatformType) => {
      closeImmediate()
      onSelect(platform)
    },
    [closeImmediate, onSelect],
  )

  return (
    <div className="relative flex-none">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-sm font-medium hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 outline-none"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('messaging.addConnection')}
      </button>

      {mounted && (
        <div
          ref={contentRef}
          role="menu"
          className={cn(
            'absolute right-0 top-full mt-2 z-50 w-72 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-lg p-2',
            animCls,
          )}
        >
          <p className="px-2 pt-1 pb-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">
            {t('messaging.choosePlatform')}
          </p>
          {ALL_PLATFORMS.map((platform) => {
            const meta = PLATFORM_META[platform]
            const Icon = meta.icon
            return (
              <button
                key={platform}
                type="button"
                role="menuitem"
                onClick={() => handleSelect(platform)}
                className="w-full flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-[hsl(var(--accent))] cursor-pointer focus-visible:bg-[hsl(var(--accent))] outline-none"
              >
                <div className={`h-8 w-8 rounded-lg ${meta.iconBg} flex items-center justify-center flex-none`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t(meta.labelKey)}</div>
                  <div className="text-[11px] text-[hsl(var(--muted-foreground))] leading-tight">
                    {t(meta.descriptionKey)}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main section ──────────────────────────────────────────────────────────────

export function MessagingSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore((s) => s.settings)!
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const statuses = useMessagingStore((s) => s.messagingConnectionStatuses)
  const loadMessagingConnectionStatuses = useMessagingStore((s) => s.loadMessagingConnectionStatuses)
  // AI Bot Creator modal visibility
  const [showBotCreator, setShowBotCreator] = useState(false)

  const configuredConnectionKey = useMemo(() => (
    settings.messaging.connections
      .map((connection) => connection.id)
      .sort((a, b) => a.localeCompare(b))
      .join('|')
  ), [settings.messaging.connections])

  // ── Ensure latest status snapshot for currently configured connections ─────
  useEffect(() => {
    if (settings.messaging.connections.length === 0) return
    const currentStatuses = useMessagingStore.getState().messagingConnectionStatuses
    const hasAllConfiguredStatuses = settings.messaging.connections.every((connection) => (
      currentStatuses.has(connection.id)
    ))

    void loadMessagingConnectionStatuses({ force: !hasAllConfiguredStatuses }).catch(() => {
      // App may still be bootstrapping; DataBus events will keep store updated.
    })
  }, [
    configuredConnectionKey,
    loadMessagingConnectionStatuses,
    settings.messaging.connections,
    settings.messaging.connections.length,
  ])

  // ── Persist connections to settings ────────────────────────────────────────
  const updateConnections = useCallback(
    (connections: IMConnection[]) => {
      updateSettings({
        ...settings,
        messaging: { connections },
      })
    },
    [settings, updateSettings],
  )

  const handleUpdateConnection = useCallback(
    (updated: IMConnection) => {
      const connections = settings.messaging.connections.map((c) =>
        c.id === updated.id ? updated : c,
      )
      updateConnections(connections)
    },
    [settings.messaging.connections, updateConnections],
  )

  const handleDeleteConnection = useCallback(
    (id: string) => {
      const connections = settings.messaging.connections.filter((c) => c.id !== id)
      updateConnections(connections)
    },
    [settings.messaging.connections, updateConnections],
  )

  const handleAddConnection = useCallback(
    (platform: IMPlatformType) => {
      const newConn = makeNewConnection(platform, t)
      updateConnections([newConn, ...settings.messaging.connections])
    },
    [settings.messaging.connections, updateConnections, t],
  )

  // ── AI Bot Creator: prepend newly created connection ─────────────────────
  // Note: modal stays open after creation so the user can see guidance + navigate.
  const handleBotCreated = useCallback(
    (connection: IMConnection) => {
      updateConnections([connection, ...settings.messaging.connections])
    },
    [settings.messaging.connections, updateConnections],
  )

  // ── AI Bot Creator: navigate to connection in Settings ─────────────────
  const [highlightConnectionId, setHighlightConnectionId] = useState<string | null>(null)

  const handleNavigateToConnection = useCallback(
    (connectionId: string) => {
      setShowBotCreator(false)
      // Defer highlight + scroll so the modal closes and the connection list re-renders first
      requestAnimationFrame(() => {
        setHighlightConnectionId(connectionId)
      })
    },
    [],
  )

  // Auto-clear highlight after the flash animation completes
  useEffect(() => {
    if (!highlightConnectionId) return
    const timer = setTimeout(() => setHighlightConnectionId(null), 2000)
    return () => clearTimeout(timer)
  }, [highlightConnectionId])

  // Filter out connections for hidden platforms
  const connections = settings.messaging.connections.filter(
    (c) => !PLATFORM_META[c.platform]?.hidden,
  )

  return (
    <div className="space-y-5">
      {/* ── Section header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-[hsl(var(--primary)/0.08)] flex items-center justify-center flex-none">
            <Bot className="h-4.5 w-4.5 text-[hsl(var(--primary))]" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">{t('messaging.title')}</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              {t('messaging.description')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowBotCreator(true)}
            title={t('messaging.botCreator.aiSetupTooltip')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-violet-600 hover:text-violet-700 hover:bg-violet-500/5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] whitespace-nowrap"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {t('messaging.botCreator.aiSetup')}
          </button>
          {connections.length > 0 && (
            <AddBotPopover onSelect={handleAddConnection} />
          )}
        </div>
      </div>

      {/* ── Connection list / Empty state ──────────────────────────────────── */}
      {connections.length === 0 ? (
        <EmptyState onSelect={handleAddConnection} />
      ) : (
        <div className="space-y-3">
          {connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              connection={conn}
              status={statuses.get(conn.id) ?? null}
              onUpdate={handleUpdateConnection}
              onDelete={() => handleDeleteConnection(conn.id)}
              highlight={conn.id === highlightConnectionId}
            />
          ))}
        </div>
      )}

      {/* ── AI Bot Creator modal ───────────────────────────────────────────── */}
      <BotAICreatorModal
        open={showBotCreator}
        onClose={() => setShowBotCreator(false)}
        onBotCreated={handleBotCreated}
        onNavigateToConnection={handleNavigateToConnection}
      />
    </div>
  )
}
