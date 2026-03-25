// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { ChevronDown, ChevronRight, CircleDot, Circle, CheckCircle2 } from 'lucide-react'
import { groupTasksByStatus } from '@shared/taskGrouping'
import type { TaskFull } from '@shared/types'
import { cn } from '@/lib/utils'

const STATUS_ICONS: Record<TaskFull['status'], typeof CircleDot> = {
  in_progress: CircleDot,
  pending: Circle,
  completed: CheckCircle2
}

const STATUS_COLORS: Record<TaskFull['status'], string> = {
  in_progress: 'text-blue-500',
  pending: 'text-[hsl(var(--muted-foreground))]',
  completed: 'text-green-500'
}

function TaskCard({ task }: { task: TaskFull }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const Icon = STATUS_ICONS[task.status]

  return (
    <div className="border border-[hsl(var(--border))] rounded-lg overflow-hidden">
      <button
        className="w-full text-left p-3 flex items-center gap-2 hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`Task: ${task.subject}`}
      >
        <Icon className={cn('h-4 w-4 shrink-0', STATUS_COLORS[task.status])} aria-hidden="true" />
        <span className="flex-1 text-sm truncate min-w-0">
          {task.status === 'in_progress' && task.activeForm
            ? task.activeForm
            : task.subject}
        </span>
        {task.blockedBy.length > 0 && (
          <span className="text-[10px] text-orange-500 shrink-0">
            blocked
          </span>
        )}
        {task.description && (
          expanded
            ? <ChevronDown className="h-3 w-3 shrink-0 text-[hsl(var(--muted-foreground))]" />
            : <ChevronRight className="h-3 w-3 shrink-0 text-[hsl(var(--muted-foreground))]" />
        )}
      </button>

      {expanded && task.description && (
        <div className="px-3 pb-3 border-t border-[hsl(var(--border))] pt-2">
          <p className="text-xs text-[hsl(var(--muted-foreground))] whitespace-pre-wrap leading-relaxed">
            {task.description}
          </p>
          {task.blockedBy.length > 0 && (
            <p className="text-[10px] text-orange-500 mt-2">
              Blocked by: {task.blockedBy.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

interface TaskGroupSectionProps {
  label: string
  tasks: TaskFull[]
  defaultCollapsed: boolean
}

function TaskGroupSection({ label, tasks, defaultCollapsed }: TaskGroupSectionProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-1.5 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))]"
        aria-expanded={!collapsed}
      >
        {collapsed
          ? <ChevronRight className="h-3 w-3" aria-hidden="true" />
          : <ChevronDown className="h-3 w-3" aria-hidden="true" />
        }
        {label} ({tasks.length})
      </button>
      {!collapsed && (
        <div className="space-y-1.5 ml-1">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  )
}

export function TaskListView({ tasks }: { tasks: TaskFull[] }): React.JSX.Element {
  if (tasks.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-8">
        No tasks
      </p>
    )
  }

  const groups = groupTasksByStatus(tasks)

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <TaskGroupSection
          key={group.status}
          label={group.label}
          tasks={group.tasks}
          defaultCollapsed={group.status === 'completed'}
        />
      ))}
    </div>
  )
}
