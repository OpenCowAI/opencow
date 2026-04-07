// SPDX-License-Identifier: Apache-2.0

import type { BrowserExecutionContext } from '../types'

export interface BrowserSessionExecutionContext {
  readonly projectPath?: string | null
  readonly startupCwd?: string
}

/**
 * Merge runtime execution context (signal/deadline/tool ids) with
 * session-scoped browser context (projectPath/startupCwd).
 */
export function buildBrowserExecutionContext<T extends BrowserExecutionContext>(
  runtimeContext: T,
  sessionContext: BrowserSessionExecutionContext,
): T & BrowserExecutionContext {
  return {
    ...runtimeContext,
    projectPath: sessionContext.projectPath ?? null,
    startupCwd: sessionContext.startupCwd,
  }
}

