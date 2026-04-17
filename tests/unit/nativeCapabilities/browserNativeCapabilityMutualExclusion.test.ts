// SPDX-License-Identifier: Apache-2.0

/**
 * BrowserNativeCapability — Chrome DevTools MCP Mutual Exclusion Tests
 *
 * Verifies that BrowserNativeCapability correctly suppresses overlapping tools

 * when an external Chrome DevTools MCP server is active, retaining only
 * tools that have no DevTools equivalent (e.g. browser_scroll/browser_upload).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrowserNativeCapability } from '../../../electron/nativeCapabilities/browser/browserNativeCapability'
import type { NativeCapabilityToolContext } from '../../../electron/nativeCapabilities/types'
import type { OpenCowSessionContext } from '../../../electron/nativeCapabilities/openCowSessionContext'
import type { ToolProgressRelay } from '../../../electron/utils/toolProgressRelay'

// ── Mocks ──────────────────────────────────────────────────────────────

// Mock BrowserService — no real browser operations needed for descriptor filtering tests
const mockBrowserService = {
  ensureView: vi.fn().mockResolvedValue('mock-view-id'),
  destroyView: vi.fn(),
  getActiveViewId: vi.fn(),
  executeAction: vi.fn(),
  captureScreenshot: vi.fn(),
  extractContent: vi.fn(),
  navigateTo: vi.fn(),
  scrollPage: vi.fn(),
}

const mockBus = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}

// ── Helpers ─────────────────────────────────────────────────────────────

function makeRelay(): ToolProgressRelay {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    emit: vi.fn(),
    flush: vi.fn(),
  } as unknown as ToolProgressRelay
}

function makeSessionContext(): OpenCowSessionContext {
  return {
    sessionId: 'test-session-1',
    cwd: process.cwd(),
    abortSignal: new AbortController().signal,
    projectId: null,
    issueId: null,
    originSource: 'agent',
    startupCwd: process.cwd(),
    relay: makeRelay(),
  }
}

/**
 * Phase 1B.11: build the SDK CapabilityToolContext shape (sessionContext +
 * hostEnvironment). `activeMcpServerNames` lives on hostEnvironment as a
 * `readonly string[]` (not the legacy `ReadonlySet<string>` field on the
 * pre-migration NativeCapabilityToolContext).
 */
function makeContext(opts: { activeMcpServerNames?: readonly string[] } = {}): NativeCapabilityToolContext {
  return {
    sessionContext: makeSessionContext(),
    hostEnvironment: {
      activeMcpServerNames: opts.activeMcpServerNames ?? [],
    },
  }
}

function getToolNames(capability: BrowserNativeCapability, context: NativeCapabilityToolContext): string[] {
  return capability.getToolDescriptors(context).map((t) => t.name)
}

// ── All 11 built-in browser tool names ──────────────────────────────────
const ALL_BROWSER_TOOLS = [
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_upload',
  'browser_extract',
  'browser_screenshot',
  'browser_scroll',
  'browser_wait',
  'browser_snapshot',
  'browser_ref_click',
  'browser_ref_type',
]

const OVERLAPPING_TOOLS = [
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_extract',
  'browser_snapshot',
  'browser_screenshot',
  'browser_wait',
]

const RETAINED_TOOLS = ['browser_scroll', 'browser_ref_click', 'browser_ref_type', 'browser_upload']

// ── Tests ───────────────────────────────────────────────────────────────

describe('BrowserNativeCapability — Chrome DevTools MCP Mutual Exclusion', () => {
  let capability: BrowserNativeCapability

  beforeEach(() => {
    capability = new BrowserNativeCapability({
      browserService: mockBrowserService as never,
      bus: mockBus as never,
    })
  })

  // ── Baseline: no external MCP servers ─────────────────────────────

  describe('without external MCP servers', () => {
    it('returns all 11 browser tools', () => {
      const context = makeContext()
      const tools = getToolNames(capability, context)

      expect(tools).toHaveLength(11)
      for (const name of ALL_BROWSER_TOOLS) {
        expect(tools).toContain(name)
      }
    })

    it('returns all 11 tools when activeMcpServerNames is omitted', () => {
      const context = makeContext()
      const tools = getToolNames(capability, context)
      expect(tools).toHaveLength(11)
    })

    it('returns all 11 tools when activeMcpServerNames is empty', () => {
      const context = makeContext({ activeMcpServerNames: [] })
      const tools = getToolNames(capability, context)
      expect(tools).toHaveLength(11)
    })
  })

  // ── Mutual exclusion: chrome-devtools active ──────────────────────

  describe('with chrome-devtools MCP active', () => {
    it('suppresses 7 overlapping tools', () => {
      const context = makeContext({
        activeMcpServerNames: ['chrome-devtools'],
      })
      const tools = getToolNames(capability, context)

      for (const name of OVERLAPPING_TOOLS) {
        expect(tools).not.toContain(name)
      }
    })

    it('retains non-overlapping browser tools (scroll/ref/upload)', () => {
      const context = makeContext({
        activeMcpServerNames: ['chrome-devtools'],
      })
      const tools = getToolNames(capability, context)

      expect(tools).toEqual(expect.arrayContaining(RETAINED_TOOLS))
    })

    it('returns exactly 4 tools when chrome-devtools is active', () => {
      const context = makeContext({
        activeMcpServerNames: ['chrome-devtools'],
      })
      const tools = getToolNames(capability, context)
      expect(tools).toHaveLength(4)
    })
  })

  // ── Other MCP servers: no mutual exclusion ────────────────────────

  describe('with unrelated MCP servers', () => {
    it('returns all 11 tools when other MCP servers are active', () => {
      const context = makeContext({
        activeMcpServerNames: ['some-other-server', 'another-mcp'],
      })
      const tools = getToolNames(capability, context)
      expect(tools).toHaveLength(11)
    })

    it('still suppresses when chrome-devtools is among other servers', () => {
      const context = makeContext({
        activeMcpServerNames: ['some-other-server', 'chrome-devtools', 'another-mcp'],
      })
      const tools = getToolNames(capability, context)

      expect(tools).toHaveLength(4)
      expect(tools).toEqual(expect.arrayContaining(RETAINED_TOOLS))
    })
  })

  // ── Tool output format validation ─────────────────────────────────

  describe('tool object integrity', () => {
    it('retained descriptors have valid name and handler', () => {
      const context = makeContext({
        activeMcpServerNames: ['chrome-devtools'],
      })
      const tools = capability.getToolDescriptors(context)

      for (const tool of tools) {
        expect(tool.name).toBeTruthy()
        expect(typeof tool.name).toBe('string')
        expect(typeof tool.execute).toBe('function')
      }
    })

    it('all descriptors have valid name and handler when no exclusion', () => {
      const context = makeContext()
      const tools = capability.getToolDescriptors(context)

      expect(tools).toHaveLength(11)
      for (const tool of tools) {
        expect(tool.name).toBeTruthy()
        expect(typeof tool.name).toBe('string')
        expect(typeof tool.execute).toBe('function')
      }
    })
  })
})
