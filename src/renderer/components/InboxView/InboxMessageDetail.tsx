// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/appStore'
import { useInboxStore } from '@/stores/inboxStore'
import { selectSchedule as selectScheduleAction } from '@/actions/scheduleActions'
import { navigateToChatSession as navigateToChatSessionAction } from '@/actions/navigationActions'
import {
  formatMessageTitle,
  formatMessageBody,
  formatRelativeTime,
  deriveMessagePriority
} from '@shared/inboxFormatters'
import type { InboxMessage, InboxPriority } from '@shared/types'
import {
  AlertTriangle, Bell, CheckCircle2, Clock,
  ExternalLink, Inbox
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MarkdownContent } from '../ui/MarkdownContent'

const PRIORITY_LABELS: Record<InboxPriority, { labelKey: string; className: string }> = {
  high: {
    labelKey: 'priority.high',
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
  },
  normal: {
    labelKey: 'priority.normal',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
  },
  low: {
    labelKey: 'priority.low',
    className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
  }
}

function MessageIcon({ message }: { message: InboxMessage }): React.JSX.Element {
  if (message.category === 'hook_event') {
    switch (message.eventType) {
      case 'session_error':
        return <AlertTriangle className="h-5 w-5 text-red-500" aria-hidden="true" />
      case 'task_completed':
        return <CheckCircle2 className="h-5 w-5 text-green-500" aria-hidden="true" />
      default:
        return <Bell className="h-5 w-5 text-blue-500" aria-hidden="true" />
    }
  }
  switch (message.reminderType) {
    case 'idle_session':
      return <Clock className="h-5 w-5 text-orange-500" aria-hidden="true" />
    case 'error_spike':
      return <AlertTriangle className="h-5 w-5 text-red-500" aria-hidden="true" />
    case 'daily_summary':
      return <Bell className="h-5 w-5 text-gray-500" aria-hidden="true" />
  }
}

interface InboxMessageDetailProps {
  selectedMessageId: string | null
}

export function InboxMessageDetail({
  selectedMessageId
}: InboxMessageDetailProps): React.JSX.Element {
  const { t } = useTranslation('inbox')
  const messages = useInboxStore((s) => s.inboxMessages)
  const projects = useAppStore((s) => s.projects)
  const markInboxRead = useInboxStore((s) => s.markInboxRead)
  const navigateToIssue = useAppStore((s) => s.navigateToIssue)
  const setMainTab = useAppStore((s) => s.setMainTab)
  const message = useMemo(
    () => messages.find((m) => m.id === selectedMessageId) ?? null,
    [messages, selectedMessageId]
  )

  // Auto-mark as read when message is selected
  useEffect(() => {
    if (message && message.status === 'unread') {
      markInboxRead(message.id)
    }
  }, [message?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!message) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[hsl(var(--muted-foreground))]">
        <Inbox className="h-10 w-10 mb-3 opacity-40" aria-hidden="true" />
        <p className="text-sm">{t('selectMessage')}</p>
      </div>
    )
  }

  const priority = deriveMessagePriority(message)
  const priorityConfig = PRIORITY_LABELS[priority]
  const body = formatMessageBody(message)

  // Resolve project name
  const projectId = message.category === 'hook_event' ? message.projectId : null
  const project = projectId ? projects.find((p) => p.id === projectId) : null
  const navigationTarget = message.category === 'hook_event' ? message.navigationTarget : null

  const handleNavigateFromInbox = (): void => {
    if (!navigationTarget) return

    switch (navigationTarget.kind) {
      case 'issue':
        navigateToIssue(navigationTarget.projectId, navigationTarget.issueId)
        break
      case 'schedule':
        setMainTab('schedule')
        selectScheduleAction(navigationTarget.scheduleId)
        break
      case 'session':
        navigateToChatSessionAction(navigationTarget.projectId, navigationTarget.sessionId)
        break
    }
  }

  const navigationCopy =
    navigationTarget?.kind === 'issue'
      ? { labelKey: 'goToIssue', ariaKey: 'goToIssueAria' }
      : navigationTarget?.kind === 'schedule'
        ? { labelKey: 'goToSchedule', ariaKey: 'goToScheduleAria' }
        : navigationTarget?.kind === 'session'
          ? { labelKey: 'goToSession', ariaKey: 'goToSessionAria' }
          : null

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-[hsl(var(--border))] px-4 py-3">
        <div className="flex items-start gap-3">
          <MessageIcon message={message} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold truncate">
                {formatMessageTitle(message)}
              </h2>
              <span
                className={cn(
                  'px-1.5 py-0.5 text-xs rounded-full shrink-0',
                  priorityConfig.className
                )}
              >
                {t(priorityConfig.labelKey)}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              {project && <span>{project.name}</span>}
              {project && <span aria-hidden="true">|</span>}
              <span>{formatRelativeTime(message.createdAt)}</span>
              <span aria-hidden="true">|</span>
              <span className="capitalize">{message.status}</span>
            </div>
          </div>
          {navigationTarget && navigationCopy && (
            <button
              onClick={handleNavigateFromInbox}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
              aria-label={t(navigationCopy.ariaKey)}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              {t(navigationCopy.labelKey)}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <MarkdownContent content={body} />

        {/* Raw payload for hook events — collapsed by default */}
        {message.category === 'hook_event' && Object.keys(message.rawPayload).length > 0 && (
          <details className="mt-4">
            <summary className="text-xs text-[hsl(var(--muted-foreground))] cursor-pointer hover:text-[hsl(var(--foreground))]">
              {t('rawPayload')}
            </summary>
            <pre className="mt-2 text-xs bg-[hsl(var(--muted))] rounded-md p-3 overflow-x-auto font-mono">
              {JSON.stringify(message.rawPayload, null, 2)}
            </pre>
          </details>
        )}
      </div>

    </div>
  )
}
