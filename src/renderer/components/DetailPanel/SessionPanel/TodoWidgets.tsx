// SPDX-License-Identifier: Apache-2.0

import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckSquare, ListChecks, ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { PillDropdown } from '../../ui/PillDropdown'
import type { TodoWriteItem } from '@shared/types'

// ─── Shared types ─────────────────────────────────────────────────────────────
export type TodoItem = TodoWriteItem

const TODO_STATUS_ICON: Record<string, string> = {
  completed: '✓',
  in_progress: '◉',
  paused: '⏸',
  pending: '○'
}

const TODO_STATUS_CLASS: Record<string, string> = {
  completed: 'text-green-400',
  in_progress: 'text-orange-400',
  paused: 'text-[hsl(var(--muted-foreground)/0.7)]',
  pending: 'text-[hsl(var(--muted-foreground)/0.5)]'
}

/**
 * Resolve the effective visual status for a todo item.
 * When the session is paused (idle/stopped/error), `in_progress` items are
 * shown as `paused` instead — removing the misleading "actively running" indicator.
 */
function effectiveStatus(status: TodoItem['status'], isPaused: boolean): string {
  if (isPaused && status === 'in_progress') return 'paused'
  return status
}

// ─── TodoStats — compact inline summary (e.g. ✓2 ◉1 ○3) ────────────────────

export function TodoStats({ todos, isPaused = false }: { todos: TodoItem[]; isPaused?: boolean }): React.JSX.Element {
  const counts = { completed: 0, in_progress: 0, paused: 0, pending: 0 }
  for (const t of todos) {
    const eff = effectiveStatus(t.status, isPaused)
    const key = eff in counts ? eff : 'pending'
    counts[key as keyof typeof counts]++
  }

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      {counts.completed > 0 && (
        <span className="text-green-400">✓{counts.completed}</span>
      )}
      {counts.in_progress > 0 && (
        <span className="text-orange-400">◉{counts.in_progress}</span>
      )}
      {counts.paused > 0 && (
        <span className="text-[hsl(var(--muted-foreground)/0.7)]">⏸{counts.paused}</span>
      )}
      {counts.pending > 0 && (
        <span className="text-[hsl(var(--muted-foreground)/0.5)]">○{counts.pending}</span>
      )}
    </span>
  )
}

// ─── TodoList — full task list rendering ──────────────────────────────────────

