// SPDX-License-Identifier: Apache-2.0

import type {
  DataBusEvent,
  EngineEventEnvelope,
  HookEvent,
  SessionSnapshot,
} from '@shared/types'
import { createHash } from 'crypto'

type CommandSessionIdleEvent = Extract<DataBusEvent, { type: 'command:session:idle' }>
type CommandSessionErrorEvent = Extract<DataBusEvent, { type: 'command:session:error' }>
type CommandSessionStoppedEvent = Extract<DataBusEvent, { type: 'command:session:stopped' }>

let managedEventSequence = 0

export function mapHookEventToEngineEvent(hookEvent: HookEvent): EngineEventEnvelope | null {
  if (!hookEvent.eventType) return null
  const sourceEventId =
    typeof hookEvent.sourceEventId === 'string' && hookEvent.sourceEventId.length > 0
      ? hookEvent.sourceEventId
      : null
  const eventId = sourceEventId
    ? `hook:${sourceEventId}`
    : `hook:${sha256Hex(
        stableStringify({
          timestamp: hookEvent.timestamp,
          rawEventName: hookEvent.rawEventName,
          eventType: hookEvent.eventType,
          sessionId: hookEvent.sessionId,
          payload: hookEvent.payload,
        }),
      )}`
  const occurredAtMs = parseTimestampToMs(hookEvent.timestamp)

  return {
    eventId,
    sourceEventId,
    occurredAtMs,
    source: 'hook',
    timestamp: hookEvent.timestamp,
    rawEventName: hookEvent.rawEventName,
    eventType: hookEvent.eventType,
    sessionRef: hookEvent.sessionId,
    payload: hookEvent.payload,
  }
}

export function mapCommandSessionIdleToEngineEvent(
  event: CommandSessionIdleEvent,
): EngineEventEnvelope {
  const payload = omitUndefined({
    origin: event.payload.origin,
    stopReason: event.payload.stopReason,
    result: event.payload.result,
    costUsd: event.payload.costUsd,
  })
  return createManagedRuntimeEvent({
    kind: 'idle',
    rawEventName: 'Stop',
    eventType: 'session_stop',
    sessionRef: event.payload.sessionId,
    payload,
  })
}

export function mapCommandSessionErrorToEngineEvent(
  event: CommandSessionErrorEvent,
): EngineEventEnvelope {
  const payload = omitUndefined({
    origin: event.payload.origin,
    error: event.payload.error,
  })
  return createManagedRuntimeEvent({
    kind: 'error',
    rawEventName: 'PostToolUseFailure',
    eventType: 'session_error',
    sessionRef: event.payload.sessionId,
    payload,
  })
}

export function mapCommandSessionStoppedToEngineEvent(
  event: CommandSessionStoppedEvent,
): EngineEventEnvelope {
  const payload = omitUndefined({
    origin: event.payload.origin,
    stopReason: event.payload.stopReason,
    result: event.payload.result,
    costUsd: event.payload.costUsd,
  })
  return createManagedRuntimeEvent({
    kind: 'stopped',
    rawEventName: 'Stop',
    eventType: 'session_stop',
    sessionRef: event.payload.sessionId,
    payload,
  })
}

export function mapManagedSessionInfoToSessionStartEngineEvent(
  info: SessionSnapshot,
): EngineEventEnvelope {
  const payload = omitUndefined({
    origin: info.origin,
    model: info.model,
    engineKind: info.engineKind,
    state: info.state,
    projectId: info.projectId,
  })
  return createManagedRuntimeEvent({
    kind: 'start',
    rawEventName: 'SessionStart',
    eventType: 'session_start',
    sessionRef: info.id,
    payload,
  })
}

function omitUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = value
    }
  }
  return output
}

function parseTimestampToMs(timestamp: string): number {
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function createManagedRuntimeEvent(input: {
  kind: 'start' | 'idle' | 'stopped' | 'error'
  rawEventName: EngineEventEnvelope['rawEventName']
  eventType: EngineEventEnvelope['eventType']
  sessionRef: string
  payload: Record<string, unknown>
}): EngineEventEnvelope {
  const occurredAtMs = Date.now()
  const sequence = ++managedEventSequence
  const timestamp = new Date(occurredAtMs).toISOString()
  const eventId = `managed:${input.kind}:${sha256Hex(
    stableStringify({
      sessionRef: input.sessionRef,
      rawEventName: input.rawEventName,
      eventType: input.eventType,
      payload: input.payload,
      occurredAtMs,
      sequence,
    }),
  )}`

  return {
    eventId,
    sourceEventId: null,
    occurredAtMs,
    source: 'managed_runtime',
    timestamp,
    rawEventName: input.rawEventName,
    eventType: input.eventType,
    sessionRef: input.sessionRef,
    payload: input.payload,
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const obj = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortValue(obj[key])
  }
  return sorted
}
