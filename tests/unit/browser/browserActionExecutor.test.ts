// SPDX-License-Identifier: Apache-2.0

import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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

// ── Helpers ─────────────────────────────────────────────────────────

/** Collect all Input.dispatchKeyEvent calls from the mock sendCommand. */
function keyEvents(webContents: MockWebContents) {
  return webContents.debugger.sendCommand.mock.calls
    .filter(([method]) => method === 'Input.dispatchKeyEvent')
    .map(([_method, params]) => params as Record<string, unknown>)
}

// ── Type key-dispatch tests ─────────────────────────────────────────

describe('BrowserActionExecutor type / dispatchChar', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Helper that creates an executor wired up for `type` commands.
   * The mock sendCommand handles the selector resolution + box-model CDP
   * calls so that `click()` succeeds, and then we can inspect the
   * `Input.dispatchKeyEvent` calls that follow.
   */
  function createTypingExecutor() {
    const webContents = new MockWebContents()
    const nodeId = 42
    const sendCommand = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      async (method: unknown) => {
        switch (method) {
          case 'DOM.getDocument':
            return { root: { nodeId: 1 } }
          case 'DOM.querySelector':
            return { nodeId }
          case 'DOM.getBoxModel':
            return { model: { content: [0, 0, 100, 0, 100, 100, 0, 100] } }
          case 'Input.dispatchMouseEvent':
          case 'Input.dispatchKeyEvent':
            return {}
          default:
            return {}
        }
      },
    )
    webContents.debugger.sendCommand.mockImplementation(sendCommand)

    const executor = new BrowserActionExecutor(
      webContents as unknown as WebContents,
      vi.fn(),
    )
    return { executor, webContents }
  }

  it('dispatches Enter key events for newline characters', async () => {
    const { executor, webContents } = createTypingExecutor()
    await executor.attach()

    await executor.execute({
      viewId: 'v1',
      action: 'type',
      selector: 'textarea',
      text: 'a\nb',
    })

    const events = keyEvents(webContents)

    // 'a' → keyDown + keyUp, '\n' → Enter keyDown + keyUp, 'b' → keyDown + keyUp = 6
    expect(events).toHaveLength(6)

    // First char: 'a'
    expect(events[0]).toMatchObject({ type: 'keyDown', text: 'a' })
    expect(events[1]).toMatchObject({ type: 'keyUp', text: 'a' })

    // Second char: '\n' should produce Enter key with full metadata
    expect(events[2]).toMatchObject({
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      text: '\r',
      windowsVirtualKeyCode: 13,
    })
    expect(events[3]).toMatchObject({
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
    })

    // Third char: 'b'
    expect(events[4]).toMatchObject({ type: 'keyDown', text: 'b' })
    expect(events[5]).toMatchObject({ type: 'keyUp', text: 'b' })
  })

  it('dispatches Enter key events for carriage-return characters', async () => {
    const { executor, webContents } = createTypingExecutor()
    await executor.attach()

    await executor.execute({
      viewId: 'v1',
      action: 'type',
      selector: 'textarea',
      text: 'x\ry',
    })

    const events = keyEvents(webContents)
    expect(events[2]).toMatchObject({
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      text: '\r',
      windowsVirtualKeyCode: 13,
    })
  })

  it('dispatches Tab key events for tab characters', async () => {
    const { executor, webContents } = createTypingExecutor()
    await executor.attach()

    await executor.execute({
      viewId: 'v1',
      action: 'type',
      selector: 'input',
      text: 'a\tb',
    })

    const events = keyEvents(webContents)
    expect(events[2]).toMatchObject({
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
    })
  })

  it('normalises CRLF to a single Enter (no double-Enter)', async () => {
    const { executor, webContents } = createTypingExecutor()
    await executor.attach()

    // Windows-style line endings: \r\n should produce exactly ONE Enter per line break
    await executor.execute({
      viewId: 'v1',
      action: 'type',
      selector: 'textarea',
      text: 'line1\r\nline2\r\nline3',
    })

    const enterDownEvents = keyEvents(webContents).filter(
      (e) => e.key === 'Enter' && e.type === 'keyDown',
    )
    // Two line breaks (\r\n × 2) → exactly 2 Enter keyDown events
    expect(enterDownEvents).toHaveLength(2)
  })

  it('handles multi-line markdown text with preserved newlines', async () => {
    const { executor, webContents } = createTypingExecutor()
    await executor.attach()

    const markdown = '# Title\n\nParagraph 1\nParagraph 2'
    await executor.execute({
      viewId: 'v1',
      action: 'type',
      selector: 'textarea',
      text: markdown,
    })

    const enterEvents = keyEvents(webContents).filter(
      (e) => e.key === 'Enter' && e.type === 'keyDown',
    )
    // '# Title' \n \n 'Paragraph 1' \n 'Paragraph 2' → 3 Enter keyDown events
    expect(enterEvents).toHaveLength(3)
  })
})

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

