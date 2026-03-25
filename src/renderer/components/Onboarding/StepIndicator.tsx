// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { StepConfig } from './types'

/** Step indicator dots — shows progress through the onboarding flow. */
export function StepIndicator({ stepNumber: current, totalSteps: total }: StepConfig): React.JSX.Element {
  const { t } = useTranslation('onboarding')

  return (
    <div
      className="flex items-center justify-center gap-1.5 mb-6"
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label={t('common.stepProgress', { current, total })}
    >
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all duration-300',
            i + 1 === current
              ? 'w-6 bg-[hsl(var(--primary))]'
              : i + 1 < current
                ? 'w-1.5 bg-[hsl(var(--primary)/0.5)]'
                : 'w-1.5 bg-[hsl(var(--muted-foreground)/0.2)]'
          )}
        />
      ))}
    </div>
  )
}
