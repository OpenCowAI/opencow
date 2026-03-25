// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { ResponsiveBar } from '@nivo/bar'
import type { ProjectRankingItem } from '@/selectors/dashboardSelectors'

interface ProjectRankingProps {
  data: ProjectRankingItem[]
}

export function ProjectRanking({ data }: ProjectRankingProps): React.JSX.Element | null {
  const { t } = useTranslation('dashboard')
  if (data.length === 0) return null

  // Nivo horizontal bar renders bottom-to-top, so reverse to put highest at top
  const chartData = [...data].reverse().map((d) => ({
    project: d.projectName,
    sessions: d.sessionCount
  }))

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <h3 className="text-sm font-medium text-[hsl(var(--foreground))] mb-3">{t('projects.title')}</h3>
      <div
        className="h-48"
        role="img"
        aria-label={t('projects.aria')}
      >
        <ResponsiveBar
          data={chartData}
          keys={['sessions']}
          indexBy="project"
          layout="horizontal"
          margin={{ top: 0, right: 40, bottom: 10, left: 100 }}
          padding={0.3}
          colors={['hsl(var(--ring))']}
          borderRadius={4}
          enableGridX={false}
          enableGridY={false}
          axisBottom={null}
          axisLeft={{
            tickSize: 0,
            tickPadding: 8
          }}
          labelTextColor="hsl(var(--card))"
          tooltip={({ indexValue, value }) => (
            <div className="bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] text-xs px-2 py-1 rounded shadow-md border border-[hsl(var(--border))]">
              <strong>{indexValue}</strong>: {t('projects.sessionCount', { count: value as number })}
            </div>
          )}
          animate={false}
        />
      </div>
    </div>
  )
}
