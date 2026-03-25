// SPDX-License-Identifier: Apache-2.0

/**
 * BotConfirmationCard — In-conversation preview card for AI-generated bot configs.
 *
 * A read-only preview of the parsed bot configuration within the chat flow.
 * Supports a 4-state lifecycle (aligned with Issue/Schedule cards):
 *   - preview:   Read-only display with Create / Discard actions
 *   - creating:  Persisting to settings (spinner, disabled actions)
 *   - created:   Success state with platform-specific guidance + "View in Settings"
 *   - discarded: Collapsed strike-through state
 *
 * Enable / test / status monitoring are NOT this card's responsibility —
 * those belong to ConnectionCard which handles them properly via DataBus events.
 *
 * @module
 */

import { useState, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, Trash2, Shield, Key, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PLATFORM_META } from '../Settings/messaging/platformConfig'
import type { IMConnection } from '@shared/types'
import type { ParsedBotOutput } from '@shared/botOutputParser'

// ─── Types ───────────────────────────────────────────────────────────────────

type CardState = 'preview' | 'creating' | 'created' | 'discarded'

export interface BotConfirmationCardProps {
  /** The AI-parsed bot configuration. */
  bot: ParsedBotOutput
  /** Called when user confirms creation. Returns the created IMConnection. */
  onConfirm: (bot: ParsedBotOutput) => Promise<IMConnection>
  /** Called when user discards the config. */
  onDiscard?: () => void
  /** Called when user wants to navigate to the connection in Settings (scroll + highlight). */
  onNavigate?: (connectionId: string) => void
}

// ─── Credential summary helpers ──────────────────────────────────────────────

function getCredentialSummary(bot: ParsedBotOutput): string[] {
  switch (bot.platform) {
    case 'telegram':
      return [maskSecret(bot.botToken)]
    case 'feishu':
      return [bot.appId, maskSecret(bot.appSecret)]
    case 'discord': {
      const items = [maskSecret(bot.botToken)]
      if (bot.guildId) items.push(`Guild: ${bot.guildId}`)
      return items
    }
    case 'weixin': {
      const items: string[] = []
      if (bot.botToken) items.push(maskSecret(bot.botToken))
      else items.push('QR scan required')
      if (bot.baseUrl) items.push(bot.baseUrl)
      return items
    }
  }
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '••••••••'
  return value.slice(0, 4) + '••••' + value.slice(-4)
}

// ─── Component ──────────────────────────────────────────────────────────────

