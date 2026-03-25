// SPDX-License-Identifier: Apache-2.0

/**
 * asyncUtils — Safe async patterns for fire-and-forget operations.
 *
 * Provides `fireAndForget` to explicitly mark intentional fire-and-forget
 * calls with consistent error logging, preventing unhandled promise rejections.
 */

import { createLogger } from '@/lib/logger'

const log = createLogger('AsyncUtils')

/**
 * Safely execute a promise without awaiting its result.
 *
 * Use this when the caller intentionally does not need the result or
 * to block on completion, but rejections must still be caught.
 * All rejections are logged with the provided context label.
 *
 * @param promise  The promise to run in the background.
 * @param context  A short label for error logs (e.g. 'loadIssues').
 *
 * @example
 *   fireAndForget(store.loadIssues(), 'loadIssues')
 */
export function fireAndForget(promise: Promise<unknown>, context: string): void {
  promise.catch((error: unknown) => {
    log.error(`Fire-and-forget rejection [${context}]`, error)
  })
}
