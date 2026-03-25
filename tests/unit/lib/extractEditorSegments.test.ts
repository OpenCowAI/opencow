// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { extractEditorSegments, type EditorSegment } from '@/lib/extractEditorSegments'
import type { Editor } from '@tiptap/core'

/**
 * Create a minimal mock of a ProseMirror Node for testing.
 */
function mockTextNode(text: string) {
  return {
    type: { name: 'text' },
    textContent: text,
    attrs: {},
  }
}

function mockSlashMentionNode(
  name: string,
  category: string = 'builtin',
  sourcePath?: string,
  label?: string,
  mentionId?: string,
) {
  return {
    type: { name: 'slashMention' },
    textContent: `/${name}`,
    attrs: { name, category, sourcePath, label, mentionId },
  }
}

function mockParagraph(children: ReturnType<typeof mockTextNode>[]) {
  return {
    forEach(cb: (child: unknown, offset: number, index: number) => void) {
      children.forEach((child, index) => cb(child, 0, index))
    },
  }
}

function mockDoc(paragraphs: ReturnType<typeof mockParagraph>[]) {
  return {
    forEach(cb: (block: unknown, offset: number, index: number) => void) {
      paragraphs.forEach((p, index) => cb(p, 0, index))
    },
  }
}

function mockEditor(paragraphs: ReturnType<typeof mockParagraph>[]): Editor {
  return {
    state: { doc: mockDoc(paragraphs) },
  } as unknown as Editor
}

describe('extractEditorSegments', () => {
  it('extracts plain text as a single text segment', () => {
    const editor = mockEditor([mockParagraph([mockTextNode('Hello world')])])
    const result = extractEditorSegments(editor)
    expect(result).toEqual([{ type: 'text', text: 'Hello world' }])
  })

  it('extracts slashMention node as mention segment', () => {
    const editor = mockEditor([
      mockParagraph([
        mockSlashMentionNode('compact', 'builtin'),
      ]),
    ])
    const result = extractEditorSegments(editor)
    expect(result).toEqual([
      { type: 'slashMention', name: 'compact', category: 'builtin', sourcePath: undefined },
    ])
  })

  it('extracts slashMention with sourcePath', () => {
    const editor = mockEditor([
      mockParagraph([
        mockSlashMentionNode('yg.code.quality', 'command', '/path/to/cmd.md'),
      ]),
    ])
    const result = extractEditorSegments(editor)
    expect(result).toEqual([
      {
        type: 'slashMention',
        name: 'yg.code.quality',
        category: 'command',
        sourcePath: '/path/to/cmd.md',
      },
    ])
  })

  it('extracts slashMention label when present', () => {
    const editor = mockEditor([
      mockParagraph([
        mockSlashMentionNode('evose:x_analyst_abc123', 'skill', 'evose://skill/app-x-analyst', 'X Analyst'),
      ]),
    ])
    const result = extractEditorSegments(editor)
    expect(result).toEqual([
      {
        type: 'slashMention',
        name: 'evose:x_analyst_abc123',
        category: 'skill',
        sourcePath: 'evose://skill/app-x-analyst',
        label: 'X Analyst',
      },
    ])
  })

  it('extracts slashMention mentionId when present', () => {
    const editor = mockEditor([
      mockParagraph([
        mockSlashMentionNode('docs-sync', 'skill', '/skills/docs-sync.md', 'Docs Sync', 'slash-7'),
      ]),
    ])
    const result = extractEditorSegments(editor)
    expect(result).toEqual([
      {
        type: 'slashMention',
        name: 'docs-sync',
        category: 'skill',
        sourcePath: '/skills/docs-sync.md',
        label: 'Docs Sync',
        mentionId: 'slash-7',
      },
    ])
  })

  it('separates paragraphs with newline', () => {
    const editor = mockEditor([
      mockParagraph([mockTextNode('Line 1')]),
      mockParagraph([mockTextNode('Line 2')]),
    ])
    const result = extractEditorSegments(editor)
    expect(result).toEqual([{ type: 'text', text: 'Line 1\nLine 2' }])
  })

  it('handles mixed text and mentions in one paragraph', () => {
    const editor = mockEditor([
      mockParagraph([
        mockTextNode('Please '),
        mockSlashMentionNode('yg.code.quality', 'command', '/cmd.md'),
        mockTextNode(' this file'),
      ]),
    ])
    const result = extractEditorSegments(editor)
    expect(result).toEqual<EditorSegment[]>([
      { type: 'text', text: 'Please ' },
      { type: 'slashMention', name: 'yg.code.quality', category: 'command', sourcePath: '/cmd.md' },
      { type: 'text', text: ' this file' },
    ])
  })

  it('merges adjacent text segments', () => {
    const editor = mockEditor([
      mockParagraph([mockTextNode('Hello '), mockTextNode('world')]),
    ])
    const result = extractEditorSegments(editor)
    expect(result).toEqual([{ type: 'text', text: 'Hello world' }])
  })

  it('trims leading and trailing whitespace', () => {
    const editor = mockEditor([
      mockParagraph([mockTextNode('  Hello world  ')]),
    ])
    const result = extractEditorSegments(editor)
    expect(result).toEqual([{ type: 'text', text: 'Hello world' }])
  })

  it('returns empty array for empty document', () => {
    const editor = mockEditor([mockParagraph([])])
    const result = extractEditorSegments(editor)
    expect(result).toEqual([])
  })

  it('handles mention at start followed by text', () => {
    const editor = mockEditor([
      mockParagraph([
        mockSlashMentionNode('compact', 'builtin'),
        mockTextNode(' some instructions'),
      ]),
    ])
    const result = extractEditorSegments(editor)
    expect(result).toEqual<EditorSegment[]>([
      { type: 'slashMention', name: 'compact', category: 'builtin', sourcePath: undefined },
      { type: 'text', text: ' some instructions' },
    ])
  })
})
