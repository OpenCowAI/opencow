// SPDX-License-Identifier: Apache-2.0

import type {
  ContentBlock,
  DocumentMediaType,
  ImageMediaType,
} from '../../../src/shared/types'
import type { ConversationContentBlock } from '../domain/content'

export function toManagedContentBlocks(blocks: ConversationContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = []

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        result.push({ type: 'text', text: block.text })
        break
      case 'thinking':
        result.push({
          type: 'thinking',
          thinking: block.thinking,
          // Carry provenance + any provider-specific replay token so the
          // persisted managed-message shape round-trips losslessly back into
          // `sdkHistoryMapper` on resume.
          // See plans/cross-provider-thinking.md §5.3.
          ...(block.provenance ? { provenance: block.provenance } : {}),
          ...(block.signature ? { signature: block.signature } : {}),
          ...(block.encryptedContent ? { encryptedContent: block.encryptedContent } : {}),
        })
        break
      case 'tool_use':
        result.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
          ...(typeof block.progress === 'string' ? { progress: block.progress } : {}),
        })
        break
      case 'tool_result':
        result.push({
          type: 'tool_result',
          toolUseId: block.toolUseId,
          content: block.content,
          ...(block.isError ? { isError: true } : {}),
        })
        break
      case 'image':
        result.push({
          type: 'image',
          mediaType: block.mediaType as ImageMediaType,
          data: block.data,
          sizeBytes: block.sizeBytes,
          ...(block.toolUseId ? { toolUseId: block.toolUseId } : {}),
        })
        break
      case 'document':
        result.push({
          type: 'document',
          mediaType: block.mediaType as DocumentMediaType,
          data: block.data,
          sizeBytes: block.sizeBytes,
          title: block.title ?? 'document',
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
