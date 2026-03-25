// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  WebContentsView: vi.fn(),
  sessionFromPartition: vi.fn(),
}))

vi.mock('electron', () => ({
  WebContentsView: electronMocks.WebContentsView,
  session: {
    fromPartition: electronMocks.sessionFromPartition,
  },
}))

import { BrowserService } from '../../../electron/browser/browserService'
import type { BrowserCommand, BrowserError } from '../../../electron/browser/types'

interface BrowserServiceHarness {
  service: BrowserService
  dispatch: ReturnType<typeof vi.fn>
  storeGetById: ReturnType<typeof vi.fn>
  executorExecute: ReturnType<typeof vi.fn>
  decoratorStartBorderGlow: ReturnType<typeof vi.fn>
  decoratorDeferStopBorderGlow: ReturnType<typeof vi.fn>
}

function createHarness(): BrowserServiceHarness {
  const dispatch = vi.fn()
  const storeGetById = vi.fn().mockResolvedValue(null)
  const executorExecute = vi.fn()
  const decoratorStartBorderGlow = vi.fn().mockResolvedValue(undefined)
  const decoratorDeferStopBorderGlow = vi.fn()

  const service = new BrowserService({
    dispatch: dispatch as never,
    store: {
      getById: storeGetById,
    } as never,
  })

  ;(service as unknown as {
    managedViews: Map<string, unknown>
  }).managedViews.set('view-1', {
    id: 'view-1',
    profileId: 'profile-1',
    profileName: 'Profile 1',
    view: { webContents: { isDestroyed: () => false } },
    session: {},
    executor: { execute: executorExecute },
    decorator: {
      startBorderGlow: decoratorStartBorderGlow,
      deferStopBorderGlow: decoratorDeferStopBorderGlow,
    },
    interceptor: {},
  })

  return {
    service,
    dispatch,
    storeGetById,
    executorExecute,
    decoratorStartBorderGlow,
    decoratorDeferStopBorderGlow,
  }
}

describe('BrowserService.executeCommand context contract', () => {
  it('forwards cancellation/deadline context to executor unchanged', async () => {
    const harness = createHarness()
    harness.executorExecute.mockResolvedValue({ ok: true })

    const command: BrowserCommand = {
      viewId: 'view-1',
      action: 'evaluate',
      expression: '1 + 1',
    }
    const controller = new AbortController()
    const context = {
      signal: controller.signal,
      deadlineAt: Date.now() + 10_000,
    }

    const result = await harness.service.executeCommand(command, context)

    expect(result).toEqual({ status: 'success', data: { ok: true } })
    expect(harness.executorExecute).toHaveBeenCalledTimes(1)
    expect(harness.executorExecute).toHaveBeenCalledWith(command, context)
    expect(harness.dispatch).toHaveBeenNthCalledWith(1, {
      type: 'browser:command:started',
      payload: { viewId: 'view-1', action: 'evaluate' },
    })
    expect(harness.dispatch).toHaveBeenNthCalledWith(2, {
      type: 'browser:command:completed',
      payload: { viewId: 'view-1', action: 'evaluate', success: true },
    })
    expect(harness.decoratorStartBorderGlow).toHaveBeenCalledTimes(1)
    expect(harness.decoratorDeferStopBorderGlow).toHaveBeenCalledTimes(1)
  })

  it('returns structured error result when executor throws ABORTED', async () => {
    const harness = createHarness()
    const aborted: BrowserError = {
      code: 'ABORTED',
      action: 'evaluate',
      message: 'Command cancelled',
    }
    harness.executorExecute.mockRejectedValue(aborted)

    const result = await harness.service.executeCommand({
      viewId: 'view-1',
      action: 'evaluate',
      expression: 'document.title',
    })

    expect(result).toEqual({
      status: 'error',
      error: aborted,
    })
    expect(harness.dispatch).toHaveBeenNthCalledWith(1, {
      type: 'browser:command:started',
      payload: { viewId: 'view-1', action: 'evaluate' },
    })
    expect(harness.dispatch).toHaveBeenNthCalledWith(2, {
      type: 'browser:command:completed',
      payload: { viewId: 'view-1', action: 'evaluate', success: false },
    })
    expect(harness.decoratorDeferStopBorderGlow).toHaveBeenCalledTimes(1)
  })

  it('fails fast with PAGE_CLOSED when target view does not exist', async () => {
    const dispatch = vi.fn()
    const service = new BrowserService({
      dispatch: dispatch as never,
      store: { getById: vi.fn() } as never,
    })

    const result = await service.executeCommand({
      viewId: 'missing-view',
      action: 'evaluate',
      expression: '42',
    })

    expect(result).toEqual({
      status: 'error',
      error: {
        code: 'PAGE_CLOSED',
        message: 'View missing-view not found',
      },
    })
    expect(dispatch).not.toHaveBeenCalled()
  })
})
