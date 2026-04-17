// SPDX-License-Identifier: Apache-2.0

import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent as SDKHookEventName,
  HookInput,
  SyncHookJSONOutput,
} from '@opencow-ai/opencow-agent-sdk'
import type { DataBusEvent, HookEvent } from '@shared/types'
import { createLogger } from '../platform/logger'
import { mapHookEventType, SDK_SIGNAL_HOOK_EVENTS } from './hookEventMap'
import type { SessionExecutionContextSignal } from '../command/sessionLifecycle'

const log = createLogger('SDKHooks')

type Dispatch = (event: DataBusEvent) => void

/**
 * Signal events that should be routed to the unified `hooks:event` pipeline.
 *
 * Only "signal" events (state changes, notifications, completions) enter
 * the pipeline. High-frequency tool-call events (PreToolUse, PostToolUse)
 * are excluded to avoid noise in Inbox/Webhook/Notification.
 */
const SIGNAL_EVENTS: readonly SDKHookEventName[] = SDK_SIGNAL_HOOK_EVENTS

/**
 * Build SDK `options.hooks` for a managed session.
 *
 * Pure function — stateless, no side effects (except the injected `dispatch`).
 * Each callback converts an SDK HookInput into an OpenCow HookEvent and
 * dispatches it through the DataBus `hooks:event` channel, which feeds
 * Inbox, Webhooks, and Notifications — the same path as CLI hook events.
 *
 * @param dispatch - DataBus dispatch function
 * @param fallbackSessionId - OpenCow managed session ID (used when SDK input lacks session_id)
 */
export function buildSDKHooks(
  dispatch: Dispatch,
  fallbackSessionId: string,
  onExecutionContextSignal?: (signal: SessionExecutionContextSignal) => void,
): Partial<Record<SDKHookEventName, HookCallbackMatcher[]>> {
  const hooks: Partial<Record<SDKHookEventName, HookCallbackMatcher[]>> = {}

  // Track last-seen cwd across all hook callbacks so we can detect changes
  // (e.g. after EnterWorktree). The closure keeps this lightweight — one
  // string comparison per signal event, no extra IPC or file I/O.
  let lastCwd: string | null = null

  for (const eventName of SIGNAL_EVENTS) {
    const callback: HookCallback = async (
      input: HookInput,
      _toolUseID: string | undefined,
      _options: { signal: AbortSignal },
    ): Promise<SyncHookJSONOutput> => {
      try {
        const hookEvent: HookEvent = {
          timestamp: new Date().toISOString(),
          rawEventName:
            (input as { hook_event_name?: string }).hook_event_name ?? eventName,
          eventType: mapHookEventType(eventName),
          sessionId: input.session_id || fallbackSessionId,
          payload: input as unknown as Record<string, unknown>,
        }
        dispatch({ type: 'hooks:event', payload: hookEvent })

        // Detect cwd changes across hook events (e.g. after EnterWorktree).
        // BaseHookInput carries `cwd` on every event — compare to last-seen
        // value and fire the callback only when it actually changes.
        if (onExecutionContextSignal) {
          const cwd = (input as { cwd?: string }).cwd
          if (cwd && cwd !== lastCwd) {
            lastCwd = cwd
            onExecutionContextSignal({
              cwd,
              source: 'hook',
              occurredAtMs: Date.now(),
            })
          }
        }
      } catch (err) {
        // Callback errors must NEVER propagate to the SDK — they would
        // terminate the session. Log and swallow.
        log.error(`Hook callback error for ${eventName}`, err)
      }

      // Always continue — OpenCow hooks are observational, never blocking.
      return { continue: true }
    }

    hooks[eventName] = [{ hooks: [callback] }]
  }

  return hooks
}
