// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { buildBrowserExecutionContext } from '../../../electron/browser/upload'

describe('buildBrowserExecutionContext', () => {
  it('merges runtime context with session-scoped projectPath/startupCwd', () => {
    const controller = new AbortController()
    const deadlineAt = Date.now() + 5000

    const result = buildBrowserExecutionContext(
      {
        signal: controller.signal,
        deadlineAt,
      },
      {
        projectPath: '/tmp/project',
        startupCwd: '/tmp/project/worktree',
      },
    )

    expect(result.signal).toBe(controller.signal)
    expect(result.deadlineAt).toBe(deadlineAt)
    expect(result.projectPath).toBe('/tmp/project')
    expect(result.startupCwd).toBe('/tmp/project/worktree')
  })

  it('normalizes missing projectPath to null', () => {
    const result = buildBrowserExecutionContext(
      {},
      {
        projectPath: undefined,
        startupCwd: undefined,
      },
    )

    expect(result.projectPath).toBeNull()
    expect(result.startupCwd).toBeUndefined()
  })
})

