// SPDX-License-Identifier: Apache-2.0

import type {
  CapabilitySnapshot,
  StartSessionNativeToolAllowItem,
  StartSessionPolicy,
  UserMessageContent,
} from '../../../src/shared/types'
import {
  deriveSessionPromptActivation,
  policySatisfiesRequiredNativeAllowlist,
  type SessionPromptActivation,
} from './sessionPolicyPlanner'
// Phase 1B.11d: resolveImplicitNativeRequirements import removed (keyword matcher deleted)

// ── Input ────────────────────────────────────────────────────────────────

export interface SessionReconfigurationInput {
  currentPolicy?: StartSessionPolicy
  message: UserMessageContent
  /**
   * Capability snapshot for implicit skill matching.
   *
   * When provided, the coordinator also checks whether plain-text references
   * in `message` match skills that require native tools not present in
   * `currentPolicy`. This is essential for IM channels (WeChat, Telegram,
   * etc.) where users reference skills in natural language rather than via
   * slash commands.
   *
   * When absent, only explicit native requirements (from slash commands) are
   * evaluated — the same behaviour as before this field was introduced.
   */
  capabilitySnapshot?: CapabilitySnapshot
}

// ── Decision ─────────────────────────────────────────────────────────────

export type ReconfigurationReason =
  // ── reuse reasons ──
  | 'no_native_requirements'
  | 'native_allowlist_satisfied'
  // ── restart reasons (explicit) ──
  | 'policy_missing'
  | 'native_mode_none'
  | 'missing_required_native_allowlist'
  // ── restart reasons (implicit) ──
  | 'implicit_native_requirements_policy_missing'
  | 'implicit_native_requirements_not_satisfied'

export interface SessionReconfigurationDecision {
  action: 'reuse' | 'restart'
  reason: ReconfigurationReason
  activation: SessionPromptActivation
  /**
   * Native tool requirements that triggered a restart decision.
   *
   * Present only when `action === 'restart'`. Populated from either explicit
   * slash-command requirements or implicit skill matching results — whichever
   * triggered the restart. Useful for structured logging.
   */
  triggeringRequirements?: StartSessionNativeToolAllowItem[]
}

// ── Decision logic ───────────────────────────────────────────────────────

/**
 * Decide whether the current session lifecycle can serve an incoming message
 * or needs a restart to acquire native tools.
 *
 * Evaluation proceeds in two phases:
 *
 *   **Phase 1 — Explicit requirements** (from `/slash_command` blocks):
 *   Deterministic, zero-cost. If the message contains slash commands that
 *   declare `nativeRequirements`, check whether the current policy already
 *   includes them.
 *
 *   **Phase 2 — Implicit requirements** (from plain-text skill references):
 *   Only runs when Phase 1 found nothing AND a `capabilitySnapshot` is
 *   provided. Uses the same implicit skill matching engine as session
 *   creation to detect natural-language mentions of skills (e.g. Evose apps)
 *   that require native tools.
 *
 * This two-phase design keeps the common path (no native requirements) fast
 * while correctly handling IM channels where users type "use X Analyst"
 * instead of selecting a slash command.
 */
export function decideSessionReconfiguration(
  input: SessionReconfigurationInput,
): SessionReconfigurationDecision {
  const activation = deriveSessionPromptActivation(input.message)

  // ── Phase 1: Explicit native requirements ────────────────────────────
  if (activation.requiredNativeAllowlist.length > 0) {
    return evaluateNativeRequirements(
      input.currentPolicy,
      activation.requiredNativeAllowlist,
      activation,
      /* implicit */ false,
    )
  }

  // Phase 1B.11d: implicit native requirements phase removed.
  // All native capabilities are now exposed by default (commit d03bac05),
  // so there is no need to restart the session when implicit skill matches
  // would have required additional native tools.

  return { action: 'reuse', reason: 'no_native_requirements', activation }
}

// ── Internal ─────────────────────────────────────────────────────────────

/**
 * Evaluate whether `currentPolicy` satisfies `requirements`.
 *
 * Shared by both explicit and implicit phases — the logic is identical,
 * only the reason labels differ so callers can distinguish the trigger source.
 */
function evaluateNativeRequirements(
  currentPolicy: StartSessionPolicy | undefined,
  requirements: StartSessionNativeToolAllowItem[],
  activation: SessionPromptActivation,
  implicit: boolean,
): SessionReconfigurationDecision {
  if (!currentPolicy) {
    return {
      action: 'restart',
      reason: implicit ? 'implicit_native_requirements_policy_missing' : 'policy_missing',
      activation,
      triggeringRequirements: requirements,
    }
  }

  if (currentPolicy.tools.native.mode !== 'allowlist') {
    return {
      action: 'restart',
      reason: implicit ? 'implicit_native_requirements_not_satisfied' : 'native_mode_none',
      activation,
      triggeringRequirements: requirements,
    }
  }

  if (!policySatisfiesRequiredNativeAllowlist(currentPolicy, requirements)) {
    return {
      action: 'restart',
      reason: implicit ? 'implicit_native_requirements_not_satisfied' : 'missing_required_native_allowlist',
      activation,
      triggeringRequirements: requirements,
    }
  }

  return { action: 'reuse', reason: 'native_allowlist_satisfied', activation }
}
