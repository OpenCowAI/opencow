// SPDX-License-Identifier: Apache-2.0

import { cn } from '@/lib/utils'
import { SESSION_STATUS_THEME } from '@/constants/sessionStatus'
import type { SessionStatus } from '@shared/types'

const sizeClasses = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5'
} as const

export type StatusDotSize = keyof typeof sizeClasses

interface StatusDotProps {
  status: SessionStatus
  size?: StatusDotSize
  className?: string
}

export function StatusDot({ status, size = 'xs', className }: StatusDotProps): React.JSX.Element {
  const theme = SESSION_STATUS_THEME[status]
  return (
    <span
      className={cn(
        'rounded-full',
        sizeClasses[size],
        theme.dotColor,
        theme.dotAnimation,
        className
      )}
      aria-hidden="true"
    />
  )
}
