// SPDX-License-Identifier: Apache-2.0

import type {
  InboxMessage,
  InboxPriority,
  HookEventMessage,
  SmartReminderMessage,
  IdleSessionContext,
  ErrorSpikeContext,
  DailySummaryContext
} from './types'
import {
  extractSummary,
  extractTypedDisplayData,
  type SessionStartDisplayData,
  type SessionStopDisplayData,
  type TaskCompletedDisplayData,
  type NotificationDisplayData,
  type SessionErrorDisplayData
} from './inboxPayloadExtractor'
import { truncate } from '@shared/unicode'

/**
 * Derive the display priority for an inbox message.
 * Errors are high priority, daily summaries are low, everything else is normal.
 */
export function deriveMessagePriority(message: InboxMessage): InboxPriority {
  if (message.category === 'hook_event') {
    return message.eventType === 'session_error' ? 'high' : 'normal'
  }

  switch (message.reminderType) {
    case 'error_spike':
      return 'high'
    case 'idle_session':
      return 'normal'
    case 'daily_summary':
      return 'low'
  }
}

// === Event type labels ===

const HOOK_EVENT_LABELS: Record<string, string> = {
  session_error: 'Session Error',
  task_completed: 'Task Completed',
  session_start: 'Session Started',
  session_stop: 'Session Stopped',
  notification: 'Notification'
}

const SMART_REMINDER_LABELS: Record<string, string> = {
  idle_session: 'Idle Session',
  error_spike: 'Error Spike Detected',
  daily_summary: 'Daily Summary'
}

/**
 * Format the event label for an inbox message.
 * Returns only the event type label, e.g., "Session Stopped", "Idle Session".
 * Project context is provided separately by `formatMessageProjectName`.
 */
export function formatMessageTitle(message: InboxMessage): string {
  if (message.category === 'hook_event') {
    return HOOK_EVENT_LABELS[message.eventType] ?? message.eventType
  }

  return SMART_REMINDER_LABELS[message.reminderType] ?? message.reminderType
}

/**
 * Extract the project name associated with an inbox message.
 * Returns null when no project context is available.
 */
export function formatMessageProjectName(message: InboxMessage): string | null {
  if (message.category === 'hook_event') {
    return extractTypedDisplayData(message.eventType, message.rawPayload)?.data?.projectName ?? null
  }

  // Smart reminders with project context
  if (message.category === 'smart_reminder') {
    if ('projectId' in message.context && typeof message.context.projectId === 'string') {
      return message.context.projectId
    }
  }

  return null
}

/** Shorten model name for subtitle display (claude-opus-4-6 → opus-4-6) */
function shortenModelName(model: string): string {
  return model.replace(/^claude-/, '')
}

/** Truncate a string for subtitle display */
function truncateSubtitle(text: string, maxLength: number = 80): string {
  return truncate(text, { max: maxLength })
}

/**
 * Format a one-line subtitle/summary for message list items.
 * Each hook event type extracts its most important fields.
 */
export function formatMessageSubtitle(message: InboxMessage): string {
  if (message.category === 'hook_event') {
    return formatHookEventSubtitle(message)
  }

  switch (message.reminderType) {
    case 'idle_session': {
      const ctx = message.context as IdleSessionContext
      const hours = Math.floor(ctx.idleDurationMs / 3600000)
      return hours > 0 ? `Idle for ${hours}h+` : 'Idle session detected'
    }
    case 'error_spike': {
      const ctx = message.context as ErrorSpikeContext
      return `${ctx.errorCount} errors in ${Math.floor(ctx.windowMs / 60000)}min`
    }
    case 'daily_summary': {
      const ctx = message.context as DailySummaryContext
      return `${ctx.sessionsCompleted} sessions, $${ctx.totalCostUSD.toFixed(2)}`
    }
  }
}

