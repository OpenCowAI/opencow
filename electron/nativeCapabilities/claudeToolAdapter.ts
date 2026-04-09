// SPDX-License-Identifier: Apache-2.0

import { tool } from '../integrations/opencowSdkCompat'
import type { AnyZodRawShape, SdkMcpToolDefinition } from '../integrations/opencowSdkCompat'
import type { NativeToolDescriptor } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClaudeToolDefinition = SdkMcpToolDefinition<any>

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function firstStringCandidate(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function pickString(extra: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = firstStringCandidate(extra[key])
    if (value) return value
  }
  return undefined
}

function readNestedRecord(extra: Record<string, unknown>, key: string): Record<string, unknown> {
  return asRecord(extra[key])
}

function extractToolUseId(extra: Record<string, unknown>): string | undefined {
  return (
    pickString(extra, ['tool_use_id', 'toolUseId', 'toolUseID']) ??
    pickString(readNestedRecord(extra, 'request'), ['tool_use_id', 'toolUseId', 'id']) ??
    pickString(readNestedRecord(extra, 'requestInfo'), ['tool_use_id', 'toolUseId', 'id']) ??
    pickString(readNestedRecord(extra, 'context'), ['tool_use_id', 'toolUseId'])
  )
}

function extractInvocationId(extra: Record<string, unknown>): string | undefined {
  return (
    pickString(extra, ['invocation_id', 'invocationId', 'request_id', 'requestId', 'id']) ??
    pickString(readNestedRecord(extra, 'request'), ['invocation_id', 'invocationId', 'request_id', 'requestId', 'id']) ??
    pickString(readNestedRecord(extra, 'requestInfo'), ['invocation_id', 'invocationId', 'request_id', 'requestId', 'id']) ??
    pickString(readNestedRecord(extra, 'context'), ['invocation_id', 'invocationId', 'request_id', 'requestId', 'id'])
  )
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (!value || typeof value !== 'object') return false
  const signal = value as Partial<AbortSignal>
  return (
    typeof signal.aborted === 'boolean' &&
    typeof signal.addEventListener === 'function' &&
    typeof signal.removeEventListener === 'function'
  )
}

export function toClaudeToolDefinition(descriptor: NativeToolDescriptor): ClaudeToolDefinition {
  return tool(
    descriptor.name,
    descriptor.description,
    descriptor.inputSchema as unknown as AnyZodRawShape,
    async (args, extra) => {
      const extraObj = asRecord(extra)
      const signal = isAbortSignal(extraObj.signal) ? extraObj.signal : undefined
      const deadlineAt = typeof extraObj.deadlineAt === 'number' ? extraObj.deadlineAt : undefined
      const toolUseId = extractToolUseId(extraObj)
      const invocationId = extractInvocationId(extraObj) ?? toolUseId

      return descriptor.execute({
        args: args as Record<string, unknown>,
        context: {
          signal,
          deadlineAt,
          engine: 'claude',
          toolUseId,
          invocationId,
        },
      })
    },
  ) as ClaudeToolDefinition
}

export function toClaudeToolDefinitions(descriptors: NativeToolDescriptor[]): ClaudeToolDefinition[] {
  return descriptors.map((descriptor) => toClaudeToolDefinition(descriptor))
}
