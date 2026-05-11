// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/appStore'
import { useInboxStore } from '@/stores/inboxStore'
import { cn } from '@/lib/utils'
import { Inbox } from 'lucide-react'
import { InboxFilled } from './FilledIcons'

export function InboxWidget({ collapsed = false }: { collapsed?: boolean }): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const unreadCount = useInboxStore((s) => s.inboxUnreadCount)
  const appView = useAppStore((s) => s.appView)
  const navigateToInbox = useAppStore((s) => s.navigateToInbox)

  const isActive = appView.mode === 'inbox'

  if (collapsed) {
    return (
      <button
        onClick={() => navigateToInbox()}
        className={cn(
          'no-drag relative w-full flex flex-col items-center justify-center gap-1 py-2 rounded-md transition-colors',
          'hover:bg-[hsl(var(--sidebar-primary)/0.08)]',
          isActive
            ? 'text-[hsl(var(--sidebar-foreground))]'
            : 'text-[hsl(var(--sidebar-foreground)/0.86)] hover:text-[hsl(var(--sidebar-foreground))]',
        )}
        aria-label={t('sidebar.inbox')}
      >
        {isActive ? (
          <InboxFilled className="h-4 w-4 shrink-0" />
        ) : (
          <Inbox className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <span className="text-[10px] leading-none">{t('sidebar.inbox')}</span>
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--primary))] px-1 text-[10px] leading-none tabular-nums text-[hsl(var(--primary-foreground))]">
            {unreadCount}
          </span>
        )}
      </button>
    )
  }

  return (
    <button
      onClick={() => navigateToInbox()}
      className="group w-full flex items-center px-1 py-0.5 text-sm transition-colors"
      aria-label={t('sidebar.inbox')}
    >
      <span
        className={cn(
          'inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 transition-colors min-w-0',
          'group-hover:bg-[hsl(var(--sidebar-primary)/0.05)]',
          isActive && 'font-bold',
        )}
      >
        {isActive ? (
          <InboxFilled className="h-4 w-4 shrink-0" />
        ) : (
          <Inbox className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">{t('sidebar.inbox')}</span>
      </span>
      {unreadCount > 0 && (
        <span className="ml-auto shrink-0 text-xs tabular-nums bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] rounded-full px-1.5 py-0.5">
          {unreadCount}
        </span>
      )}
    </button>
  )
}
