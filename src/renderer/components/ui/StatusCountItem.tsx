// SPDX-License-Identifier: Apache-2.0

import { SESSION_STATUS_THEME } from '@/constants/sessionStatus'
import { StatusDot } from '@/components/ui/StatusDot'
import type { SessionStatus } from '@shared/types'
import type { StatusDotSize } from '@/components/ui/StatusDot'

interface StatusCountItemProps {
  status: SessionStatus
  count: number
  hideWhenZero?: boolean
  dotSize?: StatusDotSize
}

export function StatusCountItem({
  status,
  count,
  hideWhenZero = false,
  dotSize = 'xs'
}: StatusCountItemProps): React.JSX.Element | null {
  if (hideWhenZero && count === 0) return null

  const { label } = SESSION_STATUS_THEME[status]
  return (
    <span className="flex items-center gap-1">
      <StatusDot status={status} size={dotSize} />
      {count} {label.toLowerCase()}
    </span>
  )
}