function formatHookEventSubtitle(message: HookEventMessage): string {
  const typed = extractTypedDisplayData(message.eventType, message.rawPayload)
  if (!typed) return message.eventType

  switch (typed.eventType) {
    case 'session_start': {
      const { source, model, agentType } = typed.data
      const parts = [source, shortenModelName(model)]
      if (agentType) parts.push(agentType)
      return parts.join(' \u00B7 ')
    }
    case 'session_stop': {
      const { lastMessage, sessionIdShort } = typed.data
      if (lastMessage) return truncateSubtitle(extractSummary(lastMessage) ?? lastMessage)
      if (sessionIdShort) return `Session ${sessionIdShort}`
      return 'Session completed'
    }
    case 'task_completed': {
      const { taskSubject, teammateName } = typed.data
      if (!taskSubject) return 'Task completed'
      if (teammateName) return truncateSubtitle(`${taskSubject} \u00B7 ${teammateName}`)
      return truncateSubtitle(taskSubject)
    }
    case 'notification': {
      const { message, title } = typed.data
      if (message) return truncateSubtitle(message)
      if (title) return truncateSubtitle(title)
      return 'Notification received'
    }
    case 'session_error': {
      const { toolName, error } = typed.data
      if (toolName && error) return truncateSubtitle(`${toolName} failed: ${error}`)
      if (toolName) return `${toolName} failed`
      return 'Tool execution failed'
    }
    case 'session_end': {
      const { reason } = typed.data
      return reason ? `Ended: ${reason}` : 'Session ended'
    }
    case 'subagent_start': {
      const { agentType } = typed.data
      return agentType ? `Agent: ${agentType}` : 'Subagent started'
    }
    case 'subagent_stop': {
      const { lastMessage: msg } = typed.data
      if (msg) return truncateSubtitle(extractSummary(msg) ?? msg)
      return 'Subagent completed'
    }
  }
}

/**
 * Format the body text for an inbox message detail view.
 * Returns structured, human-readable content instead of raw JSON.
 */
export function formatMessageBody(message: InboxMessage): string {
  if (message.category === 'hook_event') {
    return formatHookEventBody(message)
  }

  return formatSmartReminderBody(message)
}

function formatHookEventBody(message: HookEventMessage): string {
  const typed = extractTypedDisplayData(message.eventType, message.rawPayload)
  if (!typed) return message.eventType

  const { projectName, sessionIdShort, cwd } = typed.data

  let content: string

  switch (typed.eventType) {
    case 'session_start':
      content = formatSessionStartBody(typed.data)
      break
    case 'session_stop':
      content = formatSessionStopBody(typed.data)
      break
    case 'task_completed':
      content = formatTaskCompletedBody(typed.data)
      break
    case 'notification':
      content = formatNotificationBody(typed.data)
      break
    case 'session_error':
      content = formatSessionErrorBody(typed.data)
      break
    case 'session_end':
      content = typed.data.reason ? `**Reason:** ${typed.data.reason}` : 'Session ended'
      break
    case 'subagent_start':
      content = typed.data.agentType ? `**Agent:** ${typed.data.agentType}` : 'Subagent started'
      break
    case 'subagent_stop':
      content = typed.data.lastMessage?.trim() ?? 'Subagent completed'
      break
  }

  return appendMetadataFooter(content, { projectName, sessionIdShort, cwd })
}

function formatSessionStartBody(data: SessionStartDisplayData): string {
  const lines = [`**Source:** ${data.source}`, `**Model:** ${data.model}`]
  if (data.agentType) {
    lines.push(`**Agent:** ${data.agentType}`)
  }
  return lines.join('\n\n')
}

function formatSessionStopBody(data: SessionStopDisplayData): string {
  if (data.lastMessage) return data.lastMessage.trim()
  return 'Session Stopped'
}

function formatTaskCompletedBody(data: TaskCompletedDisplayData): string {
  const lines: string[] = []

  if (data.taskSubject) {
    lines.push(`## ${data.taskSubject}`)
  } else {
    lines.push('Task Completed')
  }

  if (data.taskDescription) {
    lines.push('')
    lines.push(data.taskDescription)
  }

  const meta: string[] = []
  if (data.taskId) meta.push(`**Task ID:** ${data.taskId}`)
  if (data.teammateName) meta.push(`**Teammate:** ${data.teammateName}`)
  if (data.teamName) meta.push(`**Team:** ${data.teamName}`)

  if (meta.length > 0) {
    lines.push('')
    lines.push(meta.join('  \n'))
  }

  return lines.join('\n')
}

