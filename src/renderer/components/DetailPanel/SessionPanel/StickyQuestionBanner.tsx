// SPDX-License-Identifier: Apache-2.0

/**
 * StickyQuestionBanner — self-subscribing component that displays the latest
 * user question as a sticky banner above the message list.
 *
 * Extracted from SessionPanel to eliminate its dependency on the high-frequency
 * `messages` array for computing `latestUserInfo`.  This component subscribes
 * to commandStore directly, so only IT re-renders when messages change — not
 * the entire SessionPanel.
 *
 * Data sources:
 *   - `latestUserInfo` → derived from messages (own store subscription)
 *   - `contextualQuestion` → from SessionMessageList scroll detection (prop)
 *
 * Interactions:
 *   - Single click → scroll to the corresponding user message
 *   - Double click → expand / collapse the question text
 */
import React, { memo, useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCommandStore, selectSessionMessages } from '@/stores/commandStore'
import { extractTextContent } from '@/lib/sessionHelpers'
import type { ManagedSessionMessage } from '@shared/types'
import type { SlashCommandBlock } from '@shared/types'
import { joinSlashDisplays } from '@shared/slashDisplay'
import type { SessionMessageListHandle } from './SessionMessageList'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the most recent user message that has visible content.
 * Returns both the display text and the message ID, or null if no such message exists.
 */
function getLatestVisibleUserInfo(
  messages: ManagedSessionMessage[],
): { text: string; id: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'user') continue
    const text = extractTextContent(msg.content, '\n')
    const hasImage = msg.content.some((b) => b.type === 'image')
    const slashNames = joinSlashDisplays(
      msg.content.filter((b): b is SlashCommandBlock => b.type === 'slash_command'),
    )
    if (text || hasImage || slashNames) {
      let displayText: string
      if (text) displayText = slashNames ? `${slashNames} ${text}`.trim() : text
      else if (slashNames) displayText = slashNames
      else displayText = '(image)'
      return { text: displayText, id: msg.id }
    }
  }
  return null
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface StickyQuestionBannerProps {
  /** Session ID — used to subscribe to messages for `latestUserInfo` derivation. */
  sessionId: string
  /** Ref to the message list — used for scroll-to-message on click. */
  messageListRef: React.RefObject<SessionMessageListHandle | null>
  /** Contextual question text from SessionMessageList's scroll detection.
   *  When non-null, overrides the latestUserInfo question. */
  contextualQuestion: string | null
  /** Message ID of the contextual question — for scroll-to-message. */
  contextualQuestionMsgId: string | null
}

// ─── Component ────────────────────────────────────────────────────────────────

export const StickyQuestionBanner = memo(function StickyQuestionBanner({
  sessionId,
  messageListRef,
  contextualQuestion,
  contextualQuestionMsgId,
}: StickyQuestionBannerProps): React.JSX.Element | null {
  const { t } = useTranslation('sessions')

  // Direct store subscription — derives latestUserInfo from messages.
  // This is the ONLY messages-dependent computation that was in SessionPanel
  // for the sticky banner.  By subscribing here, SessionPanel no longer needs
  // to re-render just to update the banner question text.
  const messages = useCommandStore((s) => selectSessionMessages(s, sessionId))

  const latestUserInfo = useMemo(
    () => getLatestVisibleUserInfo(messages),
    [messages],
  )
  const latestUserQuestion = latestUserInfo?.text ?? null
  const latestUserQuestionMsgId = latestUserInfo?.id ?? null

  // Final displayed question: contextual (scroll-aware) overrides latest.
  const displayedQuestion = contextualQuestion ?? latestUserQuestion
  const displayedQuestionMsgId = contextualQuestionMsgId ?? latestUserQuestionMsgId

  // Collapse banner when the displayed question changes.
  const [isBannerExpanded, setIsBannerExpanded] = useState(false)
  const prevDisplayedQuestionRef = useRef(displayedQuestion)
  useEffect(() => {
    if (prevDisplayedQuestionRef.current !== displayedQuestion) {
      prevDisplayedQuestionRef.current = displayedQuestion
      setIsBannerExpanded(false)
    }
  }, [displayedQuestion])

  // Single click → scroll to question; double click → expand/collapse.
  const handleBannerClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.detail >= 2) {
        setIsBannerExpanded((v) => !v)
        return
      }
      if (displayedQuestionMsgId) {
        messageListRef.current?.scrollToMessage(displayedQuestionMsgId)
      }
    },
    [displayedQuestionMsgId, messageListRef],
  )

  if (!displayedQuestion) return null

  return (
    <div
      className="flex items-start gap-2 px-3 py-1.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--primary)/0.04)] shrink-0"
      role="note"
      aria-label="Question being answered"
    >
      {/* ">" prompt marker — leading-5 matches the button so both tops align */}
      <span
        className="text-[hsl(var(--muted-foreground))] font-mono text-xs shrink-0 select-none leading-5"
        aria-hidden="true"
      >
        {'>'}
      </span>

      {/* Clickable text area — click to scroll to question, double-click to expand/collapse */}
      <button
        onClick={handleBannerClick}
        title="Click to scroll to question · Double-click to expand/collapse"
        className={cn(
          'flex-1 text-xs font-mono text-[hsl(var(--foreground)/0.65)] text-left min-w-0 leading-5',
          'hover:text-[hsl(var(--foreground)/0.85)] transition-colors cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded',
          isBannerExpanded ? 'line-clamp-3 break-words' : 'truncate',
        )}
        aria-expanded={isBannerExpanded}
        aria-label="Click to scroll to question, double-click to expand or collapse"
      >
        {displayedQuestion}
      </button>

      {/* Jump-to-latest button — leading-5 keeps it top-aligned with the first text line */}
      <button
        onClick={() => messageListRef.current?.scrollToBottom()}
        className="flex items-center gap-1 text-[10px] leading-5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded px-1"
        aria-label={t('sessionPanel.jumpToLatestAria')}
      >
        <ArrowDown className="w-3 h-3" aria-hidden="true" />
        <span>{t('sessionPanel.jumpToLatest')}</span>
      </button>
    </div>
  )
})
