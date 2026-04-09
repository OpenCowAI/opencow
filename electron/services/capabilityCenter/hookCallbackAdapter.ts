// SPDX-License-Identifier: Apache-2.0

/**
 * Hook Callback Adapter — converts declarative Hook JSON to SDK HookCallbacks.
 *
 * v3.1 fixes:
 *   #13 — handles 'prompt' and 'agent' types (v3.0 only had 'command')
 *   #14 — uses HookEvent alias SDKHookEventName to avoid naming conflicts
 *   #20 — executeCommand has timeout control (default 30s)
 *   #31 — returns cleanup() function for signal listener cleanup on session end
 *
 * SDK hook merging is handled by ClaudeCodeAdapter.mergeHooks() — not here.
 */

import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent as SDKHookEventName,
  HookInput,
  SyncHookJSONOutput,
} from '@opencow-ai/opencow-agent-sdk'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createLogger } from '../../platform/logger'

const execFileAsync = promisify(execFile)
const HOOK_TIMEOUT_MS = 30_000
const log = createLogger('HookCallbackAdapter')

// ─── Declarative Hook Types ──────────────────────────────────────────────

export interface DeclarativeHookRule {
  type: 'command' | 'prompt' | 'agent'
  command?: string
  prompt?: string
  async?: boolean
  timeout?: number
}

export interface DeclarativeHookGroup {
  matcher?: string
  hooks: DeclarativeHookRule[]
}

// ─── Adapter ─────────────────────────────────────────────────────────────

export interface AdaptedHooks {
  hooks: Partial<Record<SDKHookEventName, HookCallbackMatcher[]>>
  cleanup: () => void
}

/**
 * Convert declarative hook events → SDK HookCallbackMatcher map.
 * Returns a cleanup function that must be called when the session ends.
 */
export function adaptDeclarativeHooks(
  declarativeEvents: Record<string, DeclarativeHookGroup[]>,
): AdaptedHooks {
  const result: Partial<Record<SDKHookEventName, HookCallbackMatcher[]>> = {}
  const abortCleanups: Array<() => void> = []

  for (const [eventName, groups] of Object.entries(declarativeEvents)) {
    const matchers: HookCallbackMatcher[] = groups.map((group) => ({
      matcher: group.matcher,
      hooks: group.hooks.map((rule) => createCallback(rule, abortCleanups)),
    }))
    result[eventName as SDKHookEventName] = matchers
  }

  return {
    hooks: result,
    cleanup: () => {
      for (const fn of abortCleanups) {
        try {
          fn()
        } catch (err) {
          log.debug('Cleanup listener error (non-critical)', err)
        }
      }
      abortCleanups.length = 0
    },
  }
}

// ─── Internal ────────────────────────────────────────────────────────────

function createCallback(
  rule: DeclarativeHookRule,
  abortCleanups: Array<() => void>,
): HookCallback {
  return async (
    input: HookInput,
    _toolUseID: string | undefined,
    options: { signal: AbortSignal },
  ): Promise<SyncHookJSONOutput> => {
    switch (rule.type) {
      case 'command':
        if (rule.command) {
          try {
            await executeCommand(
              rule.command,
              input,
              options.signal,
              rule.timeout ?? HOOK_TIMEOUT_MS,
              abortCleanups,
            )
          } catch (err) {
            log.warn(`Hook command failed: ${rule.command}`, err)
          }
        }
        break

      case 'prompt':
        // v3.1 #13: inject prompt text as assistant-visible output
        if (rule.prompt) {
          return {
            continue: true,
            systemMessage: rule.prompt,
          } as SyncHookJSONOutput
        }
        break

      case 'agent':
        // Future extension point for agent-type hooks
        break
    }

    return { continue: true }
  }
}

async function executeCommand(
  command: string,
  input: unknown,
  signal: AbortSignal,
  timeoutMs: number,
  abortCleanups: Array<() => void>,
): Promise<void> {
  const controller = new AbortController()

  // Forward parent abort signal to our controller
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  abortCleanups.push(() => signal.removeEventListener('abort', onAbort))

  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    await execFileAsync('sh', ['-c', command], {
      env: {
        ...process.env,
        HOOK_INPUT: JSON.stringify(input),
      },
      timeout: timeoutMs,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}
