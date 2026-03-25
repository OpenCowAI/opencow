// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { ProviderStatusState } from '@shared/types'

interface StatusBadgeProps {
  state: ProviderStatusState | 'unauthenticated'
}

interface BadgeConfig {
  labelKey: string
  className: string
  dotClassName: string
}

const BADGE_CONFIG: Record<StatusBadgeProps['state'], BadgeConfig> = {
  authenticated: {
    labelKey: 'provider.engineConfigStatus.configured',
    className: 'text-emerald-500',
    dotClassName: 'bg-emerald-500',
  },
  authenticating: {
    labelKey: 'provider.engineConfigStatus.authenticating',
    className: 'text-amber-500',
    dotClassName: 'bg-amber-500',
  },
  error: {
    labelKey: 'provider.status.error',
    className: 'text-red-400',
    dotClassName: 'bg-red-400',
  },
  unauthenticated: {
    labelKey: 'provider.engineConfigStatus.notConfigured',
    className: 'text-[hsl(var(--muted-foreground))]',
    dotClassName: 'bg-[hsl(var(--muted-foreground)/0.6)]',
  },
}

export function StatusBadge({ state }: StatusBadgeProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const config = BADGE_CONFIG[state]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap',
        config.className,
      )}
      aria-label={t(config.labelKey)}
      title={t(config.labelKey)}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dotClassName)} aria-hidden="true" />
      {t(config.labelKey)}
    </span>
  )
}