export const BotConfirmationCard = memo(function BotConfirmationCard({
  bot,
  onConfirm,
  onDiscard,
  onNavigate,
}: BotConfirmationCardProps): React.JSX.Element {
  const { t } = useTranslation('settings')

  const [cardState, setCardState] = useState<CardState>('preview')
  const [error, setError] = useState<string | null>(null)
  const [createdConnection, setCreatedConnection] = useState<IMConnection | null>(null)

  const isCreated = cardState === 'created'
  const isCreating = cardState === 'creating'
  const isDiscarded = cardState === 'discarded'

  const meta = PLATFORM_META[bot.platform]
  const Icon = meta.icon

  // ── Actions ────────────────────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    setCardState('creating')
    setError(null)
    try {
      const conn = await onConfirm(bot)
      setCreatedConnection(conn)
      setCardState('created')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('messaging.botCreator.createFailed'))
      setCardState('preview')
    }
  }, [bot, onConfirm, t])

  const handleDiscard = useCallback(() => {
    setCardState('discarded')
    onDiscard?.()
  }, [onDiscard])

  const handleNavigate = useCallback(() => {
    if (!createdConnection || !onNavigate) return
    onNavigate(createdConnection.id)
  }, [createdConnection, onNavigate])

  const credentials = getCredentialSummary(bot)

  // ── Render: Discarded ──────────────────────────────────────────

  if (isDiscarded) {
    return (
      <div className="ml-4 mt-2 max-w-md rounded-xl border border-[hsl(var(--border)/0.3)] bg-[hsl(var(--card)/0.5)] p-3 opacity-50">
        <span className="text-xs text-[hsl(var(--muted-foreground))] line-through">
          {bot.name} ({t(meta.labelKey)})
        </span>
        <span className="ml-2 text-[10px] text-[hsl(var(--muted-foreground)/0.5)] italic">
          {t('messaging.botCreator.discarded')}
        </span>
      </div>
    )
  }

  // ── Render: Main card ──────────────────────────────────────────

  return (
    <div
      className={cn(
        'ml-4 mt-2 max-w-md rounded-xl border overflow-hidden transition-colors',
        isCreated
          ? 'border-green-500/30 bg-[hsl(var(--card))]'
          : 'border-[hsl(var(--border)/0.5)] bg-[hsl(var(--card))]'
      )}
      role="region"
      aria-label={t('messaging.botCreator.confirmationAria')}
    >
      {/* ── Platform accent bar ──────────────────────────────── */}
      <div className={cn('h-0.5', meta.accentColor)} />

      {/* ── Header: Platform icon + name ──────────────────────── */}
      <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-1.5">
        <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center flex-none', meta.iconBg)}>
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className={cn(
            'text-sm font-medium truncate',
            isCreated
              ? 'text-green-600 dark:text-green-400'
              : 'text-[hsl(var(--foreground))]'
          )}>
            {isCreated && <Check className="w-3.5 h-3.5 inline mr-1" aria-hidden />}
            {bot.name}
          </h4>
          <span className={cn('text-[10px]', meta.color)}>
            {t(meta.labelKey)}
          </span>
        </div>
      </div>

      {/* ── Credentials preview ───────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 pb-2">
        <Key className="w-3 h-3 text-[hsl(var(--muted-foreground))]" aria-hidden />
        <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono truncate">
          {credentials.join(' · ')}
        </span>
      </div>

      {/* ── Optional: Allowed users ───────────────────────────── */}
      {bot.allowedUserIds && bot.allowedUserIds.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 pb-2">
          <Shield className="w-3 h-3 text-[hsl(var(--muted-foreground))]" aria-hidden />
          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
            {t('messaging.botCreator.allowedUsers', { count: bot.allowedUserIds.length })}
          </span>
        </div>
      )}

      {/* ── Notes (body content) ──────────────────────────────── */}
      {bot.notes && !isCreated && (
        <div className="relative border-t border-[hsl(var(--border)/0.3)]">
          <div className="px-3 py-2 max-h-16 overflow-hidden text-xs text-[hsl(var(--muted-foreground))] leading-relaxed whitespace-pre-wrap">
            {bot.notes}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-4 pointer-events-none bg-gradient-to-t from-[hsl(var(--card))] to-transparent" />
        </div>
      )}

      {/* ── Error message ─────────────────────────────────────── */}
      {error && (
        <div className="px-3 py-1.5 text-xs text-red-500 border-t border-[hsl(var(--border)/0.3)]">
          {error}
        </div>
      )}

      {/* ── Actions footer ────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-[hsl(var(--border)/0.3)]">
        {/* Left: post-creation guidance or navigate */}
        <div>
          {isCreated && onNavigate && (
            <button
              onClick={handleNavigate}
              className="inline-flex items-center gap-1 text-[11px] text-[hsl(var(--primary))] hover:underline"
            >
              <ExternalLink className="w-3 h-3" aria-hidden />
              {t('messaging.botCreator.viewInSettings')}
            </button>
          )}
        </div>

        {/* Right: Discard + Create (pre-creation only) */}
        {!isCreated && (
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={handleDiscard}
              disabled={isCreating}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="w-3 h-3" aria-hidden />
              {t('messaging.botCreator.discard')}
            </button>
            <button
              onClick={handleConfirm}
              disabled={isCreating || !bot.name.trim()}
              className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-medium rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {isCreating ? (
                <Loader2 className="w-3 h-3 motion-safe:animate-spin" aria-hidden />
              ) : (
                <Check className="w-3 h-3" aria-hidden />
              )}
              {isCreating ? t('messaging.botCreator.creating') : t('messaging.botCreator.create')}
            </button>
          </div>
        )}
      </div>

      {/* ── Post-creation: platform-specific guidance ─────────── */}
      {isCreated && (
        <div className="px-3 pb-2.5 -mt-0.5">
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">
            {t(`messaging.botCreator.guide.${bot.platform}`, { name: bot.name })}
          </p>
        </div>
      )}
    </div>
  )
})
