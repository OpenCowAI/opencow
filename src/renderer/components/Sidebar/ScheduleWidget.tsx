// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/appStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { cn } from '@/lib/utils'
import { CalendarClock } from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'

export function ScheduleWidget({ collapsed = false }: { collapsed?: boolean }): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const schedules = useScheduleStore((s) => s.schedules)
  const appView = useAppStore((s) => s.appView)
  const setMainTab = useAppStore((s) => s.setMainTab)

  const isActive = appView.mode === 'projects' && appView.tab === 'schedule'
  const activeCount = schedules.filter((s) => s.status === 'active').length

  if (collapsed) {
    return (
      <div className="w-full flex justify-center">
        <Tooltip content={t('sidebar.schedule')} position="right" align="center">
          <button
            onClick={() => setMainTab('schedule')}
            className={cn(
              'relative h-8 w-8 flex items-center justify-center rounded-md transition-colors',
              'text-[hsl(var(--sidebar-foreground)/0.86)] hover:text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-primary)/0.12)]',
              isActive && 'bg-[hsl(var(--sidebar-primary)/0.12)] text-[hsl(var(--sidebar-foreground))]',
            )}
            title={t('sidebar.schedule')}
            aria-label={t('sidebar.schedule')}
          >
            <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
            {activeCount > 0 && (
              <span className="absolute right-0 top-0 text-[10px] tabular-nums bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full px-1 py-0 leading-none">
                {activeCount}
              </span>
            )}
          </button>
        </Tooltip>
      </div>
    )
  }

  return (
    <button
      onClick={() => setMainTab('schedule')}
      className="group w-full flex items-center px-1 py-0.5 text-sm transition-colors"
      aria-label={t('sidebar.schedule')}
    >
      <span
        className={cn(
          'inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 transition-colors min-w-0',
          'group-hover:bg-[hsl(var(--sidebar-primary)/0.08)]',
          isActive && 'font-bold',
        )}
      >
        <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{t('sidebar.schedule')}</span>
      </span>
      {activeCount > 0 && (
        <span className="ml-auto shrink-0 text-xs tabular-nums bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full px-1.5 py-0.5">
          {activeCount}
        </span>
      )}
    </button>
  )
}
