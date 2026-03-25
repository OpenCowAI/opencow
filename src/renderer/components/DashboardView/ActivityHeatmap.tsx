// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { ResponsiveTimeRange } from '@nivo/calendar'
import type { ActivityDatum } from '@/selectors/dashboardSelectors'

interface ActivityHeatmapProps {
  data: ActivityDatum[]
}

function getDateRange(): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to)
  from.setFullYear(from.getFullYear() - 1)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10)
  }
}

export function ActivityHeatmap({ data }: ActivityHeatmapProps): React.JSX.Element {
  const { t } = useTranslation('dashboard')
  const { from, to } = getDateRange()

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
        <h3 className="text-sm font-medium text-[hsl(var(--foreground))] mb-3">{t('activity.title')}</h3>
        <div className="flex items-center justify-center h-32 text-sm text-[hsl(var(--muted-foreground))]">
          {t('activity.noData')}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <h3 className="text-sm font-medium text-[hsl(var(--foreground))] mb-3">{t('activity.title')}</h3>
      <div className="h-40 w-full" role="img" aria-label={t('activity.aria')}>
        <ResponsiveTimeRange
          data={data}
          from={from}
          to={to}
          emptyColor="hsl(var(--heatmap-empty))"
          colors={[
            'hsl(var(--heatmap-l1))',
            'hsl(var(--heatmap-l2))',
            'hsl(var(--heatmap-l3))',
            'hsl(var(--heatmap-l4))'
          ]}
          margin={{ top: 20, right: 30, bottom: 10, left: 40 }}
          dayBorderWidth={2}
          dayBorderColor="hsl(var(--background))"
          dayRadius={2}
          weekdayTicks={[1, 3, 5]}
          tooltip={({ day, value }) => (
            <div className="bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] text-xs px-2 py-1 rounded shadow-md border border-[hsl(var(--border))] whitespace-nowrap">
              <strong>{day}</strong>: {value ?? 0} {Number(value) !== 1 ? t('activity.sessions') : t('activity.session')}
            </div>
          )}
        />
      </div>
    </div>
  )
}
