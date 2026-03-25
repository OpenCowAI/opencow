// SPDX-License-Identifier: Apache-2.0

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserMessageContent, SlashCommandBlock } from '../../../src/shared/types'
import type { EditMetadata } from '../../../src/renderer/lib/editorContentBridge'

vi.mock('../../../src/renderer/lib/extractEditorSegments', () => ({
  extractEditorSegments: vi.fn(),
}))

import { extractEditorSegments } from '../../../src/renderer/lib/extractEditorSegments'
import { contentToEditorDoc, editorDocToContent } from '../../../src/renderer/lib/editorContentBridge'

const mockedExtractEditorSegments = vi.mocked(extractEditorSegments)

describe('editorContentBridge', () => {
  beforeEach(() => {
    mockedExtractEditorSegments.mockReset()
  })

  it('assigns unique mentionId per slash block when loading content', () => {
    const content: UserMessageContent = [
      {
        type: 'slash_command',
        name: 'docs-sync',
        category: 'skill',
        label: 'Docs Sync',
        expandedText: 'one',
      },
      {
        type: 'slash_command',
        name: 'docs-sync',
        category: 'skill',
        label: 'Docs Sync (Alt)',
        expandedText: 'two',
      },
    ]

    const { doc, metadata } = contentToEditorDoc(content)
    expect(metadata.slashByMentionId.size).toBe(2)

    const paragraph = doc.content?.[0] as { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> }
    const slashNodes = (paragraph.content ?? []).filter((node) => node.type === 'slashMention')
    expect(slashNodes).toHaveLength(2)
    expect(slashNodes[0].attrs?.mentionId).toBe('slash-0')
    expect(slashNodes[1].attrs?.mentionId).toBe('slash-1')
    expect(slashNodes[0].attrs?.label).toBe('Docs Sync')
    expect(slashNodes[1].attrs?.label).toBe('Docs Sync (Alt)')
  })

  it('restores distinct preserved slash blocks by mentionId', () => {
    const first: SlashCommandBlock = {
      type: 'slash_command',
      name: 'docs-sync',
      category: 'skill',
      label: 'Docs Sync',
      expandedText: 'first body',
    }
    const second: SlashCommandBlock = {
      type: 'slash_command',
      name: 'docs-sync',
      category: 'skill',
      label: 'Docs Sync (Alt)',
      expandedText: 'second body',
    }
    const metadata: EditMetadata = {
      slashByMentionId: new Map<string, SlashCommandBlock>([
        ['slash-0', first],
        ['slash-1', second],
      ]),
      mediaBlocks: [],
    }

    mockedExtractEditorSegments.mockReturnValue([
      { type: 'slashMention', name: 'docs-sync', category: 'skill', mentionId: 'slash-0' },
      { type: 'text', text: ' ' },
      { type: 'slashMention', name: 'docs-sync', category: 'skill', mentionId: 'slash-1' },
    ])

    const content = editorDocToContent({} as never, metadata)
    expect(Array.isArray(content)).toBe(true)
    const slashBlocks = (content as Exclude<UserMessageContent, string>).filter(
      (block): block is SlashCommandBlock => block.type === 'slash_command',
    )
    expect(slashBlocks).toEqual([first, second])
  })

  it('uses segment label when slash mention has no preserved metadata', () => {
    const metadata: EditMetadata = {
      slashByMentionId: new Map(),
      mediaBlocks: [],
    }

    mockedExtractEditorSegments.mockReturnValue([
      {
        type: 'slashMention',
        name: 'evose:x_analyst_abcd12',
        category: 'skill',
        label: 'X Analyst',
      },
    ])

    const content = editorDocToContent({} as never, metadata)
    expect(content).toEqual([
      {
        type: 'slash_command',
        name: 'evose:x_analyst_abcd12',
        category: 'skill',
        label: 'X Analyst',
        expandedText: '',
      },
    ])
  })
})
