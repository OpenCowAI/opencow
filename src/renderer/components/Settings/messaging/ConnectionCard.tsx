// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, MoreHorizontal, Trash2 } from 'lucide-react'
import type { IMConnection, IMConnectionStatus } from '@shared/types'
import { getAppAPI } from '@/windowAPI'
import { usePopover } from '@/hooks/usePopover'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { PLATFORM_META, isPlatformSupported } from './platformConfig'
import { ConnectionBadge } from './ConnectionBadge'
import { TelegramConfigPanel } from './TelegramConfigPanel'
import { FeishuConfigPanel } from './FeishuConfigPanel'
import { DiscordConfigPanel } from './DiscordConfigPanel'
import { WeixinConfigPanel } from './WeixinConfigPanel'

// ── Type-safe partial update for discriminated unions ─────────────────────────

function patchConnection<K extends Exclude<keyof IMConnection, 'platform'>>(
  conn: IMConnection,
  field: K,
  value: IMConnection[K],
): IMConnection {
  return { ...conn, [field]: value } as IMConnection
}

// ── Platform-specific needs-setup check ──────────────────────────────────────

function needsSetup(conn: IMConnection): boolean {
  switch (conn.platform) {
    case 'telegram': return !conn.botToken
    case 'feishu':   return !conn.appId || !conn.appSecret
    case 'discord':  return !conn.botToken
    case 'weixin':   return !conn.botToken
  }
}

function hasRequiredCredentials(conn: IMConnection): boolean {
  return !needsSetup(conn)
}

// ── Platform config panel router ─────────────────────────────────────────────

function ConfigPanel({
  connection,
  status,
  onUpdate,
}: {
  connection: IMConnection
  status: IMConnectionStatus | null
  onUpdate: (c: IMConnection) => void
}): React.JSX.Element {
  switch (connection.platform) {
    case 'telegram':
      return <TelegramConfigPanel connection={connection} status={status} onUpdate={onUpdate} />
    case 'feishu':
      return <FeishuConfigPanel connection={connection} onUpdate={onUpdate} />
    case 'discord':
      return <DiscordConfigPanel connection={connection} onUpdate={onUpdate} />
    case 'weixin':
      return <WeixinConfigPanel connection={connection} status={status} onUpdate={onUpdate} />
  }
}

// ── Uptime formatter ────────────────────────────────────────────────────────

function formatUptime(connectedAt: number): string {
  const ms = Date.now() - connectedAt
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remainMins = mins % 60
  if (hours < 24) return `${hours}h${remainMins > 0 ? `${remainMins}m` : ''}`
  const days = Math.floor(hours / 24)
  return `${days}d${hours % 24}h`
}

// ── More actions dropdown ────────────────────────────────────────────────────

