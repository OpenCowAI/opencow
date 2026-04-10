// SPDX-License-Identifier: Apache-2.0

/**
 * Explicit transport semantics for engine system-prompt delivery.
 *
 * Claude supports native system-prompt fields.
 *
 * Without this typed contract, call-sites silently rely on string-key
 * conventions and lifecycle-specific assumptions.
 */

export type EngineSystemPromptTransportSemantic =
  | 'provider_native'

/**
 * Single structured contract for system-prompt delivery semantics.
 */
export type SystemPromptTransportPayload = ProviderNativeSystemPrompt

export interface ProviderNativeSystemPrompt {
  /** Full composed system prompt text. */
  readonly text: string
  /** Provider-native system prompt channel (Claude-style). */
  readonly transport: 'provider_native'
}

export function createProviderNativeSystemPrompt(text: string): ProviderNativeSystemPrompt {
  return {
    text,
    transport: 'provider_native',
  }
}
