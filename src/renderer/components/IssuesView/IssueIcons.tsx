// SPDX-License-Identifier: Apache-2.0

import {
  Circle,
  CircleDot,
  CircleDashed,
  CheckCircle2,
  XCircle,
  SignalHigh,
  SignalMedium,
  SignalLow,
  AlertTriangle
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { ISSUE_STATUS_THEME, ISSUE_PRIORITY_THEME } from '../../constants/issueStatus'
import type { IssueStatus, IssuePriority } from '@shared/types'
import type { LucideIcon } from 'lucide-react'

/** Status → Lucide icon mapping. Kept here (not in constants) because icon choice is a presentation concern. */
const STATUS_ICONS: Record<IssueStatus, LucideIcon> = {
  backlog: CircleDashed,
  todo: Circle,
  in_progress: CircleDot,
  done: CheckCircle2,
  cancelled: XCircle
}

export function IssueStatusIcon({
  status,
  className
}: {
  status: IssueStatus
  className?: string
}): React.JSX.Element {
  const Icon = STATUS_ICONS[status]
  const { color } = ISSUE_STATUS_THEME[status]
  return <Icon className={cn('w-4 h-4', className, color)} />
}

/** Priority → Lucide icon mapping. */
const PRIORITY_ICONS: Record<IssuePriority, LucideIcon> = {
  urgent: AlertTriangle,
  high: SignalHigh,
  medium: SignalMedium,
  low: SignalLow
}

export function IssuePriorityIcon({
  priority,
  className
}: {
  priority: IssuePriority
  className?: string
}): React.JSX.Element {
  const Icon = PRIORITY_ICONS[priority]
  const { color } = ISSUE_PRIORITY_THEME[priority]
  return <Icon className={cn('w-3.5 h-3.5', className, color)} />
}
