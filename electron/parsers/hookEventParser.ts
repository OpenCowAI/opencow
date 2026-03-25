// SPDX-License-Identifier: Apache-2.0

import type { HookEvent } from '@shared/types'
import { mapHookEventType } from '../hooks/hookEventMap'

export interface RawHookLogEntry {
  timestamp: string
  uuid?: string
  payload: {
    session_id?: string
    sessionId?: string
    hook_event_name?: string
    hookEventName?: string
    cwd?: string
    tool_name?: string
    [key: string]: unknown
  }
}

export function parseHookLogLine(line: string): HookEvent | null {
  if (!line.trim()) return null

  try {
    const raw: RawHookLogEntry = JSON.parse(line)
    const payload = raw.payload

    const sessionId = payload.session_id || payload.sessionId || ''
    const rawEventName = payload.hook_event_name || payload.hookEventName || 'unknown'

    return {
      timestamp: raw.timestamp,
      rawEventName,
      eventType: mapHookEventType(rawEventName),
      sessionId,
      sourceEventId: typeof raw.uuid === 'string' && raw.uuid.length > 0 ? raw.uuid : null,
      payload
    }
  } catch {
    return null
  }
}

export function parseHookLogContent(content: string): HookEvent[] {
  return content
    .split('\n')
    .map(parseHookLogLine)
    .filter((e): e is HookEvent => e !== null)
}
