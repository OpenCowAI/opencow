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
      {/* Header */}
      <div className="drag-region border-b border-[hsl(var(--border))] px-4 py-2 flex items-center">
        <h1 className="text-sm font-semibold no-drag">{t('title')}</h1>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllInboxRead()}
            className="no-drag ml-auto flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
            aria-label={t('markAllReadAria')}
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {t('markAllRead')}
          </button>
        )}
      </div>
      <InboxSearchBar />
      <div className="flex-1 overflow-y-auto">
        {filteredMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[hsl(var(--muted-foreground))] px-4 py-8">
            <Inbox className="h-8 w-8 mb-2 opacity-50" aria-hidden="true" />
            <p className="text-sm">
              {hasFilters ? t('noMessagesMatch') : t('noNotifications')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[hsl(var(--border))]">
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
