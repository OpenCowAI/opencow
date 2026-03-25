// SPDX-License-Identifier: Apache-2.0

/**
 * CreatorEmptyState — Shared welcome screen for AI Creator modals.
 *
 * Displayed before the first message in any single-panel Creator modal.
 * Shows a branded welcome message with suggestion chips that let
 * the user start a conversation with one click.
 *
 * Domain modals provide localized strings and suggestion arrays via props;
 * this component owns only the layout and interaction logic.
 *
 * @module
 */

import { Sparkles } from 'lucide-react'
import { ChatHeroInput } from '../ChatView/ChatHeroInput'
import type { UserMessageContent } from '@shared/types'

// ── Props ───────────────────────────────────────────────────────────

export interface CreatorEmptyStateProps {
  /** Whether a session is currently being created (disables interaction). */
  isStarting: boolean
  /** Send a message to start the session. */
  onSend: (message: UserMessageContent) => Promise<boolean>
  /** Welcome heading above the suggestions. */
  welcomeTitle: string
  /** Welcome description below the heading. */
  welcomeDescription: string
  /** Placeholder text for the input field. */
  inputPlaceholder: string
  /** Clickable suggestion strings (typically 2-4). */
  suggestions: string[]
}

// ── Component ───────────────────────────────────────────────────────

export function CreatorEmptyState({
  isStarting,
  onSend,
  welcomeTitle,
  welcomeDescription,
  inputPlaceholder,
  suggestions
}: CreatorEmptyStateProps): React.JSX.Element {
  return (
    <div className="flex-1 flex flex-col">
      {/* Welcome message area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center mb-4">
          <Sparkles className="w-5 h-5 text-violet-500" />
        </div>
        <h3 className="text-sm font-medium text-[hsl(var(--foreground))] mb-1">
          {welcomeTitle}
        </h3>
        <p className="text-xs text-[hsl(var(--muted-foreground))] max-w-[280px] leading-relaxed">
          {welcomeDescription}
        </p>

        {/* Suggestion chips — click to send immediately */}
        <div className="flex flex-wrap justify-center gap-1.5 mt-4 max-w-[320px]">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => onSend(suggestion)}
              disabled={isStarting}
              className="px-2.5 py-1 text-[11px] rounded-full border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))] transition-colors disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      {/* Input — reuses ChatHeroInput for full capability parity */}
      <div className="px-3 pb-3">
        <ChatHeroInput
          onSend={onSend}
          disabled={isStarting}
          placeholder={inputPlaceholder}
        />
      </div>
    </div>
  )
}
