// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { FolderOpen } from 'lucide-react'
import {
  formatMessageTitle,
  formatMessageSubtitle,
  formatMessageProjectName,
  formatRelativeTime,
  deriveMessagePriority
} from '@shared/inboxFormatters'
import type { InboxMessage, InboxPriority } from '@shared/types'

const PRIORITY_BADGE: Record<InboxPriority, { labelKey: string; className: string }> = {
  high: {
    labelKey: 'priority.high',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
  },
  normal: {
    labelKey: 'priority.normal',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
  },
  low: {
    labelKey: 'priority.low',
    className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
  }
}

interface InboxMessageItemProps {
  message: InboxMessage
  isSelected: boolean
  onSelect: () => void
}

export function InboxMessageItem({
  message,
  isSelected,
  onSelect
}: InboxMessageItemProps): React.JSX.Element {
  const { t } = useTranslation('inbox')
  const priority = deriveMessagePriority(message)
  const isUnread = message.status === 'unread'
  const title = formatMessageTitle(message)
  const subtitle = formatMessageSubtitle(message)
  const projectName = formatMessageProjectName(message)

  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-left px-3 py-2.5 transition-colors',
        isSelected
          ? 'bg-[hsl(var(--primary)/0.08)]'
          : 'hover:bg-[hsl(var(--foreground)/0.04)]',
        isUnread && 'font-medium'
      )}
      aria-label={`${title}${projectName ? `, ${projectName}` : ''}${isUnread ? ', unread' : ''}`}
      aria-selected={isSelected}
      role="option"
    >
      {/* Row 1: Title + Priority + Timestamp */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className={cn('text-sm truncate', isUnread && 'text-[hsl(var(--foreground))]')}>
            {title}
          </span>
          <span
            className={cn(
              'px-1.5 py-0.5 text-[10px] leading-tight rounded-full shrink-0',
              PRIORITY_BADGE[priority].className
            )}
          >
            {t(PRIORITY_BADGE[priority].labelKey)}
          </span>
        </div>
        <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0 tabular-nums">
          {formatRelativeTime(message.createdAt)}
        </span>
      </div>
      {/* Row 2: Project badge + Subtitle + Unread dot */}
      <div className="flex items-center gap-1.5 mt-0.5">
        {projectName && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] leading-tight rounded bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] shrink-0 max-w-[120px]">
            <FolderOpen className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{projectName}</span>
          </span>
        )}
        <span className="text-xs text-[hsl(var(--muted-foreground))] truncate flex-1">
          {subtitle}
        </span>
        {isUnread && (
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" aria-label="unread" />
        )}
      </div>
    </button>
  )
}
