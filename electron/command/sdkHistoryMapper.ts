// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto'
import type { ContentBlock, ManagedSessionMessage } from '../../src/shared/types'

type SdkTextBlock = { type: 'text'; text: string }
type SdkThinkingBlock = {
  type: 'thinking'
  thinking: string
  /**
   * Anthropic's cryptographic signature for the extended-thinking block.
   * REQUIRED by the API when replaying thinking blocks in conversation
   * history — the absence of this field triggers `400 messages.N.content.0
   * .thinking.signature: Field required`. Sourced end-to-end from
   * `ThinkingBlock.signature` at the SDK → OpenCow boundary.
   */
  signature: string
}
type SdkImageBlock = {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}
type SdkDocumentBlock = {
  type: 'document'
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'text'; media_type: 'text/plain'; data: string }
  title?: string
}
type SdkToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
type SdkToolResultContentItem =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string }
    }
type SdkToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string | SdkToolResultContentItem[]
  is_error?: boolean
}
type SdkUserContentBlock =
  | SdkTextBlock
  | SdkImageBlock
  | SdkDocumentBlock
  | SdkToolResultBlock
type SdkAssistantContentBlock =
  | SdkTextBlock
  | SdkThinkingBlock
  | SdkToolUseBlock

type SdkHistoryUserMessage = {
  type: 'user'
  message: { role: 'user'; content: string | SdkUserContentBlock[] }
  uuid: string
  timestamp: string
  isMeta?: boolean
}

/** Anthropic-canonical `stop_reason` values relevant to history replay. */
type SdkAssistantStopReason = 'tool_use' | 'end_turn' | 'stop_sequence' | 'max_tokens'

type SdkHistoryAssistantMessage = {
  type: 'assistant'
  uuid: string
  timestamp: string
  requestId?: string
  message: {
    id: string
    container: null
    model: string
    role: 'assistant'
    stop_reason: SdkAssistantStopReason
    stop_sequence: string | null
    type: 'message'
    usage: {
      input_tokens: number
      output_tokens: number
      cache_creation_input_tokens: number
      cache_read_input_tokens: number
      server_tool_use: {
        web_search_requests: number
        web_fetch_requests: number
      }
      service_tier: null
      cache_creation: {
        ephemeral_1h_input_tokens: number
        ephemeral_5m_input_tokens: number
      }
      inference_geo: null
      iterations: null
      speed: null
    }
    content: SdkAssistantContentBlock[]
    context_management: null
  }
}

/**
 * Fallback model string used when the caller doesn't supply one.
 *
 * This is a legitimate Claude API model identifier — NOT the SDK-internal
 * `'<synthetic>'` sentinel (which `opencow-agent-sdk` uses for locally
 * synthesised placeholder assistant messages and some normalisation paths
 * treat specially). Using a real model string keeps the replayed history
 * indistinguishable from a genuine transcript at the API layer.
 */
const DEFAULT_ASSISTANT_MODEL = 'claude-sonnet-4-6'

function toIsoTimestamp(raw: number): string {
  const date = Number.isFinite(raw) ? new Date(raw) : new Date()
  if (Number.isNaN(date.getTime())) return new Date().toISOString()
  return date.toISOString()
}

function buildCommandXml(name: string, userArgs: string): string {
  return [
    `<command-message>${name}</command-message>`,
    `<command-name>/${name}</command-name>`,
    `<command-args>${userArgs}</command-args>`,
  ].join(' ')
}

/**
 * Infer `stop_reason` for an assistant message based on its content blocks.
 *
 * Anthropic's API requires `stop_reason` to reflect why generation halted —
 * `'tool_use'` when the turn ended on a tool_use block, `'end_turn'` when
 * the model produced a final text response. Hardcoding `'stop_sequence'`
 * (the pre-fix behaviour) is incorrect for both cases and may prime the
 * API-side pipeline into a wrong branch on history replay.
 */
function inferStopReason(content: SdkAssistantContentBlock[]): SdkAssistantStopReason {
  // If the message carries a tool_use block, the turn ended for tool execution.
  if (content.some((b) => b.type === 'tool_use')) return 'tool_use'
  // Otherwise it completed naturally.
  return 'end_turn'
}

/**
 * Map persisted user-role blocks back to the SDK's user-message content shape.
 *
 * Two block sources land here:
 *
 *   1. Real user input — text / image / document / slash_command. These map
 *      1:1 to SDK user content items.
 *   2. Engine-emitted tool_result envelopes — a ToolResultBlock followed by
 *      one or more ImageBlock/DocumentBlock siblings stamped with the same
 *      `toolUseId` (extracted by `extractMediaFromToolResult`). The Anthropic
 *      protocol requires those media items to live INSIDE the matching
 *      `tool_result.content` array, not as siblings — so we fold them back
 *      here. This keeps OpenCow's persisted shape ergonomic for rendering
 *      while still emitting the canonical SDK shape for resume.
 */
