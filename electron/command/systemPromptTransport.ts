// SPDX-License-Identifier: Apache-2.0

/**
 * Explicit transport semantics for engine system-prompt delivery.
 *
 * Why this exists:
 * - Claude supports native system-prompt fields.
 * - Codex currently requires synthetic first-turn injection.
 *
 * Without this typed contract, call-sites silently rely on string-key
 * conventions and lifecycle-specific assumptions.
 */

export type EngineSystemPromptTransportSemantic =
  | 'provider_native'
  | 'synthetic_first_turn_prefix'

/**
 * Single structured contract for system-prompt delivery semantics.
 * This intentionally prevents split-brain fields (`systemPrompt` + `codexSystemPrompt` + transport flags).
 */
export type SystemPromptTransportPayload =
  | ProviderNativeSystemPrompt
  | CodexSyntheticSystemPrompt

export interface ProviderNativeSystemPrompt {
  /** Full composed system prompt text. */
  readonly text: string
  /** Provider-native system prompt channel (Claude-style). */
  readonly transport: 'provider_native'
}

export interface CodexSyntheticSystemPrompt {
  /** Full composed system prompt text. */
  readonly text: string
  /** Explicit transport semantic expected by Codex lifecycle. */
  readonly transport: 'synthetic_first_turn_prefix'
}

export function createProviderNativeSystemPrompt(text: string): ProviderNativeSystemPrompt {
  return {
    text,
    transport: 'provider_native',
  }
}

export function createCodexSyntheticSystemPrompt(text: string): CodexSyntheticSystemPrompt {
  return {
    text,
    transport: 'synthetic_first_turn_prefix',
  }
}
