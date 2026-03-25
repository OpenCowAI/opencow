// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { useStatsStore } from '@/stores/statsStore'
import { DollarSign, Zap, MessageSquare, Wrench } from 'lucide-react'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function StatItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      {icon}
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

export function StatsWidget(): React.JSX.Element | null {
  const { t } = useTranslation('navigation')
  const stats = useStatsStore((s) => s.stats)
  if (!stats) return null

  return (
    <div
      className="px-3 py-2 border-t border-[hsl(var(--sidebar-border))] text-xs text-[hsl(var(--muted-foreground))] space-y-1"
      aria-label="Usage statistics"
    >
      <p className="text-[10px] uppercase tracking-wide font-medium mb-1">{t('stats.today')}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <StatItem
          icon={<DollarSign className="h-3 w-3 shrink-0" aria-hidden="true" />}
          label={t('stats.cost')}
          value={`$${stats.todayCostUSD.toFixed(2)}`}
        />
        <StatItem
          icon={<Zap className="h-3 w-3 shrink-0" aria-hidden="true" />}
          label={t('stats.tokens')}
          value={formatTokens(stats.todayTokens)}
        />
        <StatItem
          icon={<MessageSquare className="h-3 w-3 shrink-0" aria-hidden="true" />}
          label={t('stats.sessions')}
          value={String(stats.todaySessions)}
        />
        <StatItem
          icon={<Wrench className="h-3 w-3 shrink-0" aria-hidden="true" />}
          label={t('stats.toolCalls')}
          value={String(stats.todayToolCalls)}
        />
      </div>
    </div>
  )
}
