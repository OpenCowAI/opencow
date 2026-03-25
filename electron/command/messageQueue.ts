// SPDX-License-Identifier: Apache-2.0

import type { UserMessageContent } from '../../src/shared/types'

interface SDKUserMessage {
  type: 'user'
  message: { role: 'user'; content: string | unknown[] }
  parent_tool_use_id: null
  session_id: string
}

type SDKTextBlock = { type: 'text'; text: string }
type SDKImageBlock = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
type SDKDocumentBlock = {
  type: 'document'
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'text'; media_type: 'text/plain'; data: string }
  title?: string
}
type SDKContentBlock = SDKTextBlock | SDKImageBlock | SDKDocumentBlock

/**
 * Build a CLI-compatible <command-message> XML string.
 *
 * Aligns with Claude Code CLI's JSONL format, ensuring OpenCow-managed sessions
 * retain a CLI-consistent command structure in JSONL, allowing sessionParser to
 * uniformly extract commandName.
 */
function buildCommandXml(name: string, userArgs: string): string {
  return [
    `<command-message>${name}</command-message>`,
    `<command-name>/${name}</command-name>`,
    `<command-args>${userArgs}</command-args>`,
  ].join(' ')
}

/**
 * Convert our UserMessageContent to the SDK MessageParam content format.
 *
 * - Plain string → string (text-only)
 * - Block array → SDK content blocks (text + image)
 * - slash_command blocks → CLI-compatible <command-message> XML + expanded template
 *
 * Slash command CLI format alignment: command invocations are wrapped in XML tags, with
 * expanded templates as separate text blocks. This ensures JSONL always retains command
 * structure regardless of whether the session originates from CLI or OpenCow.
 */
function toSDKContent(content: UserMessageContent): string | SDKContentBlock[] {
  if (typeof content === 'string') return content

  // Collect user text (text blocks that are not slash_command or image) to use as command-args
  const userTextParts: string[] = []
  for (const block of content) {
    if (block.type === 'text') {
      userTextParts.push(block.text)
    }
  }
  const userArgs = userTextParts.join('').trim()

  const result: SDKContentBlock[] = []

  for (const block of content) {
    switch (block.type) {
      case 'text':
        result.push({ type: 'text', text: block.text })
        break
      case 'slash_command':
        // CLI-compatible format: command invocation XML + expanded template content
        result.push({ type: 'text', text: buildCommandXml(block.name, userArgs) })
        result.push({ type: 'text', text: block.expandedText })
        break
      case 'image':
        result.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: block.mediaType,
            data: block.data,
          },
        })
        break
      case 'document':
        result.push({
          type: 'document',
          source: block.mediaType === 'text/plain'
            ? { type: 'text', media_type: 'text/plain', data: block.data }
            : { type: 'base64', media_type: block.mediaType, data: block.data },
          title: block.title,
        })
        break
      default: {
        const _exhaustive: never = block
        return _exhaustive
      }
    }
  }

  return result
}

/**
 * Async-iterable message queue for Agent SDK streaming input mode.
 * Push user messages from IPC handlers; the SDK consumes them via for-await.
 * Based on the pattern from Anthropic's official simple-chatapp demo.
 */
export class MessageQueue {
  private buffer: SDKUserMessage[] = []
  private resolver: ((msg: SDKUserMessage | null) => void) | null = null
  private closed = false

  push(content: UserMessageContent): void {
    if (this.closed) return

    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: toSDKContent(content) },
      parent_tool_use_id: null,
      session_id: ''
    }

    if (this.resolver) {
      const resolve = this.resolver
      this.resolver = null
      resolve(msg)
    } else {
      this.buffer.push(msg)
    }
  }

  close(): void {
    this.closed = true
    if (this.resolver) {
      const resolve = this.resolver
      this.resolver = null
      resolve(null)
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<SDKUserMessage> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift()!
      } else if (this.closed) {
        return
      } else {
        const msg = await new Promise<SDKUserMessage | null>((resolve) => {
          this.resolver = resolve
        })
        if (msg === null) return
        yield msg
      }
    }
  }
}