function mapUserContent(blocks: ContentBlock[]): string | SdkUserContentBlock[] | null {
  if (blocks.length === 0) return null

  const userArgs = blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()

  // Pre-pass: index media blocks by toolUseId so we can fold them into the
  // matching tool_result.content during the main pass.
  const mediaByToolUseId = new Map<string, SdkToolResultContentItem[]>()
  for (const block of blocks) {
    if (block.type !== 'image') continue
    if (!block.toolUseId) continue
    const list = mediaByToolUseId.get(block.toolUseId) ?? []
    list.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: block.mediaType,
        data: block.data,
      },
    })
    mediaByToolUseId.set(block.toolUseId, list)
  }

  const mapped: SdkUserContentBlock[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        mapped.push({ type: 'text', text: block.text })
        break
      case 'slash_command':
        mapped.push({ type: 'text', text: buildCommandXml(block.name, userArgs) })
        mapped.push({ type: 'text', text: block.expandedText })
        break
      case 'image':
        // Fold provenance-stamped images into their owning tool_result; only
        // emit standalone for genuine user-attached images.
        if (block.toolUseId) break
        mapped.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: block.mediaType,
            data: block.data,
          },
        })
        break
      case 'document':
        mapped.push({
          type: 'document',
          source: block.mediaType === 'text/plain'
            ? { type: 'text', media_type: 'text/plain', data: block.data }
            : { type: 'base64', media_type: block.mediaType, data: block.data },
          title: block.title,
        })
        break
      case 'tool_result': {
        const media = mediaByToolUseId.get(block.toolUseId) ?? []
        const textContent = block.content.length > 0
          ? [{ type: 'text' as const, text: block.content }]
          : []
        const content: SdkToolResultContentItem[] = [...textContent, ...media]
        mapped.push({
          type: 'tool_result',
          tool_use_id: block.toolUseId,
          // Anthropic API accepts string when there is only text and no media;
          // use string form to minimize payload size in that case.
          content: media.length === 0 ? block.content : content,
          ...(block.isError ? { is_error: true } : {}),
        })
        break
      }
      case 'tool_use':
      case 'thinking':
        // These belong on assistant messages — never appear on user-role
        // messages in a well-formed history. Skip silently.
        break
      default: {
        const _exhaustive: never = block
        return _exhaustive
      }
    }
  }

  if (mapped.length === 0) return null
  if (mapped.every((block) => block.type === 'text')) {
    return mapped.map((block) => block.text).join('\n\n')
  }
  return mapped
}

/**
 * Map persisted assistant-role blocks back to the SDK's assistant-message
 * content shape. Preserves text + thinking + tool_use so per-turn resume
 * replays the assistant's full intent (without tool_use the model loses the
 * pairing with the next user-role tool_result and the SDK rejects the history).
 */
function mapAssistantContent(blocks: ContentBlock[]): SdkAssistantContentBlock[] {
  const mapped: SdkAssistantContentBlock[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) mapped.push({ type: 'text', text: block.text })
        break
      case 'thinking':
        // Drop thinking blocks that lack a signature. Anthropic requires the
        // signature to replay thinking as history; a missing signature means
        // this block either (a) originated from a partial streaming event
        // that never received the final sig, or (b) predates the signature-
        // preservation fix in the OpenCow pipeline. Emitting it anyway
        // produces a 400 for the entire turn. Dropping silently degrades
        // gracefully — the model loses visibility into its past reasoning
        // but continues to see text/tool_use from that turn.
        if (block.thinking.length > 0 && block.signature) {
          mapped.push({
            type: 'thinking',
            thinking: block.thinking,
            signature: block.signature,
          })
        }
        break
      case 'tool_use':
        mapped.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        })
        break
      case 'image':
      case 'document':
      case 'tool_result':
      case 'slash_command':
        // Not valid in assistant-role messages.
        break
      default: {
        const _exhaustive: never = block
        return _exhaustive
      }
    }
  }
  return mapped
}

/**
 * Reorder an assistant-content array so that thinking blocks come before any
 * text/tool_use blocks. Anthropic's extended-thinking protocol requires the
 * thinking block to be the FIRST block of the assistant turn — violating
 * this ordering can result in the API ignoring the thinking or rejecting the
 * message entirely.
 *
 * This mostly matters after we merge consecutive assistant messages (where
 * thinking from message N and text/tool_use from message N+1 land in one
 * combined content array in their originally-persisted order, which may
 * already be correct but we enforce invariantly).
 */
function orderAssistantContent(
  content: SdkAssistantContentBlock[],
): SdkAssistantContentBlock[] {
  const thinking: SdkAssistantContentBlock[] = []
  const rest: SdkAssistantContentBlock[] = []
  for (const block of content) {
    if (block.type === 'thinking') thinking.push(block)
    else rest.push(block)
  }
  if (thinking.length === 0) return content
  return [...thinking, ...rest]
}

