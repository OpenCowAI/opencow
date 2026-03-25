// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  PlayCircle,
  StopCircle,
  AlertTriangle,
  CheckCircle2,
  Bell,
  LogOut,
  GitBranchPlus,
  GitMerge
} from 'lucide-react'
import type { HookEvent, HookEventType } from '@shared/types'
import { extractTypedDisplayData } from '@shared/inboxPayloadExtractor'
import { cn } from '@/lib/utils'
import { truncate, graphemeLength } from '@shared/unicode'

const EVENT_ICONS: Record<HookEventType, typeof PlayCircle> = {
  session_start: PlayCircle,
  session_stop: StopCircle,
  session_end: LogOut,
  session_error: AlertTriangle,
  task_completed: CheckCircle2,
  notification: Bell,
  subagent_start: GitBranchPlus,
  subagent_stop: GitMerge,
}

const EVENT_COLORS: Record<HookEventType, string> = {
  session_start: 'text-green-500',
  session_stop: 'text-[hsl(var(--muted-foreground))]',
  session_end: 'text-[hsl(var(--muted-foreground))]',
  session_error: 'text-red-500',
  task_completed: 'text-blue-500',
  notification: 'text-orange-500',
  subagent_start: 'text-violet-500',
  subagent_stop: 'text-violet-400',
}

const EVENT_LABELS: Record<HookEventType, string> = {
  session_start: 'Session Started',
  session_stop: 'Session Stopped',
  session_end: 'Session Ended',
  session_error: 'Error',
  task_completed: 'Task Completed',
  notification: 'Notification',
  subagent_start: 'Subagent Started',
  subagent_stop: 'Subagent Stopped',
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
})

function formatEventTime(timestamp: string): string {
  return timeFormat.format(new Date(timestamp))
}

function formatEventSubtitle(event: HookEvent): string | null {
  if (!event.eventType) return null
  const typed = extractTypedDisplayData(event.eventType, event.payload)

  switch (typed.eventType) {
    case 'session_start': {
      const { source, model, agentType } = typed.data
      const parts = [source, model.replace(/^claude-/, '')]
      if (agentType) parts.push(agentType)
      return parts.join(' \u00B7 ')
    }
    case 'session_stop': {
      const { lastMessage } = typed.data
      if (lastMessage) {
        const firstLine = lastMessage
          .split('\n')
          .find((l) => l.trim())
          ?.trim()
        if (firstLine && graphemeLength(firstLine) > 80) return truncate(firstLine, { max: 80 })
        return firstLine ?? null
      }
      return null
    }
    case 'task_completed': {
      const { taskSubject, teammateName } = typed.data
      if (taskSubject && teammateName) return `${taskSubject} \u00B7 ${teammateName}`
      return taskSubject
    }
    case 'notification': {
      const { message, title } = typed.data
      return message ?? title
    }
    case 'session_error': {
      const { toolName, error } = typed.data
      if (toolName && error) return `${toolName}: ${error}`
      return toolName ?? error
    }
    case 'session_end':
      return typed.data.reason
    case 'subagent_start':
      return typed.data.agentType
    case 'subagent_stop': {
      const { lastMessage: msg } = typed.data
      if (msg) {
        const line = msg.split('\n').find((l) => l.trim())?.trim()
        if (line && graphemeLength(line) > 80) return truncate(line, { max: 80 })
        return line ?? null
      }
      return null
    }
  }
}

function EventCard({ event }: { event: HookEvent }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const eventType = event.eventType!
  const Icon = EVENT_ICONS[eventType]
  const subtitle = formatEventSubtitle(event)
  const hasPayload = Object.keys(event.payload).length > 0

  return (
    <div className="border border-[hsl(var(--border))] rounded-lg overflow-hidden">
      <button
        className="w-full text-left p-3 flex items-start gap-2 hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`${EVENT_LABELS[eventType]} at ${formatEventTime(event.timestamp)}`}
      >
        {hasPayload ? (
          expanded ? (
            <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        <Icon
          className={cn('h-4 w-4 mt-0.5 shrink-0', EVENT_COLORS[eventType])}
          aria-hidden="true"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{EVENT_LABELS[eventType]}</span>
            <span className="text-xs text-[hsl(var(--muted-foreground))] tabular-nums">
              {formatEventTime(event.timestamp)}
            </span>
          </div>
          {subtitle && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </button>

      {expanded && hasPayload && (
        <div className="px-3 pb-3 border-t border-[hsl(var(--border))] pt-2">
          <pre className="text-xs bg-[hsl(var(--muted))] rounded-md p-3 overflow-x-auto font-mono">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

export function EventListView({ events }: { events: HookEvent[] }): React.JSX.Element {
  // Filter to only lifecycle events (eventType !== null) and reverse chronological
  const lifecycleEvents = events
    .filter((e) => e.eventType !== null)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  if (lifecycleEvents.length === 0) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))] text-center py-8">No events</p>
  }

  return (
    <div className="space-y-2">
      {lifecycleEvents.map((event, i) => (
        <EventCard key={`${event.timestamp}-${i}`} event={event} />
      ))}
    </div>
  )
}