function MoreMenu({
  onDelete,
  disabled,
  disabledReason,
}: {
  onDelete: () => void
  disabled: boolean
  disabledReason?: string
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const p = usePopover()
  const [confirming, setConfirming] = useState(false)

  const handleToggle = useCallback(() => {
    setConfirming(false)
    p.toggle()
  }, [p.toggle])

  const handleDelete = useCallback(() => {
    p.closeImmediate()
    setConfirming(false)
    onDelete()
  }, [p.closeImmediate, onDelete])

  const handleCancel = useCallback(() => {
    setConfirming(false)
    p.close()
  }, [p.close])

  return (
    <div className="relative">
      <button
        ref={p.triggerRef}
        type="button"
        onClick={handleToggle}
        aria-expanded={p.open}
        aria-haspopup="true"
        aria-label={t('messaging.moreActions')}
        className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))] transition-colors focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] outline-none"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {p.mounted && (
        <div
          ref={p.contentRef}
          role="menu"
          className={cn(
            'absolute right-0 top-full mt-1 z-50 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-lg py-1',
            p.animCls,
          )}
        >
          {!confirming ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => disabled ? undefined : setConfirming(true)}
              disabled={disabled}
              title={disabled ? disabledReason : undefined}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-500 hover:bg-[hsl(var(--foreground)/0.04)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap focus-visible:bg-[hsl(var(--foreground)/0.04)] outline-none"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('messaging.deleteConnection')}
            </button>
          ) : (
            <div className="px-3 py-2 space-y-2.5 w-56">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('messaging.deleteConfirm')}</p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-2.5 py-1 text-xs rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--accent))] transition-colors focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] outline-none"
                >
                  {t('messaging.cancelDelete', { defaultValue: 'Cancel' })}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-2.5 py-1 text-xs rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors focus-visible:ring-2 focus-visible:ring-white/50 outline-none"
                >
                  {t('messaging.deleteConnection')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Stats dashboard ──────────────────────────────────────────────────────────

function StatsDashboard({ status }: { status: IMConnectionStatus }): React.JSX.Element | null {
  const { t } = useTranslation('settings')
  if (status.connectionStatus !== 'connected') return null

  const received = status.metadata?.messagesReceived ?? 0
  const sent = status.metadata?.messagesSent ?? 0
  const uptime = status.connectedAt ? formatUptime(status.connectedAt) : '—'

  return (
    <div className="grid grid-cols-3 gap-2 mx-4 mb-3">
      <div className="rounded-lg bg-[hsl(var(--muted)/0.5)] px-3 py-2 text-center">
        <div className="text-base font-semibold tabular-nums">↓ {received}</div>
        <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{t('messaging.stats.received')}</div>
      </div>
      <div className="rounded-lg bg-[hsl(var(--muted)/0.5)] px-3 py-2 text-center">
        <div className="text-base font-semibold tabular-nums">↑ {sent}</div>
        <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{t('messaging.stats.sent')}</div>
      </div>
      <div className="rounded-lg bg-[hsl(var(--muted)/0.5)] px-3 py-2 text-center">
        <div className="text-base font-semibold tabular-nums">{uptime}</div>
        <div className="text-[10px] text-[hsl(var(--muted-foreground))]">{t('messaging.stats.uptime')}</div>
      </div>
    </div>
  )
}

// ── Connection card ──────────────────────────────────────────────────────────

interface ConnectionCardProps {
  connection: IMConnection
  status: IMConnectionStatus | null
  onUpdate: (updated: IMConnection) => void
  onDelete: () => void
  /** When true, scroll into view and flash-highlight to draw user attention. */
  highlight?: boolean
}

export function ConnectionCard({ connection, status, onUpdate, onDelete, highlight }: ConnectionCardProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const meta = PLATFORM_META[connection.platform]
  const Icon = meta.icon
  const [expanded, setExpanded] = useState(needsSetup(connection))
  const [starting, setStarting] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // Scroll into view + auto-expand when highlight transitions to true
  useEffect(() => {
    if (!highlight || !cardRef.current) return
    cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setExpanded(true)
  }, [highlight])

  const handleToggleEnabled = useCallback(async () => {
    const nextEnabled = !connection.enabled
    onUpdate(patchConnection(connection, 'enabled', nextEnabled))
    setStarting(true)
    try {
      if (nextEnabled) {
        await getAppAPI()['messaging:start'](connection.id)
      } else {
        await getAppAPI()['messaging:stop'](connection.id)
      }
    } catch {
      onUpdate(patchConnection(connection, 'enabled', !nextEnabled))
    } finally {
      setStarting(false)
    }
  }, [connection, onUpdate])

  const adapterReady = isPlatformSupported(connection.platform)
  const isRunning = status?.connectionStatus === 'connecting' || status?.connectionStatus === 'connected'
  const toggleDisabled = starting || !adapterReady || !hasRequiredCredentials(connection)

  return (
    <div
      ref={cardRef}
      className={cn(
        'rounded-xl border bg-[hsl(var(--card))] overflow-hidden transition-shadow hover:shadow-sm',
        highlight
          ? 'border-[hsl(var(--primary))] ring-2 ring-[hsl(var(--primary)/0.3)] animate-in fade-in duration-300'
          : 'border-[hsl(var(--border))]'
      )}
    >
      <div className={`h-0.5 ${meta.accentColor}`} />

      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`h-9 w-9 rounded-xl ${meta.iconBg} flex items-center justify-center flex-none`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>

        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={connection.name}
            onChange={(e) => onUpdate(patchConnection(connection, 'name', e.target.value))}
            onClick={(e) => e.stopPropagation()}
            aria-label={t('messaging.rename')}
            spellCheck={false}
            autoComplete="off"
            className="block w-full bg-transparent text-sm font-medium outline-none border-b border-transparent hover:border-[hsl(var(--border))] focus-visible:border-[hsl(var(--ring))] py-0.5 transition-colors"
          />
          <div className="flex items-center gap-2 mt-0.5">
            {status?.metadata?.botUsername && (
              <span className="text-[11px] text-[hsl(var(--muted-foreground))]">@{status.metadata.botUsername}</span>
            )}
            <ConnectionBadge status={status} compact />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-none">
          <span
            title={
              !adapterReady
                ? t('messaging.adapterNotReady')
                : !hasRequiredCredentials(connection)
                  ? t('messaging.enterCredentialsFirst')
                  : undefined
            }
          >
            <Switch
              checked={connection.enabled}
              onChange={() => handleToggleEnabled()}
              size="md"
              disabled={toggleDisabled}
              label={connection.enabled ? t('messaging.stopConnection') : t('messaging.startConnection')}
            />
          </span>

          <MoreMenu
            onDelete={onDelete}
            disabled={isRunning}
            disabledReason={isRunning ? t('messaging.stopBeforeDelete') : undefined}
          />
        </div>
      </div>

      {status && <StatsDashboard status={status} />}

      <div className="border-t border-[hsl(var(--border))]">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.02)] transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))] outline-none"
        >
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
            : <ChevronRight className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
          }
          {t('messaging.configDetails')}
        </button>

        {expanded && (
          <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-1 duration-200">
            <ConfigPanel connection={connection} status={status} onUpdate={onUpdate} />
          </div>
        )}
      </div>
    </div>
  )
}
