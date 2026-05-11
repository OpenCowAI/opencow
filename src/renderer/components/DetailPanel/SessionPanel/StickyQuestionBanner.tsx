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
import { ArrowDown, MessageSquareQuote } from 'lucide-react'
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
    // Chat-aesthetic refresh: previously the banner used the legacy
    // CLI `>` prompt + monospace + `bg-primary/0.04` ink wash, which
    // clashed with the now chat-bubble user message style.  New design:
    //   - Soft `bg-muted/0.4` wash that reads as a section-level callout
    //     instead of an action-tinted strip
    //   - Subtle `border-b/0.5` divider
    //   - `MessageSquareQuote` icon at left = "the quoted question
    //     being answered" — semantic over decorative CLI prompt
    //   - Sans-serif body, muted-foreground default, foreground on
    //     hover; matches the rest of the session panel's typography
    //   - Jump-to-latest is now a soft chip with a hover wash, in line
    //     with the toolbar buttons elsewhere in the panel
    <div
      // `items-center` so the icon, question text, and jump-to-latest
      // chip share the same vertical midline.  The expanded multi-line
      // state remains rare (user must double-click to opt in), and even
      // then a centered icon reads cleaner than a top-anchored one for
      // this kind of banner-level callout.
      className="flex items-center gap-2 px-4 py-2 border-b border-[hsl(var(--border)/0.5)] bg-[hsl(var(--muted)/0.4)] shrink-0"
      role="note"
      aria-label="Question being answered"
    >
      <MessageSquareQuote
        className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]"
        aria-hidden="true"
      />

      {/* Clickable text area — click to scroll to question, double-click to expand/collapse */}
      <button
        onClick={handleBannerClick}
        title="Click to scroll to question · Double-click to expand/collapse"
        className={cn(
          'flex-1 text-xs text-left min-w-0 leading-relaxed',
          'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded',
          isBannerExpanded ? 'line-clamp-3 break-words' : 'truncate',
        )}
        aria-expanded={isBannerExpanded}
        aria-label="Click to scroll to question, double-click to expand or collapse"
      >
        {displayedQuestion}
      </button>

      {/* Jump-to-latest — soft chip; `-my-0.5` recovers the chip's
          padding so its hover wash doesn't push the banner's height. */}
      <button
        onClick={() => messageListRef.current?.scrollToBottom()}
        className={cn(
          'inline-flex items-center gap-1 -my-0.5 px-1.5 py-0.5 rounded-md text-[10px] shrink-0',
          'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
          'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
        )}
        aria-label={t('sessionPanel.jumpToLatestAria')}
      >
        <ArrowDown className="w-3 h-3" aria-hidden="true" />
        <span>{t('sessionPanel.jumpToLatest')}</span>
      </button>
    </div>
  )
})