describe('BrowserActionExecutor upload', () => {
  it('uploads files via selector with DOM.setFileInputFiles', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-upload-root-'))
    const filePath = path.join(rootDir, 'avatar.png')
    await fs.writeFile(filePath, 'upload-content')
    const realFilePath = await fs.realpath(filePath)

    const webContents = new MockWebContents()
    const sendCommand = vi.fn<(...args: unknown[]) => Promise<unknown>>(async (method, params) => {
      switch (method) {
        case 'DOM.getDocument':
          return { root: { nodeId: 1 } }
        case 'DOM.querySelector':
          return { nodeId: 42 }
        case 'DOM.describeNode': {
          const p = params as { nodeId?: number; backendNodeId?: number }
          if (p.nodeId === 42) {
            return { node: { backendNodeId: 777 } }
          }
          if (p.backendNodeId === 777) {
            return { node: { nodeName: 'INPUT', attributes: ['type', 'file'] } }
          }
          return {}
        }
        case 'DOM.setFileInputFiles':
          return {}
        default:
          return {}
      }
    })
    webContents.debugger.sendCommand.mockImplementation(sendCommand)

    const executor = new BrowserActionExecutor(webContents as unknown as WebContents, vi.fn())
    await executor.attach()

    const result = await executor.execute(
      {
        viewId: 'v1',
        action: 'upload',
        target: { kind: 'css', selector: '#file' },
        files: [filePath],
      },
      { projectPath: rootDir, startupCwd: rootDir },
    ) as { uploaded: number; files: string[] }

    expect(result.uploaded).toBe(1)
    expect(result.files).toEqual([realFilePath])
    expect(sendCommand).toHaveBeenCalledWith(
      'DOM.setFileInputFiles',
      expect.objectContaining({
        backendNodeId: 777,
        files: [realFilePath],
      }),
    )
  })

  it('uploads files via snapshot ref selector', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-upload-root-ref-'))
    const filePath = path.join(rootDir, 'doc.txt')
    await fs.writeFile(filePath, 'upload-ref')
    const realFilePath = await fs.realpath(filePath)

    const webContents = new MockWebContents()
    const sendCommand = vi.fn<(...args: unknown[]) => Promise<unknown>>(async (method, params) => {
      switch (method) {
        case 'Accessibility.enable':
        case 'DOM.enable':
          return {}
        case 'Accessibility.getFullAXTree':
          return {
            nodes: [
              {
                nodeId: '1',
                role: { type: 'string', value: 'RootWebArea' },
                name: { type: 'string', value: 'Root' },
                childIds: ['2'],
              },
              {
                nodeId: '2',
                role: { type: 'string', value: 'button' },
                name: { type: 'string', value: 'Upload' },
                backendDOMNodeId: 900,
              },
            ],
          }
        case 'Runtime.evaluate': {
          const p = params as { expression?: string }
          if (typeof p.expression === 'string' && p.expression.includes('({url:location.href,title:document.title})')) {
            return { result: { value: { url: 'https://example.com', title: 'Example' } } }
          }
          return { result: { value: [] } }
        }
        case 'DOM.querySelectorAll':
          return { nodeIds: [] }
        case 'DOM.describeNode': {
          const p = params as { backendNodeId?: number }
          if (p.backendNodeId === 900) {
            return { node: { nodeName: 'INPUT', attributes: ['type', 'file'] } }
          }
          return {}
        }
        case 'DOM.setFileInputFiles':
          return {}
        default:
          return {}
      }
    })
    webContents.debugger.sendCommand.mockImplementation(sendCommand)

    const executor = new BrowserActionExecutor(webContents as unknown as WebContents, vi.fn())
    await executor.attach()

    await executor.execute(
      {
        viewId: 'v1',
        action: 'snapshot',
      },
      { projectPath: rootDir, startupCwd: rootDir },
    )

    const result = await executor.execute(
      {
        viewId: 'v1',
        action: 'upload',
        target: { kind: 'ref', ref: 'e1' },
        files: [filePath],
      },
      { projectPath: rootDir, startupCwd: rootDir },
    ) as { uploaded: number; target: string }

    expect(result.uploaded).toBe(1)
    expect(result.target).toBe('e1')
    expect(sendCommand).toHaveBeenCalledWith(
      'DOM.setFileInputFiles',
      expect.objectContaining({
        backendNodeId: 900,
        files: [realFilePath],
      }),
    )
  })

  it('rejects upload when projectPath context is missing', async () => {
    const webContents = new MockWebContents()
    webContents.debugger.sendCommand.mockImplementation(async (method, params) => {
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
      if (method === 'DOM.querySelector') return { nodeId: 42 }
      if (method === 'DOM.describeNode') {
        const p = params as { nodeId?: number; backendNodeId?: number }
        if (p.nodeId === 42) return { node: { backendNodeId: 777 } }
        if (p.backendNodeId === 777) return { node: { nodeName: 'INPUT', attributes: ['type', 'file'] } }
      }
      return {}
    })

    const executor = new BrowserActionExecutor(webContents as unknown as WebContents, vi.fn())
    await executor.attach()

    await expect(
      executor.execute({
        viewId: 'v1',
        action: 'upload',
        target: { kind: 'css', selector: '#file' },
        files: ['/tmp/abc.txt'],
      }),
    ).rejects.toMatchObject({
      code: 'SENSITIVE_ACTION_DENIED',
      action: 'browser_upload',
    } satisfies Partial<BrowserError>)
  })

  it('rejects upload target when strict=true and element is not input[type=file]', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-upload-root-invalid-'))
    const filePath = path.join(rootDir, 'a.txt')
    await fs.writeFile(filePath, 'x')

    const webContents = new MockWebContents()
    webContents.debugger.sendCommand.mockImplementation(async (method, params) => {
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
      if (method === 'DOM.querySelector') return { nodeId: 42 }
      if (method === 'DOM.describeNode') {
        const p = params as { nodeId?: number; backendNodeId?: number }
        if (p.nodeId === 42) return { node: { backendNodeId: 777 } }
        if (p.backendNodeId === 777) return { node: { nodeName: 'DIV', attributes: [] } }
      }
      return {}
    })

    const executor = new BrowserActionExecutor(webContents as unknown as WebContents, vi.fn())
    await executor.attach()

    await expect(
      executor.execute(
        {
          viewId: 'v1',
          action: 'upload',
          target: { kind: 'css', selector: '#not-file' },
          files: [filePath],
        },
        { projectPath: rootDir, startupCwd: rootDir },
      ),
    ).rejects.toMatchObject({
      code: 'UPLOAD_TARGET_INVALID',
      target: '#not-file',
    } satisfies Partial<BrowserError>)
  })

  it('rejects upload when total size exceeds 200MB', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-upload-root-total-'))
    const files: string[] = []
    // Use sparse files so we can trigger size limits without heavy disk writes.
    // 45MB * 5 = 225MB (each file is below 50MB single-file limit).
    for (let i = 1; i <= 5; i++) {
      const f = path.join(rootDir, `total-${i}.bin`)
      await fs.writeFile(f, '')
      await fs.truncate(f, 45 * 1024 * 1024)
      files.push(f)
    }

    const webContents = new MockWebContents()
    webContents.debugger.sendCommand.mockImplementation(async (method, params) => {
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } }
      if (method === 'DOM.querySelector') return { nodeId: 42 }
      if (method === 'DOM.describeNode') {
        const p = params as { nodeId?: number; backendNodeId?: number }
        if (p.nodeId === 42) return { node: { backendNodeId: 777 } }
        if (p.backendNodeId === 777) return { node: { nodeName: 'INPUT', attributes: ['type', 'file'] } }
      }
      return {}
    })

    const executor = new BrowserActionExecutor(webContents as unknown as WebContents, vi.fn())
    await executor.attach()

    await expect(
      executor.execute(
        {
          viewId: 'v1',
          action: 'upload',
          target: { kind: 'css', selector: '#file' },
          files,
        },
        { projectPath: rootDir, startupCwd: rootDir },
      ),
    ).rejects.toMatchObject({
      code: 'UPLOAD_TOTAL_TOO_LARGE',
    } satisfies Partial<BrowserError>)
  })
})
