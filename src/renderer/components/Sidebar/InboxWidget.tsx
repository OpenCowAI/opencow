// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/appStore'
import { useInboxStore } from '@/stores/inboxStore'
import { cn } from '@/lib/utils'
import { Inbox } from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'

export function InboxWidget({ collapsed = false }: { collapsed?: boolean }): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const unreadCount = useInboxStore((s) => s.inboxUnreadCount)
  const appView = useAppStore((s) => s.appView)
  const navigateToInbox = useAppStore((s) => s.navigateToInbox)

  const isActive = appView.mode === 'inbox'

  if (collapsed) {
    return (
      <div className="w-full flex justify-center">
        <Tooltip content={t('sidebar.inbox')} position="right" align="center">
          <button
            onClick={() => navigateToInbox()}
            className={cn(
              'relative h-8 w-8 flex items-center justify-center rounded-md transition-colors',
              'text-[hsl(var(--sidebar-foreground)/0.86)] hover:text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-primary)/0.12)]',
              isActive && 'bg-[hsl(var(--sidebar-primary)/0.12)] text-[hsl(var(--sidebar-foreground))]',
            )}
            title={t('sidebar.inbox')}
            aria-label={t('sidebar.inbox')}
          >
            <Inbox className="h-4 w-4 shrink-0" aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-100 px-1 text-[10px] leading-none tabular-nums text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                {unreadCount}
              </span>
            )}
          </button>
        </Tooltip>
      </div>
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
          'group-hover:bg-[hsl(var(--sidebar-primary)/0.08)]',
          isActive && 'font-bold',
        )}
      >
        <Inbox className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{t('sidebar.inbox')}</span>
      </span>
      {unreadCount > 0 && (
        <span className="ml-auto shrink-0 text-xs tabular-nums bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded-full px-1.5 py-0.5">
          {unreadCount}
        </span>
      )}
    </button>
  )
}
