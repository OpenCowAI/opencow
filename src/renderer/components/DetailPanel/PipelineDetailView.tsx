// SPDX-License-Identifier: Apache-2.0

import { useScheduleStore } from '@/stores/scheduleStore'
import { Workflow } from 'lucide-react'

export function PipelineDetailView({
  pipelineId
}: {
  pipelineId: string
}): React.JSX.Element {
  const pipeline = useScheduleStore((s) => s.pipelines.find((p) => p.id === pipelineId))

  if (!pipeline) {
    return (
      <div className="flex items-center justify-center h-full text-[hsl(var(--muted-foreground))] text-sm">
        Pipeline not found
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[hsl(var(--border)/0.4)]">
        <div className="flex items-center gap-2">
          <Workflow className="h-4 w-4" aria-hidden="true" />
          <h3 className="font-semibold text-sm">{pipeline.name}</h3>
        </div>
        {pipeline.description && (
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
            {pipeline.description}
          </p>
        )}
      </div>

      {/* Pipeline Info */}
      <div className="px-4 py-3 border-b border-[hsl(var(--border)/0.4)] space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-[hsl(var(--muted-foreground))]">Status</span>
          <span>{pipeline.status}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[hsl(var(--muted-foreground))]">Steps</span>
          <span>{pipeline.steps.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[hsl(var(--muted-foreground))]">Failure Policy</span>
          <span>{pipeline.failurePolicy}</span>
        </div>
      </div>

      {/* Steps */}
      <div className="px-4 py-3 flex-1">
        <h4 className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">
          Steps ({pipeline.steps.length})
        </h4>
        {pipeline.steps.length === 0 ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">No steps configured</p>
        ) : (
          <div className="space-y-2">
            {pipeline.steps.map((step, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 text-xs p-2 rounded border border-[hsl(var(--border)/0.3)]"
              >
                <span className="text-[hsl(var(--muted-foreground))] shrink-0">
                  #{step.order}
                </span>
                <span className="flex-1 truncate">{step.scheduleId}</span>
                <span className="text-[hsl(var(--muted-foreground))] shrink-0">
                  {step.condition.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
