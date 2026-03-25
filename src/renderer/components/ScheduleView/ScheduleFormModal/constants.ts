// SPDX-License-Identifier: Apache-2.0

import type { FrequencyType, ActionType, ContextInjectionType } from '@shared/types'

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const DEFAULT_PROMPT_TEMPLATE =
  'Review the current state of the project and provide a concise progress summary. Highlight any blockers or items needing attention.'

// ---------------------------------------------------------------------------
// Frequency presets
// ---------------------------------------------------------------------------

export interface FreqPreset {
  label: string
  labelKey: string
  type: FrequencyType
  intervalMinutes?: number
  timeOfDay?: string
}

export const FREQ_PRESETS: FreqPreset[] = [
  // One-time execution — conceptually distinct from recurring; listed first
  // so users who want "run once" don't have to scroll past recurrence options.
  { label: 'Once',    labelKey: 'frequency.once',   type: 'once' },
  // Recurring
  { label: '5 min',   labelKey: 'frequency.5min',   type: 'interval', intervalMinutes: 5 },
  { label: '15 min',  labelKey: 'frequency.15min',  type: 'interval', intervalMinutes: 15 },
  { label: '30 min',  labelKey: 'frequency.30min',  type: 'interval', intervalMinutes: 30 },
  { label: '1 hour',  labelKey: 'frequency.1hour',  type: 'interval', intervalMinutes: 60 },
  { label: '6 hours', labelKey: 'frequency.6hours', type: 'interval', intervalMinutes: 360 },
  { label: 'Daily',   labelKey: 'frequency.daily',  type: 'daily',    timeOfDay: '09:00' },
  { label: 'Weekly',  labelKey: 'frequency.weekly', type: 'weekly',   timeOfDay: '09:00' },
]

// ---------------------------------------------------------------------------
// Action options
// ---------------------------------------------------------------------------

export const ACTION_OPTIONS: {
  value: ActionType
  labelKey: string
  descriptionKey: string
  /** Fallback label used internally (e.g. for non-i18n contexts). */
  label: string
  description: string
}[] = [
  { value: 'start_session',  labelKey: 'action.types.startSession',      descriptionKey: 'action.types.startSessionDesc',      label: 'Start Session',     description: 'Start a new Claude session with a prompt' },
  { value: 'resume_session', labelKey: 'action.types.resumeSession',     descriptionKey: 'action.types.resumeSessionDesc',     label: 'Resume Session',    description: 'Continue the last session in the project' },
  { value: 'create_issue',   labelKey: 'action.types.createIssue',       descriptionKey: 'action.types.createIssueDesc',       label: 'Create Issue',      description: 'Create a new issue from a template' },
  { value: 'notification',   labelKey: 'action.types.sendNotification',  descriptionKey: 'action.types.sendNotificationDesc',  label: 'Send Notification', description: 'Send an inbox notification' },
]

// ---------------------------------------------------------------------------
// Context injections
// ---------------------------------------------------------------------------

export const CONTEXT_INJECTION_OPTIONS: {
  value: ContextInjectionType
  labelKey: string
  label: string
  /** Short tooltip: what it injects + a one-line usage example. */
  tooltip: string
}[] = [
  {
    value: 'git_diff_24h',
    labelKey: 'contextOptions.gitChanges24h',
    label: 'Git changes (24h)',
    tooltip: 'Inject a summary of all file changes from the past 24 hours (git diff --stat) into the Prompt.\nIdeal for: auto-generating daily "what changed today" progress reports.',
  },
  {
    value: 'git_log_week',
    labelKey: 'contextOptions.gitLogWeek',
    label: 'Git log (week)',
    tooltip: 'Inject this week\'s commit history (git log --oneline) into the Prompt.\nIdeal for: weekly reports, letting the Agent automatically summarize the week\'s development progress.',
  },
  {
    value: 'open_issues',
    labelKey: 'contextOptions.openIssues',
    label: 'Open issues',
    tooltip: 'Inject the list of all open issues in the project into the Prompt.\nIdeal for: letting the Agent prioritize or plan based on the actual to-do list.',
  },
  {
    value: 'last_execution_result',
    labelKey: 'contextOptions.lastResult',
    label: 'Last result',
    tooltip: 'Inject the output from this Schedule\'s last execution into the Prompt.\nIdeal for: continuous tracking tasks, letting the Agent build on previous results.',
  },
  {
    value: 'today_stats',
    labelKey: 'contextOptions.todayStats',
    label: "Today's stats",
    tooltip: 'Inject today\'s statistics (session count, issues completed, etc.) into the Prompt.\nIdeal for: end-of-day reviews, quickly summarizing the day\'s workload.',
  },
  {
    value: 'recent_errors',
    labelKey: 'contextOptions.recentErrors',
    label: 'Recent errors',
    tooltip: 'Inject error messages from recent sessions into the Prompt.\nIdeal for: periodic health checks, letting the Agent automatically analyze and suggest fixes.',
  },
]

// ---------------------------------------------------------------------------
// Event trigger options
// ---------------------------------------------------------------------------

export const EVENT_TRIGGER_OPTIONS: { value: string; labelKey: string; label: string }[] = [
  { value: 'session:idle',         labelKey: 'trigger.events.sessionIdle',       label: 'Session becomes idle' },
  { value: 'session:error',        labelKey: 'trigger.events.sessionError',      label: 'Session encounters error' },
  { value: 'issue:status_changed', labelKey: 'trigger.events.issueStatusChange', label: 'Issue status changes' },
  { value: 'hooks:event',          labelKey: 'trigger.events.webhookEvent',      label: 'Webhook / hook event' },
]

// ---------------------------------------------------------------------------
// Weekday labels
// ---------------------------------------------------------------------------

export const WEEKDAY_LABEL_KEYS = [
  'trigger.weekdays.sun',
  'trigger.weekdays.mon',
  'trigger.weekdays.tue',
  'trigger.weekdays.wed',
  'trigger.weekdays.thu',
  'trigger.weekdays.fri',
  'trigger.weekdays.sat',
] as const

/** @deprecated Use WEEKDAY_LABEL_KEYS with t() instead */
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
