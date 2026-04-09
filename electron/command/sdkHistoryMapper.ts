// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto'
import type { ContentBlock, ManagedSessionMessage } from '../../src/shared/types'

type SdkTextBlock = { type: 'text'; text: string }
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
type SdkUserContentBlock = SdkTextBlock | SdkImageBlock | SdkDocumentBlock

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
    content: Array<{ type: 'text'; text: string }>
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

function mapUserContent(blocks: ContentBlock[]): string | SdkUserContentBlock[] | null {
  if (blocks.length === 0) return null

  const userArgs = blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()

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
      case 'tool_use':
      case 'tool_result':
      case 'thinking':
        // These should not appear in managed user messages for normal turns.
        // Skip silently to keep injected history API-compatible.
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

function mapAssistantText(blocks: ContentBlock[]): string | null {
  const parts = blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text.trim())
    .filter((text) => text.length > 0)
  if (parts.length === 0) return null
  return parts.join('\n\n')
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
  const text = mapAssistantText(message.content)
  if (!text) return null

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
      content: [{ type: 'text', text }],
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