/**
 * Stable-id policy for SDK assistant messages.
 *
 * Claude Code SDK merges consecutive assistant messages that share a
 * `message.id` (see `opencow-agent-sdk/src/session/messages.ts` around line
 * 2257). We want OPPOSITE behaviour: two DIFFERENT OpenCow ManagedSession
 * messages must produce two SDK messages with DIFFERENT ids so they are not
 * accidentally merged.
 *
 * Previously the mapper used `randomUUID()` — uniqueness was guaranteed but
 * the ids changed on every replay, breaking any caching that keys on
 * message.id. Now we use the stable ManagedSessionMessage.id, which is a
 * short nanoid(8) at source (managedSession.ts) — unique within a session,
 * stable across replays.
 */
function toSdkAssistantMessageId(managedMessageId: string): string {
  return managedMessageId
}

function toSdkUserMessage(
  message: Extract<ManagedSessionMessage, { role: 'user' }>,
): SdkHistoryUserMessage | null {
  const content = mapUserContent(message.content)
  if (!content) return null
  return {
    type: 'user',
    message: {
      role: 'user',
      content,
    },
    uuid: randomUUID(),
    timestamp: toIsoTimestamp(message.timestamp),
    isMeta: false,
  }
}

function toSdkAssistantMessage(
  message: Extract<ManagedSessionMessage, { role: 'assistant' }>,
  model: string,
): SdkHistoryAssistantMessage | null {
  const content = mapAssistantContent(message.content)
  if (content.length === 0) return null

  const orderedContent = orderAssistantContent(content)
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: toIsoTimestamp(message.timestamp),
    requestId: undefined,
    message: {
      id: toSdkAssistantMessageId(message.id),
      container: null,
      model,
      role: 'assistant',
      stop_reason: inferStopReason(orderedContent),
      stop_sequence: null,
      type: 'message',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        server_tool_use: {
          web_search_requests: 0,
          web_fetch_requests: 0,
        },
        service_tier: null,
        cache_creation: {
          ephemeral_1h_input_tokens: 0,
          ephemeral_5m_input_tokens: 0,
        },
        inference_geo: null,
        iterations: null,
        speed: null,
      },
      content: orderedContent,
      context_management: null,
    },
  }
}

/**
 * Fold adjacent-same-role assistant messages into a single SDK message.
 *
 * The Anthropic API requires strict user/assistant alternation; two
 * consecutive assistant messages are a protocol violation that triggers
 * either a 400 or silent content loss on the server. This regularly
 * happens in OpenCow-persisted history because the conversation projector
 * can produce two ManagedSessionMessage entries for what the model intends
 * as one turn — e.g. a thinking-only entry followed by a tool_use-only
 * entry (observed in ccb-2IZ4L16u3aIW, ccb-p-IDyPZVFH4G, ccb-IcC5mfq4EvOA).
 *
 * This post-pass detects adjacent `type: 'assistant'` SDK entries produced
 * by the mapper and merges their content arrays into the first one's
 * message, dropping the second. The merged `stop_reason` / `id` come from
 * the first entry's position with content-shape re-inferred to reflect the
 * combined blocks. Thinking blocks are hoisted to the front to satisfy
 * extended-thinking protocol requirements.
 */
function mergeConsecutiveAssistants(messages: unknown[]): unknown[] {
  const merged: unknown[] = []
  for (const msg of messages) {
    const prev = merged.at(-1) as SdkHistoryAssistantMessage | undefined
    const curr = msg as { type?: string } | undefined
    if (
      curr?.type === 'assistant'
      && prev?.type === 'assistant'
    ) {
      // Combine content arrays; re-order thinking-first; re-infer stop_reason.
      const combined = orderAssistantContent([
        ...prev.message.content,
        ...(msg as SdkHistoryAssistantMessage).message.content,
      ])
      prev.message.content = combined
      prev.message.stop_reason = inferStopReason(combined)
      // Leave prev.message.id unchanged — the first message's stable id wins.
      continue
    }
    merged.push(msg)
  }
  return merged
}

export interface MapToSdkInitialMessagesOptions {
  /**
   * Model identifier used when synthesising the `message.model` field on
   * assistant-role history entries. If omitted, a legitimate Claude model
   * string is used as fallback (see DEFAULT_ASSISTANT_MODEL). Callers are
   * encouraged to pass the session's real model for maximum fidelity.
   */
  model?: string
}

export function mapManagedMessagesToSdkInitialMessages(
  messages: readonly ManagedSessionMessage[],
  options: MapToSdkInitialMessagesOptions = {},
): unknown[] {
  const model = options.model ?? DEFAULT_ASSISTANT_MODEL
  const initialMessages: unknown[] = []

  for (const message of messages) {
    if (message.role === 'system') continue

    if (message.role === 'user') {
      const mapped = toSdkUserMessage(message)
      if (mapped) initialMessages.push(mapped)
      continue
    }

    const mapped = toSdkAssistantMessage(message, model)
    if (mapped) initialMessages.push(mapped)
  }

  return mergeConsecutiveAssistants(initialMessages)
}