export function TodoList({ todos, isPaused = false }: { todos: TodoItem[]; isPaused?: boolean }): React.JSX.Element {
  const { t } = useTranslation('sessions')
  return (
    <ul className="space-y-0.5" role="list" aria-label={t('sessionPanel.taskList')}>
      {todos.map((todo, i) => {
        const eff = effectiveStatus(todo.status, isPaused)
        const icon = TODO_STATUS_ICON[eff] ?? '○'
        const colorClass = TODO_STATUS_CLASS[eff] ?? TODO_STATUS_CLASS.pending
        const isActive = eff === 'in_progress'
        const isVisuallyPaused = eff === 'paused'

        return (
          <li
            key={i}
            className="flex items-start gap-1.5 text-[13px] px-2 py-0.5 rounded-sm"
          >
            <span className={cn('shrink-0 font-mono select-none', colorClass)} aria-hidden="true">
              {icon}
            </span>
            <span
              className={cn(
                'min-w-0',
                todo.status === 'completed' && 'text-[hsl(var(--muted-foreground)/0.6)] line-through',
                isActive && 'text-[hsl(var(--foreground))] font-medium',
                isVisuallyPaused && 'text-[hsl(var(--muted-foreground)/0.8)]',
                !isActive && !isVisuallyPaused && todo.status !== 'completed' && 'text-[hsl(var(--foreground))]'
              )}
            >
              {isActive && todo.activeForm ? todo.activeForm : todo.content}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

// ─── TodoCard — inline card below TodoWrite tool row ──────────────────────────
//
// A+B design: collapsed by default showing one-line summary with active task;
// expands to show in_progress + pending items, with completed items folded.

export const TodoCard = memo(function TodoCard({
  todos,
  isPaused = false
}: {
  todos: TodoItem[]
  isPaused?: boolean
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)

  // Partition todos
  const activeTodos: TodoItem[] = []
  const pendingTodos: TodoItem[] = []
  const completedTodos: TodoItem[] = []
  for (const t of todos) {
    const eff = effectiveStatus(t.status, isPaused)
    if (eff === 'completed') completedTodos.push(t)
    else if (eff === 'in_progress' || eff === 'paused') activeTodos.push(t)
    else pendingTodos.push(t)
  }

  // The currently active task name (for collapsed summary)
  const activeTask = activeTodos[0]
  const activeLabel = activeTask
    ? (activeTask.activeForm ?? activeTask.content)
    : null

  return (
    <div
      className="max-w-lg rounded-xl border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]"
      role="region"
      aria-label="Task list card"
    >
      {/* Header — always visible, clickable to expand/collapse */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left rounded-xl hover:bg-[hsl(var(--foreground)/0.02)] transition-colors"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn(
            'w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform duration-150',
            expanded && 'rotate-90'
          )}
          aria-hidden="true"
        />
        <CheckSquare className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
        <TodoStats todos={todos} isPaused={isPaused} />
        {/* Show active task name inline when collapsed — use opacity to avoid layout shift */}
        {activeLabel && (
          <span className={cn(
            'flex items-center gap-1.5 min-w-0 transition-opacity duration-100',
            expanded ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
          )}>
            <span className="w-px h-3.5 bg-[hsl(var(--border)/0.4)] shrink-0" aria-hidden="true" />
            <span className="text-[13px] text-[hsl(var(--foreground))] truncate">
              {activeLabel}
            </span>
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-1.5 pb-1.5">
          {/* Active + Pending items */}
          <TodoList todos={[...activeTodos, ...pendingTodos]} isPaused={isPaused} />

          {/* Completed items — collapsed behind a toggle */}
          {completedTodos.length > 0 && (
            <div className="mt-1">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowCompleted((prev) => !prev)
                }}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[hsl(var(--muted-foreground)/0.6)] hover:text-[hsl(var(--muted-foreground))] transition-colors"
              >
                {showCompleted ? (
                  <ChevronDown className="w-2.5 h-2.5" />
                ) : (
                  <ChevronRight className="w-2.5 h-2.5" />
                )}
                {completedTodos.length} completed
              </button>
              {showCompleted && (
                <TodoList todos={completedTodos} isPaused={isPaused} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

// ─── TodoStatusPill — inline pill with popover, embeds into existing bars ─────

export const TodoStatusPill = memo(function TodoStatusPill({
  todos,
  isPaused = false
}: {
  todos: TodoItem[]
  isPaused?: boolean
}): React.JSX.Element {
  const [popoverOpen, setPopoverOpen] = useState(false)

  return (
    <PillDropdown
      open={popoverOpen}
      onOpenChange={setPopoverOpen}
      position="above"
      align="right"
      hoverMode
      trigger={
        <button
          className="flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-full border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--accent-foreground))] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
          aria-label="Toggle task list"
          aria-expanded={popoverOpen}
        >
          <ListChecks className="w-3 h-3" aria-hidden="true" />
          <TodoStats todos={todos} isPaused={isPaused} />
        </button>
      }
    >
      <div className="w-80 max-h-64 flex flex-col">
        {/* Header — fixed at top of popover */}
        <div className="flex items-center gap-1.5 px-4 py-2 pb-1.5 border-b border-[hsl(var(--border)/0.5)] shrink-0">
          <CheckSquare className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          <span className="text-xs font-medium text-[hsl(var(--foreground))]">Tasks</span>
          <span className="ml-auto">
            <TodoStats todos={todos} isPaused={isPaused} />
          </span>
        </div>
        {/* Scrollable task list */}
        <div className="overflow-y-auto min-h-0 p-2">
          <TodoList todos={todos} isPaused={isPaused} />
        </div>
      </div>
    </PillDropdown>
  )
})
