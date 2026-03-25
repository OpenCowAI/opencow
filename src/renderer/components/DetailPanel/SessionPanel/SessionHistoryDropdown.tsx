// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History, RotateCcw } from 'lucide-react'
import { SessionStateIndicator } from '../SessionStatusCard'
import { Tooltip } from '../../ui/Tooltip'
import { PillDropdown } from '../../ui/PillDropdown'
import { formatDuration, extractTextContent } from '@/lib/sessionHelpers'
import { useSessionMessages } from '@/hooks/useSessionMessages'
import type { SessionSnapshot, ManagedSessionMessage } from '@shared/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionHistoryDropdownProps {
  /** Archived sessions in chronological order (oldest first). */
  archivedSessions: SessionSnapshot[]
  /** Called when user restores an archived session as the current one. */
  onRestore: (sessionId: string) => void
  /** Called when user clicks to view an archived session (read-only). */
  onView: (sessionId: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSessionDate(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(epochMs))
}

/**
 * Extract a short summary from the first user message in a session.
 * Prefers text content, falls back to "(image)", or null.
 */
function extractSessionSummary(messages: ManagedSessionMessage[]): string | null {
  const firstUserMsg = messages.find((m) => m.role === 'user')
  if (!firstUserMsg) return null

  const text = extractTextContent(firstUserMsg.content)
  if (text) return text.length > 80 ? `${text.slice(0, 80)}…` : text

  const hasImage = firstUserMsg.content.some((b) => b.type === 'image')
  if (hasImage) return '(image)'

  return null
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function SessionHistoryItem({
  session,
  onRestore,
  onView,
}: {
  session: SessionSnapshot
  onRestore: () => void
  onView: () => void
}): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const messages = useSessionMessages(session.id)
  const summary = extractSessionSummary(messages)

  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors">
      {/* Status indicator */}
      <span className="shrink-0 flex items-center">
        <SessionStateIndicator state={session.state} />
      </span>

      {/* Info block — clickable to view */}
      <button
        onClick={onView}
        className="flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] rounded"
      >
        <p className="text-xs text-[hsl(var(--foreground))] truncate">
          {summary ?? t('sessionHistory.noMessages')}
        </p>
        <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
          {formatSessionDate(session.createdAt)}
          {' · '}
          {formatDuration(session.activeDurationMs)}
          {session.model ? ` · ${session.model}` : ''}
        </p>
      </button>

      {/* Restore button — appears on hover */}
      <Tooltip content={t('sessionHistory.restoreTooltip')}>
        <button
          onClick={onRestore}
          className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.08)] transition-all focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
          aria-label={t('sessionHistory.restoreAria')}
        >
          <RotateCcw className="w-2.5 h-2.5" aria-hidden="true" />
          {t('sessionHistory.restore')}
        </button>
      </Tooltip>
    </div>
  )
}

export function SessionHistoryDropdown({
  archivedSessions,
  onRestore,
  onView,
}: SessionHistoryDropdownProps): React.JSX.Element | null {
  const { t } = useTranslation('sessions')
  const [open, setOpen] = useState(false)

  // Nothing to show if no archived sessions
  if (archivedSessions.length === 0) return null

  // Display in reverse chronological order (newest first)
  const displaySessions = [...archivedSessions].reverse()

  // Trigger button — extracted for readability and to avoid tooltip/dropdown conflict
  const triggerButton = (
    <button
      onClick={() => setOpen((prev) => !prev)}
      className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      aria-label={t('sessionHistory.buttonAria', { count: archivedSessions.length })}
    >
      <History className="w-3 h-3" aria-hidden="true" />
      <span>{archivedSessions.length}</span>
    </button>
  )

  return (
    <PillDropdown
      open={open}
      onOpenChange={setOpen}
      position="below"
      align="right"
      trigger={
        // Hide tooltip when dropdown is open to avoid overlapping popups
        open ? triggerButton : (
          <Tooltip content={t('sessionHistory.tooltip')} align="end">
            {triggerButton}
          </Tooltip>
        )
      }
    >
      <div className="p-2 min-w-[300px] max-w-[360px]">
        <p className="px-2 pb-1.5 text-xs font-medium text-[hsl(var(--foreground))]">
          {t('sessionHistory.title')}
        </p>
        <p className="px-2 pb-2 text-[11px] text-[hsl(var(--muted-foreground))]">
          {t('sessionHistory.description')}
        </p>
        <div className="max-h-[240px] overflow-y-auto space-y-0.5">
          {displaySessions.map((s) => (
            <SessionHistoryItem
              key={s.id}
              session={s}
              onRestore={() => {
                setOpen(false)
                onRestore(s.id)
              }}
              onView={() => {
                setOpen(false)
                onView(s.id)
              }}
            />
          ))}
        </div>
      </div>
    </PillDropdown>
  )
}
