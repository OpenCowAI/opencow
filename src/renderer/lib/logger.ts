// SPDX-License-Identifier: Apache-2.0

import type { Logger, LogLevel, LogEntry } from '@shared/logger'
import { getAppAPI } from '@/windowAPI'

/**
 * Create a scoped Logger for a renderer module.
 *
 * Logs are sent to the main process via IPC fire-and-forget,
 * where they are formatted and written to the log file alongside
 * main-process logs. The scope is prefixed with `renderer:` on
 * the main side.
 *
 * @example
 * const log = createLogger('Settings')
 * log.info('Settings updated')
 * log.error('Failed to persist', err)
 */
export function createLogger(scope: string): Logger {
  function log(level: LogLevel, message: string, context: unknown[]): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      scope,
      message,
      context: context.length > 0 ? serializeContext(context) : undefined,
    }

    // Fire-and-forget IPC — logger must never throw
    try {
      const maybePromise = getAppAPI()['log:write']?.(entry)
      if (maybePromise && typeof maybePromise.catch === 'function') {
        void maybePromise.catch(() => {})
      }
    } catch {
      // no-op: renderer logging is best-effort and must not crash callsites
    }

    // DEV mode: also output to browser DevTools console for immediate feedback
    if (import.meta.env.DEV) {
      const fn =
        level === 'error'
          ? console.error
          : level === 'warn'
            ? console.warn
            : console.log
      fn(`[${scope}] ${message}`, ...context)
    }
  }

  return {
    debug: (msg, ...ctx) => log('debug', msg, ctx),
    info: (msg, ...ctx) => log('info', msg, ctx),
    warn: (msg, ...ctx) => log('warn', msg, ctx),
    error: (msg, ...ctx) => log('error', msg, ctx),
    child: (subscope) => createLogger(`${scope}:${subscope}`),
  }
}

/** Convert context items to IPC-safe format (Error objects are not serializable) */
function serializeContext(context: unknown[]): unknown[] {
  return context.map((a) => {
    if (a instanceof Error) {
      return { __error: true, message: a.message, stack: a.stack }
    }
    return a
  })
}
