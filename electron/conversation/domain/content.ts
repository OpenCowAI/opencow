// SPDX-License-Identifier: Apache-2.0

/**
 * Engine-agnostic conversation content blocks used by the domain layer.
 *
 * These types intentionally do NOT import renderer/shared message block unions.
 * Projection into UI-facing shapes happens in the projection layer.
 */

export type ConversationImageMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp'

export type ConversationDocumentMediaType =
  | 'text/plain'
  | 'application/pdf'

export interface ConversationTextBlock {
  readonly type: 'text'
  readonly text: string
}

/**
 * Which provider produced a given reasoning block. Mirrors
 * `ThinkingProvenance` in `src/shared/types.ts`; kept as a local alias so the
 * domain layer doesn't reach into the shared surface.
 */
export type ConversationThinkingProvenance =
  | 'anthropic'
  | 'codex'
  | 'openai-chat'
  | 'unknown'

export interface ConversationThinkingBlock {
  readonly type: 'thinking'
  readonly thinking: string
  /**
   * Provider that produced this reasoning. Governs replay eligibility:
   * Anthropic requires `signature`; Codex would require `encryptedContent`;
   * OpenAI-chat and `'unknown'` are never replayed. See
   * `plans/cross-provider-thinking.md` and {@link ThinkingProvenance}.
   */
  readonly provenance?: ConversationThinkingProvenance
  /**
   * Cryptographic signature emitted by Claude with every extended-thinking
   * block. Populated only when `provenance === 'anthropic'`. Preserved
   * end-to-end so `sdkHistoryMapper` can round-trip it on per-turn history
   * replay — missing it triggers
   * `400 messages.N.content.0.thinking.signature: Field required`.
   */
  readonly signature?: string
  /**
   * Codex Responses API `encrypted_content` blob. Populated only when
   * `provenance === 'codex'`. Not persisted today (see follow-up plan).
   */
  readonly encryptedContent?: string
}

export interface ConversationToolUseBlock {
  readonly type: 'tool_use'
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
  readonly progress?: string
}

export interface ConversationToolResultBlock {
  readonly type: 'tool_result'
  readonly toolUseId: string
  readonly content: string
  readonly isError?: boolean
}

export interface ConversationImageBlock {
  readonly type: 'image'
  readonly mediaType: ConversationImageMediaType | string
  readonly data: string
  readonly sizeBytes: number
  /**
   * Provenance: when this image was extracted from a tool_result payload
   * (e.g. browser_screenshot), the originating tool_use id. Required for
   * context-aware rendering (e.g. BrowserScreenshotCard) and for round-tripping
   * the SDK protocol losslessly through persistence + per-turn resume.
   */
  readonly toolUseId?: string
}

export interface ConversationDocumentBlock {
  readonly type: 'document'
  readonly mediaType: ConversationDocumentMediaType | string
  readonly data: string
  readonly sizeBytes: number
  readonly title?: string
}

export type ConversationContentBlock =
  | ConversationTextBlock
  | ConversationThinkingBlock
  | ConversationToolUseBlock
  | ConversationToolResultBlock
  | ConversationImageBlock
  | ConversationDocumentBlock
