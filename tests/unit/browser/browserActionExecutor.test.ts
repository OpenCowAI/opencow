// SPDX-License-Identifier: Apache-2.0

import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserActionExecutor } from '../../../electron/browser/browserActionExecutor'
import type { BrowserError } from '../../../electron/browser/types'

class MockDebugger extends EventEmitter {
  readonly attach = vi.fn()
  readonly detach = vi.fn()
  readonly sendCommand = vi.fn<(...args: unknown[]) => Promise<unknown>>()
}

class MockWebContents extends EventEmitter {
  readonly debugger = new MockDebugger()
  readonly isLoading = vi.fn(() => false)
  readonly goBack = vi.fn()
  readonly goForward = vi.fn()
  readonly reload = vi.fn()
}

function createReadyExecutor(overrides?: {
  isLoading?: () => boolean
  sendCommand?: (...args: unknown[]) => Promise<unknown>
}): {
  executor: BrowserActionExecutor
  webContents: MockWebContents
} {
  const webContents = new MockWebContents()
  if (overrides?.isLoading) {
    webContents.isLoading.mockImplementation(overrides.isLoading)
  }
  if (overrides?.sendCommand) {
    webContents.debugger.sendCommand.mockImplementation(overrides.sendCommand)
  }

  const executor = new BrowserActionExecutor(
    webContents as unknown as WebContents,
    vi.fn(),
  )
  return { executor, webContents }
}

describe('BrowserActionExecutor cancellation/deadline behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('returns ABORTED when cancellation happens during a long-running CDP command', async () => {
    const { executor } = createReadyExecutor({
      sendCommand: async () => new Promise(() => {}),
    })
    await executor.attach()

    const abortController = new AbortController()
    const pending = executor.execute(
      {
        viewId: 'view-1',
        action: 'evaluate',
        expression: 'document.title',
      },
      { signal: abortController.signal },
    )

    abortController.abort()
    await expect(pending).rejects.toMatchObject({
      code: 'ABORTED',
      action: 'Runtime.evaluate',
    } satisfies Partial<BrowserError>)
  })

  it('enforces deadline-clamped timeout for CDP command execution', async () => {
    const { executor } = createReadyExecutor({
      sendCommand: async () => new Promise(() => {}),
    })
    await executor.attach()

    const pending = executor.execute(
      {
        viewId: 'view-2',
        action: 'evaluate',
        expression: '1 + 1',
      },
      { deadlineAt: Date.now() + 25 },
    )
    const outcome = pending.catch((value: unknown) => value as BrowserError)

    await vi.advanceTimersByTimeAsync(30)
    const err = await outcome

    expect(err).toMatchObject({
      code: 'TIMEOUT',
      action: 'Runtime.evaluate',
    })
    if (err.code !== 'TIMEOUT') {
      throw new Error(`Expected TIMEOUT error, received ${err.code}`)
    }
    expect(err.timeoutMs).toBeGreaterThan(0)
    expect(err.timeoutMs).toBeLessThanOrEqual(25)
  })

  it('rejects waitForLoad with TIMEOUT when page never finishes loading', async () => {
    const { executor, webContents } = createReadyExecutor({
      isLoading: () => true,
    })
    await executor.attach()

    const pending = executor.execute(
      {
        viewId: 'view-3',
        action: 'go-back',
      },
      { deadlineAt: Date.now() + 20 },
    )
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'TIMEOUT',
      action: 'wait-for-load',
    } satisfies Partial<BrowserError>)

    await vi.advanceTimersByTimeAsync(25)
    await assertion
    expect(webContents.goBack).toHaveBeenCalledTimes(1)
  })
})
