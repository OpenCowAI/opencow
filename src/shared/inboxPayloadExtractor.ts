// SPDX-License-Identifier: Apache-2.0

/**
 * Extracts structured display data from raw hook event payloads.
 *
 * Hook event payloads from Claude Code contain rich contextual data
 * (cwd, session_id, last_assistant_message, etc.) that needs to be
 * extracted into a human-readable format for the Inbox UI.
 */

import type { HookEventType } from './types'
import { truncate, graphemeLength } from '@shared/unicode'

export interface HookEventDisplayData {
  projectName: string | null
  sessionIdShort: string | null
  summary: string | null
  cwd: string | null
}

/**
 * Extract the project name from a working directory path.
 * e.g., "/Users/foo/workspace/opencow" → "opencow"
 */
export function extractProjectName(cwd: string | undefined | null): string | null {
  if (!cwd || typeof cwd !== 'string') return null
  const trimmed = cwd.replace(/\/+$/, '')
  const lastSlash = trimmed.lastIndexOf('/')
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed
}

/**
 * Shorten a session ID to a readable 8-character prefix.
 * e.g., "a50dddd6-b25a-4f4e-b4ef-0442b5ba089b" → "a50dddd6"
 */
export function shortenSessionId(sessionId: string | undefined | null): string | null {
  if (!sessionId || typeof sessionId !== 'string') return null
  return sessionId.slice(0, 8)
}

/**
 * Extract a one-line summary from the last assistant message.
 * Takes the first non-empty line and truncates to maxLength.
 */
export function extractSummary(
  lastMessage: string | undefined | null,
  maxLength: number = 100
): string | null {
  if (!lastMessage || typeof lastMessage !== 'string') return null

  // Find first non-empty line
  const lines = lastMessage.split('\n')
  const firstLine = lines.find((line) => line.trim().length > 0)
  if (!firstLine) return null

  const trimmed = firstLine.trim()
  if (graphemeLength(trimmed) <= maxLength) return trimmed
  return truncate(trimmed, { max: maxLength })
}

/**
 * Extract structured display data from a raw hook event payload.
 */
export function extractHookEventDisplayData(
  payload: Record<string, unknown>
): HookEventDisplayData {
  return {
    projectName: extractProjectName(payload['cwd'] as string | undefined),
    sessionIdShort: shortenSessionId(payload['session_id'] as string | undefined),
    summary: extractSummary(payload['last_assistant_message'] as string | undefined),
    cwd: typeof payload['cwd'] === 'string' ? payload['cwd'] : null
  }
}

// === Per-Type Display Data ===

interface DisplayDataBase {
  projectName: string | null
  sessionIdShort: string | null
  cwd: string | null
}

export interface SessionStartDisplayData extends DisplayDataBase {
  source: string
  model: string
  agentType: string | null
}

export interface SessionStopDisplayData extends DisplayDataBase {
  lastMessage: string | null
}

export interface TaskCompletedDisplayData extends DisplayDataBase {
  taskId: string | null
  taskSubject: string | null
  taskDescription: string | null
  teammateName: string | null
  teamName: string | null
}

export interface NotificationDisplayData extends DisplayDataBase {
  title: string | null
  message: string | null
  notificationType: string | null
}

export interface SessionErrorDisplayData extends DisplayDataBase {
  toolName: string | null
  toolInput: Record<string, unknown> | null
  error: string | null
}

export interface SessionEndDisplayData extends DisplayDataBase {
  reason: string | null
}

export interface SubagentStartDisplayData extends DisplayDataBase {
  agentType: string | null
}

export interface SubagentStopDisplayData extends DisplayDataBase {
  lastMessage: string | null
}

export type TypedHookDisplayData =
  | { eventType: 'session_start'; data: SessionStartDisplayData }
  | { eventType: 'session_stop'; data: SessionStopDisplayData }
  | { eventType: 'session_end'; data: SessionEndDisplayData }
  | { eventType: 'task_completed'; data: TaskCompletedDisplayData }
  | { eventType: 'notification'; data: NotificationDisplayData }
  | { eventType: 'session_error'; data: SessionErrorDisplayData }
  | { eventType: 'subagent_start'; data: SubagentStartDisplayData }
  | { eventType: 'subagent_stop'; data: SubagentStopDisplayData }

function extractBase(payload: Record<string, unknown>): DisplayDataBase {
  return {
    projectName: extractProjectName(payload['cwd'] as string | undefined),
    sessionIdShort: shortenSessionId(payload['session_id'] as string | undefined),
    cwd: typeof payload['cwd'] === 'string' ? payload['cwd'] : null
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Extract per-event-type display data from a raw hook event payload.
 * Unlike `extractHookEventDisplayData` which extracts the same fields for all types,
 * this function extracts the most important fields specific to each event type.
 */
export function extractTypedDisplayData(
  eventType: HookEventType,
  payload: Record<string, unknown>
): TypedHookDisplayData {
  const base = extractBase(payload)

  switch (eventType) {
    case 'session_start':
      return {
        eventType,
        data: {
          ...base,
          source: str(payload['source']) ?? 'startup',
          model: str(payload['model']) ?? 'unknown',
          agentType: str(payload['agent_type'])
        }
      }
    case 'session_stop':
      return {
        eventType,
        data: {
          ...base,
          lastMessage: str(payload['last_assistant_message'])
        }
      }
    case 'task_completed':
      return {
        eventType,
        data: {
          ...base,
          taskId: str(payload['task_id']),
          taskSubject: str(payload['task_subject']),
          taskDescription: str(payload['task_description']),
          teammateName: str(payload['teammate_name']),
          teamName: str(payload['team_name'])
        }
      }
    case 'notification':
      return {
        eventType,
        data: {
          ...base,
          title: str(payload['title']),
          message: str(payload['message']),
          notificationType: str(payload['notification_type'])
        }
      }
    case 'session_error':
      return {
        eventType,
        data: {
          ...base,
          toolName: str(payload['tool_name']),
          toolInput:
            payload['tool_input'] != null && typeof payload['tool_input'] === 'object'
              ? (payload['tool_input'] as Record<string, unknown>)
              : null,
          error: str(payload['error'])
        }
      }
    case 'session_end':
      return {
        eventType,
        data: {
          ...base,
          reason: str(payload['reason'])
        }
      }
    case 'subagent_start':
      return {
        eventType,
        data: {
          ...base,
          agentType: str(payload['agent_type'])
        }
      }
    case 'subagent_stop':
      return {
        eventType,
        data: {
          ...base,
          lastMessage: str(payload['last_assistant_message'])
        }
      }
  }
}
