// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto'
import type { ContentBlock, ManagedSessionMessage } from '../../src/shared/types'

type SdkTextBlock = { type: 'text'; text: string }
type SdkThinkingBlock = { type: 'thinking'; thinking: string }
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
    stop_reason: string
    stop_sequence: string
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
        if (block.thinking.length > 0) mapped.push({ type: 'thinking', thinking: block.thinking })
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
): SdkHistoryAssistantMessage | null {
  const content = mapAssistantContent(message.content)
  if (content.length === 0) return null

  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: toIsoTimestamp(message.timestamp),
    requestId: undefined,
    message: {
      id: randomUUID(),
      container: null,
      model: '<synthetic>',
      role: 'assistant',
      stop_reason: 'stop_sequence',
      stop_sequence: '',
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
      content,
      context_management: null,
    },
  }
}

export function mapManagedMessagesToSdkInitialMessages(
  messages: readonly ManagedSessionMessage[],
): unknown[] {
  const initialMessages: unknown[] = []

  for (const message of messages) {
    if (message.role === 'system') continue

    if (message.role === 'user') {
      const mapped = toSdkUserMessage(message)
      if (mapped) initialMessages.push(mapped)
      continue
    }

    const mapped = toSdkAssistantMessage(message)
    if (mapped) initialMessages.push(mapped)
  }

  return initialMessages
}
