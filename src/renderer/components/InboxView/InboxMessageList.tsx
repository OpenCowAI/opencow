// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useInboxStore } from '@/stores/inboxStore'
import { InboxSearchBar } from './InboxSearchBar'
import { InboxMessageItem } from './InboxMessageItem'
import { Inbox, CheckCheck } from 'lucide-react'
import { formatMessageTitle, formatMessageSubtitle, formatMessageProjectName } from '@shared/inboxFormatters'
import type { InboxMessage, InboxFilter } from '@shared/types'

function filterMessages(messages: InboxMessage[], filter: InboxFilter): InboxMessage[] {
  let filtered = messages

  if (filter.category) {
    filtered = filtered.filter((m) => m.category === filter.category)
  }

  if (filter.status) {
    filtered = filtered.filter((m) => m.status === filter.status)
  }

  if (filter.projectId) {
    filtered = filtered.filter((m) => {
      if (m.category === 'hook_event') return m.projectId === filter.projectId
      if (m.category === 'smart_reminder' && m.reminderType === 'idle_session') {
        return (m.context as { projectId?: string }).projectId === filter.projectId
      }
      if (m.category === 'smart_reminder' && m.reminderType === 'error_spike') {
        return (m.context as { projectId?: string }).projectId === filter.projectId
      }
      return true
    })
  }

  if (filter.search) {
    const q = filter.search.toLowerCase()
    filtered = filtered.filter((m) =>
      formatMessageTitle(m).toLowerCase().includes(q) ||
      formatMessageSubtitle(m).toLowerCase().includes(q) ||
      (formatMessageProjectName(m) ?? '').toLowerCase().includes(q)
    )
  }

  // Sort by createdAt descending
  return [...filtered].sort((a, b) => b.createdAt - a.createdAt)
}

interface InboxMessageListProps {
  selectedMessageId: string | null
  onSelectMessage: (id: string) => void
}

export function InboxMessageList({
  selectedMessageId,
  onSelectMessage
}: InboxMessageListProps): React.JSX.Element {
  const { t } = useTranslation('inbox')
  const messages = useInboxStore((s) => s.inboxMessages)
  const inboxFilter = useInboxStore((s) => s.inboxFilter)
  const unreadCount = useInboxStore((s) => s.inboxUnreadCount)
  const markAllInboxRead = useInboxStore((s) => s.markAllInboxRead)

  const filteredMessages = useMemo(
    () => filterMessages(messages, inboxFilter),
    [messages, inboxFilter]
  )

  const hasFilters = Boolean(inboxFilter.category || inboxFilter.search || inboxFilter.status || inboxFilter.projectId)

  return (
    <div className="h-full flex flex-col" role="listbox" aria-label="Inbox messages">
      {/* Page header — mirrors ProjectsListView / StarredArtifactsView
          (drag-region + title + count + optional action row). No bottom
          border; visual separation comes from padding alone. */}
      <div className="shrink-0">
        <div className="drag-region flex items-start justify-between gap-4 px-5 pt-3 pb-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline gap-2.5">
              <h1 className="text-base font-semibold tracking-tight text-[hsl(var(--foreground))]">
                {t('title')}
              </h1>
              <span className="text-xs text-[hsl(var(--muted-foreground))] tabular-nums">
                {filteredMessages.length}
              </span>
            </div>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={() => markAllInboxRead()}
              className="no-drag flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-xs rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))] transition-colors"
              aria-label={t('markAllReadAria')}
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {t('markAllRead')}
            </button>
          )}
        </div>
      </div>
      <InboxSearchBar />
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {filteredMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[hsl(var(--muted-foreground))] px-4 py-8">
            <Inbox className="h-8 w-8 mb-2 opacity-50" aria-hidden="true" />
            <p className="text-sm">
              {hasFilters ? t('noMessagesMatch') : t('noNotifications')}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredMessages.map((msg) => (
              <InboxMessageItem
                key={msg.id}
                message={msg}
                isSelected={selectedMessageId === msg.id}
                onSelect={() => onSelectMessage(msg.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
