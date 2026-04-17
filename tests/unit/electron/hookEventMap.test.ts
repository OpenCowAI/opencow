// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import type { HookInput } from '@opencow-ai/opencow-agent-sdk'
import { buildSDKHooks } from '../../../electron/hooks/buildSDKHooks'
import {
  HOOK_EVENT_TYPE_MAP,
  SDK_SIGNAL_HOOK_EVENTS,
  isSignalHookEvent,
  mapHookEventType,
} from '../../../electron/hooks/hookEventMap'

describe('hookEventMap', () => {
  it('maps known raw hook names to canonical event types', () => {
    for (const [rawName, eventType] of Object.entries(HOOK_EVENT_TYPE_MAP)) {
      expect(mapHookEventType(rawName)).toBe(eventType)
    }
  })

  it('returns null for unknown raw hook names', () => {
    expect(mapHookEventType('UnknownEventName')).toBeNull()
  })

  it('classifies signal events from canonical eventType presence', () => {
    expect(
      isSignalHookEvent({
        timestamp: new Date().toISOString(),
        rawEventName: 'SessionStart',
        eventType: 'session_start',
        sessionId: 'sess-1',
        payload: {},
      }),
    ).toBe(true)

    expect(
      isSignalHookEvent({
        timestamp: new Date().toISOString(),
        rawEventName: 'PreToolUse',
        eventType: null,
        sessionId: 'sess-1',
        payload: {},
      }),
    ).toBe(false)
  })
})

describe('buildSDKHooks', () => {
  it('builds callbacks for every configured signal event', () => {
    const hooks = buildSDKHooks(() => undefined, 'fallback-session')
    const registered = Object.keys(hooks).sort()
    const expected = [...SDK_SIGNAL_HOOK_EVENTS].sort()

    expect(registered).toEqual(expected)
  })

  it('dispatches canonical hook event payload for SDK callback', async () => {
    const dispatch = vi.fn()
    const hooks = buildSDKHooks(dispatch, 'fallback-session')
    const callback = hooks.TaskCompleted?.[0]?.hooks?.[0]
    expect(callback).toBeTypeOf('function')

    await callback!(
      {
        session_id: 'sdk-session-1',
        hook_event_name: 'TaskCompleted',
        message: 'done',
      } as unknown as HookInput,
      undefined,
      { signal: new AbortController().signal },
    )

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      type: 'hooks:event',
      payload: expect.objectContaining({
        rawEventName: 'TaskCompleted',
        eventType: 'task_completed',
        sessionId: 'sdk-session-1',
      }),
    })
  })

  it('uses fallback session id and event name when SDK input misses fields', async () => {
    const dispatch = vi.fn()
    const hooks = buildSDKHooks(dispatch, 'fallback-session')
    const callback = hooks.Stop?.[0]?.hooks?.[0]

    const result = await callback!(
      {} as HookInput,
      undefined,
      { signal: new AbortController().signal },
    )

    expect(result).toEqual({ continue: true })
    expect(dispatch).toHaveBeenCalledWith({
      type: 'hooks:event',
      payload: expect.objectContaining({
        rawEventName: 'Stop',
        eventType: 'session_stop',
        sessionId: 'fallback-session',
      }),
    })
  })

  it('never throws from callback when dispatch fails', async () => {
    const dispatch = vi.fn(() => {
      throw new Error('dispatch failed')
    })
    const hooks = buildSDKHooks(dispatch, 'fallback-session')
    const callback = hooks.SessionStart?.[0]?.hooks?.[0]

    await expect(
      callback!(
        { session_id: 'sess-1' } as HookInput,
        undefined,
        { signal: new AbortController().signal },
      ),
    ).resolves.toEqual({ continue: true })
  })
})
