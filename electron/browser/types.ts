// SPDX-License-Identifier: Apache-2.0

/**
 * Browser subsystem type definitions.
 *
 * All types for the embedded browser feature — profiles, commands, errors, events.
 * Follows OpenCow's Discriminated Union pattern for exhaustive matching.
 */

import type { SnapshotOptions } from './snapshot'

// ─── Browser Profile ────────────────────────────────────────────────────

export interface BrowserProfile {
  id: string
  name: string
  /** Electron session partition key, e.g. "persist:browser-abc123" */
  partition: string
  /** Allowed domains (empty = allow all). Supports wildcard: "*.zhipin.com" */
  allowedDomains: string[]
  /** Whether to convert session cookies to persistent cookies */
  cookiePersistence: boolean
  createdAt: number
  lastUsedAt: number
}

export interface CreateProfileInput {
  name: string
  allowedDomains?: string[]
  cookiePersistence?: boolean
}

// ─── Browser Command (Discriminated Union) ──────────────────────────────

interface BrowserCommandBase {
  viewId: string
}

export type BrowserCommand =
  | (BrowserCommandBase & { action: 'navigate'; url: string })
  | (BrowserCommandBase & { action: 'go-back' })
  | (BrowserCommandBase & { action: 'go-forward' })
  | (BrowserCommandBase & { action: 'reload' })
  | (BrowserCommandBase & { action: 'click'; selector: string })
  | (BrowserCommandBase & { action: 'type'; selector: string; text: string })
  | (BrowserCommandBase & { action: 'select'; selector: string; value: string })
  | (BrowserCommandBase & { action: 'scroll'; direction: 'up' | 'down'; amount?: number })
  | (BrowserCommandBase & { action: 'wait-for-selector'; selector: string; timeout?: number })
  | (BrowserCommandBase & { action: 'extract-text'; selector?: string })
  | (BrowserCommandBase & { action: 'extract-page' })
  | (BrowserCommandBase & { action: 'screenshot' })
  | (BrowserCommandBase & { action: 'evaluate'; expression: string })
  | (BrowserCommandBase & { action: 'download'; url: string; filename?: string })
  // Snapshot-Ref commands
  | (BrowserCommandBase & { action: 'snapshot'; options?: SnapshotOptions })
  | (BrowserCommandBase & { action: 'ref-click'; ref: string })
  | (BrowserCommandBase & { action: 'ref-type'; ref: string; text: string })

// ─── Command Result ─────────────────────────────────────────────────────

export type BrowserCommandResult =
  | { status: 'success'; data?: unknown }
  | { status: 'error'; error: BrowserError }

export interface BrowserExecutionContext {
  /** Cooperative cancellation for command execution. */
  signal?: AbortSignal
  /** Absolute deadline (epoch ms) for bounded execution. */
  deadlineAt?: number
}

// ─── Error Taxonomy (Discriminated Union) ───────────────────────────────

export type BrowserError =
  // Element errors
  | { code: 'SELECTOR_NOT_FOUND'; selector: string; message: string }
  | { code: 'ELEMENT_NOT_VISIBLE'; selector: string; message: string }
  | { code: 'ELEMENT_NOT_INTERACTABLE'; selector: string; message: string }
  // Navigation errors
  | { code: 'NAVIGATION_FAILED'; url: string; httpStatus?: number; message: string }
  | { code: 'DOMAIN_BLOCKED'; domain: string; allowedDomains: string[]; message: string }
  // Timeout
  | { code: 'TIMEOUT'; action: string; timeoutMs: number; message: string }
  // Cancellation
  | { code: 'ABORTED'; action: string; message: string }
  // Page state
  | { code: 'PAGE_CRASHED'; message: string }
  | { code: 'PAGE_CLOSED'; message: string }
  // CDP layer
  | { code: 'CDP_ERROR'; method: string; message: string }
  | { code: 'DEBUGGER_DETACHED'; reason: string; message: string }
  | { code: 'DEBUGGER_ALREADY_ATTACHED'; message: string }
  // Security
  | { code: 'SENSITIVE_ACTION_DENIED'; action: string; message: string }
  // Snapshot-Ref errors
  | { code: 'REF_NOT_FOUND'; ref: string; message: string }
  | { code: 'SNAPSHOT_STALE'; message: string }
  | { code: 'AX_TREE_FAILED'; message: string }

export type BrowserErrorCode = BrowserError['code']

// ─── Executor State Machine ─────────────────────────────────────────────

export type ExecutorState = 'idle' | 'attaching' | 'ready' | 'detached' | 'error'

// ─── Page Content (extraction result) ───────────────────────────────────

export interface PageContent {
  title: string
  url: string
  text: string
  links: Array<{ text: string; href: string }>
}

export interface PageInfo {
  url: string
  title: string
  isLoading: boolean
}

// ─── Bounds Sync ────────────────────────────────────────────────────────

export interface ViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface SyncBoundsParams {
  viewId: string
  bounds: ViewBounds
}

// ─── Browser Context (passed when invoking the browser from a session) ───

export interface BrowserContext {
  /**
   * The session that opened the browser.
   *
   * When set, the browser window displays this session's conversation and
   * routes user input to it — no separate "browser-agent" session is created.
   * When absent, the browser window operates in standalone mode and creates
   * its own browser-agent session on first user interaction.
   */
  linkedSessionId?: string
  sourceIssueId?: string
  initialUrl?: string
  initialPrompt?: string
  profileId?: string
}

// ─── DataBus Events ─────────────────────────────────────────────────────

export type BrowserDataBusEvent =
  | { type: 'browser:view:opened'; payload: { viewId: string; profileId: string; profileName: string } }
  | { type: 'browser:view:closed'; payload: { viewId: string } }
  | { type: 'browser:navigated'; payload: { viewId: string; url: string; title: string } }
  | { type: 'browser:loading'; payload: { viewId: string; isLoading: boolean } }
  | { type: 'browser:command:started'; payload: { viewId: string; command: BrowserCommand } }
  | {
      type: 'browser:command:completed'
      payload: { viewId: string; command: BrowserCommand; result: BrowserCommandResult }
    }
  | { type: 'browser:executor:state-changed'; payload: { viewId: string; state: ExecutorState } }
