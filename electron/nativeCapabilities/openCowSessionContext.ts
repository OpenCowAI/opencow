// SPDX-License-Identifier: Apache-2.0
//
// Phase 1B.11 — OpenCow's per-session context shape for the SDK Capability
// Provider framework.
//
// Extends the SDK's base `SessionContext` (which has only sessionId/cwd/
// abortSignal) with the OpenCow domain fields the existing 8 native
// capabilities consume:
//
//   - projectId / issueId / originSource — domain identity
//   - projectPath / startupCwd            — workspace anchors
//   - relay                                — per-session tool progress relay
//                                            (Evose's SSE chunk bridge to the
//                                            renderer; spike 3 confirmed each
//                                            session has its own instance)
//
// The SDK framework's generic `<TSessionCtx extends SessionContext>` is the
// extension point — every BaseCapabilityProvider subclass in OpenCow is
// parameterised on this type so each capability sees the OpenCow shape
// natively, without losing the SDK base contract.
//
// Why `relay` lives here (and not in HostEnvironment): Phase 1B spike 3
// confirmed `ToolProgressRelay` is OpenCow-internal infrastructure with a
// single consumer (EvoseNativeCapability) and a per-session lifecycle. It is
// NOT a generic host primitive — putting it on SDK's HostEnvironment would
// pollute the public surface with an OpenCow-specific concept. Putting it on
// OpenCowSessionContext (which lives entirely inside OpenCow's electron/ tree)
// keeps the SDK's CapabilityToolContext clean while letting OpenCow's
// capabilities access the relay through the same generic context channel.

import type { SessionContext } from '@opencow-ai/opencow-agent-sdk'

import type { ToolProgressRelay } from '../utils/toolProgressRelay'

export interface OpenCowSessionContext extends SessionContext {
  /** Resolved Project ID, or null if session is not scoped to a project. */
  readonly projectId: string | null

  /** Issue ID when the session is issue-scoped; otherwise null. */
  readonly issueId: string | null

  /**
   * The `source` field from the session's `SessionOrigin`. Used by
   * InteractionNativeCapability to suppress interactive-card tools when the
   * session originates from an IM platform that cannot render them.
   */
  readonly originSource: string

  /** Resolved workspace root for the session (when project-scoped). */
  readonly projectPath?: string

  /** Session startup cwd used by the runtime before any cwd changes. */
  readonly startupCwd?: string

  /**
   * Per-session `ToolProgressRelay` instance (the SSE chunk bridge that
   * EvoseNativeCapability uses to forward Agent run events to the renderer
   * IPC channel via leading-edge throttling).
   *
   * Each session in `SessionOrchestrator.startSession` constructs a fresh
   * `new ToolProgressRelay()` (electron/command/sessionOrchestrator.ts:664)
   * and embeds it in this context — capabilities should never construct
   * their own relay or share one across sessions.
   */
  readonly relay: ToolProgressRelay
}
