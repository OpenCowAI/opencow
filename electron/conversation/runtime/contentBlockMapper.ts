// SPDX-License-Identifier: Apache-2.0

import type { ContentBlock } from '../../../src/shared/types'
import type {
  ConversationContentBlock,
  ConversationDocumentBlock,
  ConversationImageBlock,
  ConversationTextBlock,
  ConversationThinkingBlock,
  ConversationToolResultBlock,
  ConversationToolUseBlock,
} from '../domain/content'

export function toConversationContentBlocks(blocks: ContentBlock[]): ConversationContentBlock[] {
  const result: ConversationContentBlock[] = []

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        result.push({ type: 'text', text: block.text } satisfies ConversationTextBlock)
        break
      case 'thinking':
        result.push({
          type: 'thinking',
          thinking: block.thinking,
          // Preserve signature for Extended Thinking replay — see
          // ThinkingBlock.signature / ConversationThinkingBlock.signature docs.
          ...(block.signature ? { signature: block.signature } : {}),
        } satisfies ConversationThinkingBlock)
        break
      case 'tool_use':
        result.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
          ...(typeof block.progress === 'string' ? { progress: block.progress } : {}),
        } satisfies ConversationToolUseBlock)
        break
      case 'tool_result':
        result.push({
          type: 'tool_result',
          toolUseId: block.toolUseId,
          content: block.content,
          ...(block.isError ? { isError: true } : {}),
        } satisfies ConversationToolResultBlock)
        break
      case 'image':
        result.push({
          type: 'image',
          mediaType: block.mediaType,
          data: block.data,
          sizeBytes: block.sizeBytes,
          ...(block.toolUseId ? { toolUseId: block.toolUseId } : {}),
        } satisfies ConversationImageBlock)
        break
      case 'document':
        result.push({
          type: 'document',
          mediaType: block.mediaType,
          data: block.data,
          sizeBytes: block.sizeBytes,
          ...(block.title ? { title: block.title } : {}),
        } satisfies ConversationDocumentBlock)
        break
      case 'slash_command':
        // Slash-command block is a user-input concept and never emitted by engines.
        break
      default: {
        const _exhaustive: never = block
        return _exhaustive
      }
    }
  }

  return result
}