function formatNotificationBody(data: NotificationDisplayData): string {
  const lines: string[] = []

  if (data.title) {
    lines.push(`## ${data.title}`)
  }

  if (data.message) {
    lines.push('')
    lines.push(data.message)
  }

  if (data.notificationType) {
    lines.push('')
    lines.push(`**Type:** ${data.notificationType}`)
  }

  if (lines.length === 0) {
    lines.push('Notification received')
  }

  return lines.join('\n')
}

function formatSessionErrorBody(data: SessionErrorDisplayData): string {
  const lines: string[] = []

  if (data.toolName) {
    lines.push(`**Tool:** ${data.toolName}`)
  }

  if (data.toolInput) {
    const command = data.toolInput['command']
    if (typeof command === 'string') {
      lines.push('')
      lines.push('```')
      lines.push(command)
      lines.push('```')
    }
  }

  if (data.error) {
    lines.push('')
    lines.push(data.error)
  }

  if (lines.length === 0) {
    lines.push('Session Error occurred')
  }

  return lines.join('\n')
}

function appendMetadataFooter(
  content: string,
  meta: { projectName: string | null; sessionIdShort: string | null; cwd: string | null }
): string {
  const parts: string[] = []
  if (meta.projectName && meta.cwd) parts.push(`Project: ${meta.projectName} (${meta.cwd})`)
  else if (meta.cwd) parts.push(`Directory: ${meta.cwd}`)
  if (meta.sessionIdShort) parts.push(`Session: ${meta.sessionIdShort}`)

  if (parts.length === 0) return content

  return content + '\n\n---\n' + parts.join('\n')
}

function formatSmartReminderBody(message: SmartReminderMessage): string {
  switch (message.reminderType) {
    case 'idle_session':
      return formatIdleSessionBody(message.context as IdleSessionContext)
    case 'error_spike':
      return formatErrorSpikeBody(message.context as ErrorSpikeContext)
    case 'daily_summary':
      return formatDailySummaryBody(message.context as DailySummaryContext)
  }
}

function formatIdleSessionBody(context: IdleSessionContext): string {
  const totalMinutes = Math.floor(context.idleDurationMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0 && minutes > 0) {
    return `Session has been idle for ${hours}h ${minutes}m`
  }
  if (hours > 0) {
    return `Session has been idle for ${hours}h`
  }
  return `Session has been idle for ${minutes}m`
}

function formatErrorSpikeBody(context: ErrorSpikeContext): string {
  const windowMinutes = Math.floor(context.windowMs / 60000)
  return `${context.errorCount} errors detected in the last ${windowMinutes} minutes for this project`
}

function formatDailySummaryBody(context: DailySummaryContext): string {
  const cost = `$${context.totalCostUSD.toFixed(2)}`
  return `${context.sessionsCompleted} sessions completed, ${context.tasksCompleted} tasks completed. Cost: ${cost}`
}

/**
 * Format a timestamp as a human-readable relative time string.
 * @param timestamp - The timestamp in milliseconds
 * @param now - Optional current time in milliseconds (defaults to Date.now())
 */
export function formatRelativeTime(timestamp: number, now?: number): string {
  const currentTime = now ?? Date.now()
  const diffSeconds = Math.floor((currentTime - timestamp) / 1000)

  if (diffSeconds <= 0) {
    return 'just now'
  }

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`
  }

  if (diffSeconds < 3600) {
    const minutes = Math.floor(diffSeconds / 60)
    return `${minutes}m ago`
  }

  if (diffSeconds < 86400) {
    const hours = Math.floor(diffSeconds / 3600)
    return `${hours}h ago`
  }

  const days = Math.floor(diffSeconds / 86400)
  return `${days}d ago`
}
