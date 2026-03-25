// SPDX-License-Identifier: Apache-2.0

import { SESSION_STATUS_THEME } from '@/constants/sessionStatus'
import { cn } from '@/lib/utils'
import type { TaskSummary, SessionStatus } from '@shared/types'

type TaskProgressBarVariant = 'default' | 'compact'

interface TaskProgressBarProps {
  taskSummary: TaskSummary
  status: SessionStatus
  variant?: TaskProgressBarVariant
  className?: string
}

export function TaskProgressBar({
  taskSummary,
  status,
  variant = 'default',
  className
}: TaskProgressBarProps): React.JSX.Element | null {
  if (taskSummary.total === 0) return null

  const progress = Math.round((taskSummary.completed / taskSummary.total) * 100)
  const { progressColor } = SESSION_STATUS_THEME[status]

  if (variant === 'compact') {
    return (
      <span className={cn('flex items-center gap-1.5 shrink-0', className)}>
        <span className="tabular-nums text-xs text-[hsl(var(--muted-foreground))]">
          {taskSummary.completed}/{taskSummary.total}
        </span>
        <div
          className="w-16 h-1 rounded-full bg-[hsl(var(--secondary))] overflow-hidden"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Task progress: ${taskSummary.completed} of ${taskSummary.total}`}
        >
          <div
            className={cn('h-full rounded-full transition-[width]', progressColor)}
            style={{ width: `${progress}%` }}
          />
        </div>
      </span>
    )
  }

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))]">
        <span>Tasks</span>
        <span className="tabular-nums">
          {taskSummary.completed}/{taskSummary.total}
        </span>
      </div>
      <div
        className="h-1.5 rounded-full bg-[hsl(var(--secondary))] overflow-hidden"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Task progress: ${taskSummary.completed} of ${taskSummary.total}`}
      >
        <div
          className={cn('h-full rounded-full transition-[width]', progressColor)}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
