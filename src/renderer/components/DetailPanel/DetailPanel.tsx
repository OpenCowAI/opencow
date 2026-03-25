// SPDX-License-Identifier: Apache-2.0

import { useAppStore } from '@/stores/appStore'
import { SessionDetailView } from './SessionDetailView'
import { CapabilityDetailView } from './CapabilityDetailView'
import { CapabilityEditView } from './CapabilityEditView'
import { IssueDetailView } from './IssueDetailView'
import { ScheduleDetailView } from './ScheduleDetailView'
import { PipelineDetailView } from './PipelineDetailView'
import type { DetailContext } from '@shared/types'

/** Exhaustive type guard — will cause a compile error if a new variant is added without handling */
function assertNever(x: never): never {
  throw new Error(`Unhandled DetailContext type: ${(x as { type: string }).type}`)
}

/**
 * Right-hand detail panel — renders the appropriate detail view based on context.
 *
 * Animation: when `detailContext` transitions from `null` → non-null, React mounts
 * a fresh wrapper `<div>` which triggers the `detail-panel-slide-in` CSS animation.
 * When context becomes `null`, the div unmounts — no explicit exit animation needed
 * because the parent Panel's flex-grow transition already handles the collapse.
 */
export function DetailPanel(): React.JSX.Element | null {
  const detailContext = useAppStore((s) => s.detailContext)
  if (!detailContext) return null

  return (
    <div className="detail-panel-slide-in h-full">
      {renderContext(detailContext)}
    </div>
  )
}

function renderContext(ctx: DetailContext): React.JSX.Element {
  switch (ctx.type) {
    case 'session':
      return <SessionDetailView sessionId={ctx.sessionId} />
    case 'issue':
      return <IssueDetailView issueId={ctx.issueId} />
    // Unified capability system (6 managed categories)
    case 'capability':
      return <CapabilityDetailView identifier={ctx.identifier} />
    case 'capability-edit':
      return (
        <CapabilityEditView
          mode="edit"
          category={ctx.identifier.category}
          identifier={ctx.identifier}
        />
      )
    case 'capability-create':
      return (
        <CapabilityEditView
          mode="create"
          category={ctx.category}
          scope={ctx.scope}
          projectId={ctx.projectId}
        />
      )
    case 'schedule':
      return <ScheduleDetailView scheduleId={ctx.scheduleId} />
    case 'pipeline':
      return <PipelineDetailView pipelineId={ctx.pipelineId} />
    default:
      return assertNever(ctx)
  }
}
