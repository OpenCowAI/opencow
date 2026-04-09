// SPDX-License-Identifier: Apache-2.0

import type { HookEvent, HookEventType } from '@shared/types'
import type { HookEvent as SDKHookEventName } from '@opencow-ai/opencow-agent-sdk'

/**
 * Canonical SDK/CLI hook name -> domain HookEventType map.
 * This is the single source of truth used by all hook-event producers.
 */
export const HOOK_EVENT_TYPE_MAP: Record<string, HookEventType> = {
  SessionStart: 'session_start',
  Stop: 'session_stop',
  SessionEnd: 'session_end',
  PostToolUseFailure: 'session_error',
  TaskCompleted: 'task_completed',
  Notification: 'notification',
  SubagentStart: 'subagent_start',
  SubagentStop: 'subagent_stop',
}

/**
 * SDK signal events routed into the unified DataBus `hooks:event` pipeline.
 * Operational high-frequency events are intentionally excluded.
 */
export const SDK_SIGNAL_HOOK_EVENTS: readonly SDKHookEventName[] = [
  'SessionStart',
  'Stop',
  'SessionEnd',
  'Notification',
  'TaskCompleted',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
]

export function mapHookEventType(rawEventName: string): HookEventType | null {
  return HOOK_EVENT_TYPE_MAP[rawEventName] ?? null
}

export function isSignalHookEvent(event: HookEvent): boolean {
  return event.eventType !== null
}
